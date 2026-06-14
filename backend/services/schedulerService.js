const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const { query, tenantStorage } = require('../db/db');
const { generateEmail } = require('./emailGenerationService');
const { getTenantBillingContext } = require('../middleware/quotaMiddleware');

const isTest = process.env.NODE_ENV === 'test' || process.env.MOCK_REDIS === 'true';

// Configurable Redis connection options
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const queueName = 'follow-up-queue';

let bullQueue = null;
let mockQueue = null;
let worker = null;
let isRedisActive = false;

// Constant wrapper interface that handles dynamic fallback/failover to the in-memory mock queue
const queue = {
  add: async (name, data, opts) => {
    if (isRedisActive && bullQueue) {
      try {
        return await bullQueue.add(name, data, opts);
      } catch (err) {
        console.warn('⚠️ BullMQ add failed, falling back to In-Memory queue:', err.message);
        return await mockQueue.add(name, data, opts);
      }
    } else {
      return await mockQueue.add(name, data, opts);
    }
  },
  getJobs: async (types) => {
    if (isRedisActive && bullQueue) {
      try {
        return await bullQueue.getJobs(types);
      } catch (err) {
        console.warn('⚠️ BullMQ getJobs failed, returning empty list:', err.message);
        return [];
      }
    }
    return [];
  }
};

// In-Memory Mock Queue for Test Environment
const mockJobs = new Map(); // Maps leadId -> array of { jobId, timeoutId, templateType }

// Always define mock queue as fallback immediately so it is available before connection resolution
setupInMemoryMock();

if (!isTest) {
  let redisFailed = false;

  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    retryStrategy(times) {
      if (times > 2) {
        return null; // Stop retrying after 2 attempts to trigger fallback quickly
      }
      return 500;
    }
  });

  connection.on('error', (err) => {
    isRedisActive = false;
    if (!redisFailed) {
      redisFailed = true;
      console.warn(`⚠️ Redis connection failed (${redisUrl}). Defaulting to In-Memory Scheduler Mock. Error:`, err.message);
      // Ensure connection is fully closed to stop reconnect attempts
      try {
        connection.disconnect();
      } catch (e) {}
    }
  });

  connection.on('close', () => {
    isRedisActive = false;
    console.warn('🔌 Redis connection closed. Scheduler falling back to In-Memory mode.');
  });

  connection.once('ready', () => {
    if (!redisFailed) {
      console.log('🔌 Redis connected successfully. Initializing BullMQ.');
      try {
        bullQueue = new Queue(queueName, { connection });
        bullQueue.on('error', (err) => {
          // Suppress further errors on the queue object
        });
        isRedisActive = true;

        worker = new Worker(queueName, async (job) => {
          const { tenantId, leadId, templateType } = job.data;
          await processFollowUpJob(tenantId, leadId, templateType);
        }, { connection });

        worker.on('failed', (job, err) => {
          console.error(`❌ BullMQ job ${job.id} failed:`, err.message);
        });

        worker.on('error', (err) => {
          // Suppress further errors on the worker object
        });
      } catch (err) {
        console.error('❌ Failed to initialize BullMQ:', err.message);
        isRedisActive = false;
        setupInMemoryMock();
      }
    }
  });
}

function setupInMemoryMock() {
  mockQueue = {
    add: async (name, data, opts) => {
      const { tenantId, leadId, templateType } = data;
      const delay = opts.delay || 0;
      const jobId = `${tenantId}:${leadId}:${templateType}`;
      
      const timeoutId = setTimeout(async () => {
        try {
          await processFollowUpJob(tenantId, leadId, templateType);
        } catch (err) {
          console.error(`❌ Mock job execution failed for lead ${leadId}:`, err.message);
        } finally {
          // Clean up job from mock map
          const jobs = mockJobs.get(leadId) || [];
          mockJobs.set(leadId, jobs.filter(j => j.jobId !== jobId));
        }
      }, delay);

      const jobs = mockJobs.get(leadId) || [];
      jobs.push({ jobId, timeoutId, templateType });
      mockJobs.set(leadId, jobs);

      return { id: jobId };
    }
  };
}

/**
 * Handles the actual follow-up email dispatch logic inside tenant storage isolation scope.
 */
async function processFollowUpJob(tenantId, leadId, templateType) {
  await tenantStorage.run({ tenantId }, async () => {
    // 1. Fetch Lead
    const leadsRes = await query('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (leadsRes.rows.length === 0) return;
    const lead = leadsRes.rows[0];

    // 2. Validate Eligibility: Must not be opted_out, replied, paused, scheduled a meeting, missing consent, or suppressed
    const { isSuppressed } = require('./gdprService');
    const isLeadSuppressed = lead.email ? await isSuppressed(tenantId, lead.email) : false;

    if (
      lead.status === 'opted_out' || 
      lead.status === 'replied' || 
      lead.status === 'meeting_scheduled' ||
      lead.sequence_paused ||
      !lead.consent_given ||
      isLeadSuppressed
    ) {
      return; // Not eligible
    }

    // 3. Retrieve Tenant Settings/Defaults and Billing Context
    let billingContext;
    try {
      billingContext = await getTenantBillingContext(tenantId);
    } catch (err) {
      return; // Tenant not found
    }
    const { tenant, plan, quotas } = billingContext;

    // Check payment status or quota
    if (tenant.subscription_status === 'past_due' || tenant.subscription_status === 'unpaid') {
      console.warn(`[Scheduler Blocked] Tenant ${tenant.name} subscription status is ${tenant.subscription_status}. Pausing lead sequence.`);
      await query("UPDATE leads SET sequence_paused = TRUE WHERE id = $1", [leadId]);
      return;
    }

    if (tenant.emails_sent_count >= quotas.emails) {
      console.warn(`[Scheduler Blocked] Tenant ${tenant.name} email quota exceeded (${tenant.emails_sent_count}/${quotas.emails}). Pausing lead sequence.`);
      await query("UPDATE leads SET sequence_paused = TRUE WHERE id = $1", [leadId]);
      return;
    }
    
    const valueProp = tenant.settings?.value_proposition || 'AI-powered pipeline automation, lead capture, and immediate lead scoring';
    const sender = {
      name: 'AGENT4',
      companyName: tenant.name,
      value_proposition: valueProp
    };

    // Twilio Fallback checks
    if (templateType === 'follow_up_1') {
      if (!quotas.channels.includes('sms')) {
        console.warn(`[Scheduler Blocked] SMS channel not allowed for plan: ${plan}. Skipping SMS fallback.`);
        return;
      }

      // Day 3 check: if latest outreach email went unopened, send SMS
      const emailRes = await query(
        "SELECT * FROM messages WHERE lead_id = $1 AND channel = 'email' AND direction = 'outbound' ORDER BY sent_at DESC LIMIT 1",
        [leadId]
      );
      const latestEmail = emailRes.rows[0];

      if (latestEmail && !latestEmail.opened_at) {
        const { sendSMS } = require('./twilioService');
        const smsBody = `Hi ${lead.name}, I sent you an email regarding our AGENT4. Let me know if you would like to connect!`;
        await sendSMS(tenantId, leadId, smsBody);
        return;
      } else {
        console.log(`[Fallback Scheduler] Lead ${lead.name} has opened the email. Skipping SMS fallback.`);
        return;
      }
    }

    if (templateType === 'follow_up_2') {
      if (!quotas.channels.includes('whatsapp')) {
        console.warn(`[Scheduler Blocked] WhatsApp channel not allowed for plan: ${plan}. Skipping WhatsApp fallback.`);
        return;
      }

      // Day 5 check: if no reply, send WhatsApp follow-up template message
      // (Lead eligibility check above already ensures no reply/opt-out/meeting occurred)
      const { sendWhatsApp } = require('./twilioService');
      const waBody = `Hi ${lead.name}, thanks for connecting with ${tenant.name}. Are you interested in a quick chat?`;
      await sendWhatsApp(tenantId, leadId, waBody);
      return;
    }

    // Remaining: breakup (Day 9)
    // 4. Retrieve Prior Outreach Emails
    const priorMsgRes = await query(
      "SELECT content FROM messages WHERE lead_id = $1 AND direction = 'outbound' ORDER BY sent_at ASC",
      [leadId]
    );
    const previous_emails = priorMsgRes.rows.map(m => m.content);

    // 5. Generate Follow-Up Copy
    const draft = await generateEmail(lead, sender, templateType, previous_emails);

    // 6. Queue draft or mark as sent
    const status = draft.confidence_score < 0.7 ? 'pending_review' : 'sent';
    const queryStr = `
      INSERT INTO messages (tenant_id, lead_id, channel, direction, content, status, subject, metadata)
      VALUES ($1, $2, 'email', 'outbound', $3, $4, $5, $6)
      RETURNING *;
    `;
    const messageMetadata = {
      confidence_score: draft.confidence_score,
      template_version: draft.template_version,
      rationale: draft.rationale,
      automated: true
    };
    const saved = await query(queryStr, [
      tenantId, leadId, draft.body, status, draft.subject, JSON.stringify(messageMetadata)
    ]);
    const messageId = saved.rows[0].id;
    const trackingUrl = process.env.TRACKING_URL || 'http://localhost:5000';
    const contentWithPixel = `${draft.body}\n\n<img src="${trackingUrl}/api/emails/track-open/${messageId}" width="1" height="1" style="display:none;" />`;
    await query("UPDATE messages SET content = $1 WHERE id = $2", [contentWithPixel, messageId]);

    // Update Lead status to contacted if sending out follow-up
    if (status === 'sent') {
      await query("UPDATE leads SET status = 'contacted' WHERE id = $1", [leadId]);
      await query("UPDATE tenants SET emails_sent_count = emails_sent_count + 1 WHERE id = $1", [tenantId], false);
    }

    // 7. Special action: If Breakup, mark opted_out
    if (templateType === 'breakup') {
      await query("UPDATE leads SET status = 'opted_out', updated_at = NOW() WHERE id = $1", [leadId]);
    }

    // 8. Log Audit Activity
    await query(`
      INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
      VALUES ($1, NULL, $2, 'messages', $3, $4)
    `, [
      tenantId,
      templateType === 'breakup' ? 'SEND_BREAKUP_OUTREACH' : 'SEND_FOLLOW_UP_OUTREACH',
      leadId,
      JSON.stringify({ template: templateType, status })
    ]);
  });
}

/**
 * Schedules follow-up events for a lead on Day 3, Day 5, and Day 9 (or custom delays).
 */
async function scheduleFollowUps(tenantId, leadId, customDelays = null) {
  // Delays: Day 3 (72h) check email open -> SMS, Day 5 (120h) check SMS reply -> WhatsApp, Day 9 (216h) breakup
  const delays = customDelays || {
    follow_up_1: 3 * 24 * 3600 * 1000,
    follow_up_2: 5 * 24 * 3600 * 1000,
    breakup: 9 * 24 * 3600 * 1000
  };

  const cleanLeadId = leadId.toString();

  // Clear any existing jobs first to be idempotent
  await cancelFollowUps(cleanLeadId);

  // Day 3 Job
  await queue.add('follow_up_1', { tenantId, leadId: cleanLeadId, templateType: 'follow_up_1' }, {
    delay: delays.follow_up_1,
    jobId: `${tenantId}:${cleanLeadId}:follow_up_1`
  });

  // Day 5 Job
  await queue.add('follow_up_2', { tenantId, leadId: cleanLeadId, templateType: 'follow_up_2' }, {
    delay: delays.follow_up_2,
    jobId: `${tenantId}:${cleanLeadId}:follow_up_2`
  });

  // Day 9 Job
  await queue.add('breakup', { tenantId, leadId: cleanLeadId, templateType: 'breakup' }, {
    delay: delays.breakup,
    jobId: `${tenantId}:${cleanLeadId}:breakup`
  });
}

/**
 * Cancels all pending follow-up scheduled jobs for a given lead.
 */
async function cancelFollowUps(leadId) {
  const cleanLeadId = leadId.toString();

  // Always cancel in-memory scheduled timeouts (just in case)
  const jobs = mockJobs.get(cleanLeadId) || [];
  for (const job of jobs) {
    clearTimeout(job.timeoutId);
  }
  mockJobs.delete(cleanLeadId);

  if (isTest || !isRedisActive || !worker) {
    return;
  }

  // Cancel BullMQ jobs
  try {
    const jobs = await queue.getJobs(['delayed', 'waiting', 'active']);
    for (const job of jobs) {
      if (job.data.leadId === cleanLeadId) {
        await job.remove();
      }
    }
  } catch (err) {
    console.error(`[BullMQ Cancel Warning] Failed to cancel jobs for lead ${cleanLeadId}:`, err.message);
  }
}

module.exports = {
  scheduleFollowUps,
  cancelFollowUps,
  processFollowUpJob,
  mockJobs
};
