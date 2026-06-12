const { query, tenantStorage } = require('../db/db');
const { cancelFollowUps, scheduleFollowUps } = require('./schedulerService');

// Optional API keys/urls
const calendlyClientId = process.env.CALENDLY_CLIENT_ID;
const calendlyClientSecret = process.env.CALENDLY_CLIENT_SECRET;
const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;

/**
 * Returns OAuth redirect URL to connect user's calendar.
 */
function getOAuthUrl(tenantId, userId, provider = 'calendly') {
  const redirectUri = `http://localhost:5000/api/integrations/oauth/callback`;
  const state = JSON.stringify({ tenantId, userId, provider });
  
  if (!calendlyClientId) {
    // Return simulated OAuth url
    return `https://auth.calendly.com/oauth/authorize/mock?client_id=mock_id&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
  }
  
  return `https://auth.calendly.com/oauth/authorize?client_id=${calendlyClientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
}

/**
 * Handles OAuth callback code exchange. Saves access/refresh tokens and booking links.
 */
async function handleOAuthCallback(code, tenantId, userId, provider = 'calendly') {
  let tokens = {
    access_token: 'mock_access_token_123',
    refresh_token: 'mock_refresh_token_123',
    expires_in: 7200,
    created_at: Date.now()
  };

  let calendarLink = 'https://calendly.com/mock-sales-rep';

  if (calendlyClientId && calendlyClientSecret) {
    try {
      // Real code exchange logic here using fetch (mocked for offline execution safety)
      // tokens = await exchangeCodeForTokens(code);
      // calendarLink = await fetchUserCalendarLink(tokens.access_token);
    } catch (err) {
      console.error('OAuth exchange error, using Mock Mode fallback:', err.message);
    }
  }

  // Update user with connection details
  await tenantStorage.run({ tenantId }, async () => {
    await query(
      "UPDATE users SET calendar_link = $1, integration_settings = integration_settings || $2::jsonb WHERE id = $3",
      [calendarLink, JSON.stringify({ tokens, provider }), userId]
    );

    // Audit log
    await query(`
      INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
      VALUES ($1, $2, 'CONNECT_CALENDAR_INTEGRATION', 'users', $2, $3)
    `, [tenantId, userId, JSON.stringify({ provider, success: true })]);
  });

  return { calendarLink };
}

/**
 * Fetches user scheduling link, falling back to tenant defaults or generic calendar.
 */
async function fetchSchedulingLink(tenantId, userId) {
  let link = null;

  if (userId) {
    const res = await query('SELECT calendar_link FROM users WHERE id = $1', [userId]);
    if (res.rows.length > 0 && res.rows[0].calendar_link) {
      link = res.rows[0].calendar_link;
    }
  }

  if (!link && tenantId) {
    const tenantRes = await query('SELECT settings FROM tenants WHERE id = $1', [tenantId], false);
    if (tenantRes.rows.length > 0) {
      link = tenantRes.rows[0].settings?.booking_link;
    }
  }

  return link || 'https://calendly.com/sales-team';
}

/**
 * Sends a webhook notification to sales rep (Slack webhook or console mock).
 */
async function notifySalesRep(tenantId, eventType, lead, meeting) {
  const message = `🔔 *Sales Agent SaaS Notification*
Event: \`${eventType}\`
Lead: *${lead.name}* (${lead.company || 'Unknown Co'})
Email: ${lead.email}
Meeting Time: ${meeting.scheduled_at}
Meeting Status: \`${meeting.status}\`
Timezone: \`${meeting.timezone || 'UTC'}\`
Booking Link: ${meeting.booking_link || 'N/A'}`;

  // Log to audit log first
  await query(`
    INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
    VALUES ($1, NULL, $2, 'meetings', $3, $4)
  `, [
    tenantId,
    `NOTIFY_REP_${eventType.toUpperCase()}`,
    meeting.id,
    JSON.stringify({ lead_id: lead.id, channel: slackWebhookUrl ? 'slack' : 'console' })
  ]);

  if (slackWebhookUrl) {
    try {
      // Real fetch POST request (in production)
      // await fetch(slackWebhookUrl, { method: 'POST', body: JSON.stringify({ text: message }), headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      console.error('Slack webhook notify failed:', err.message);
    }
  } else {
    console.log(`[REP NOTIFICATION MOCK] (Slack/Email Webhook Triggered):\n${message}`);
  }
}

/**
 * Dispatches and processes webhook events (invitee.created, invitee.canceled, no_show).
 */
async function processWebhookEvent(tenantId, eventType, payload) {
  const { 
    email, 
    scheduledAt, 
    bookingLink, 
    calendarEventId, 
    timezone = 'UTC',
    rescheduled = false,
    oldCalendarEventId = null,
    metadata = {}
  } = payload;

  return await tenantStorage.run({ tenantId }, async () => {
    // 1. Correlate Lead by Email
    const leadsRes = await query('SELECT * FROM leads WHERE email = $1', [email]);
    if (leadsRes.rows.length === 0) {
      throw new Error(`Correlated lead not found for email: ${email}`);
    }
    const lead = leadsRes.rows[0];

    let meetingRecord = null;

    if (eventType === 'invitee.created') {
      // If rescheduled, update the old meeting status to rescheduled
      if (rescheduled || oldCalendarEventId) {
        const targetOldId = oldCalendarEventId || metadata.old_event_id;
        if (targetOldId) {
          await query(
            "UPDATE meetings SET status = 'rescheduled' WHERE calendar_event_id = $1",
            [targetOldId]
          );
        }
      }

      // Create new scheduled meeting (Upsert check to make it idempotent)
      const checkRes = await query('SELECT * FROM meetings WHERE calendar_event_id = $1', [calendarEventId]);
      if (checkRes.rows.length > 0) {
        meetingRecord = checkRes.rows[0];
      } else {
        const queryStr = `
          INSERT INTO meetings (tenant_id, lead_id, scheduled_at, calendar_event_id, booking_link, status, timezone, meeting_metadata)
          VALUES ($1, $2, $3, $4, $5, 'scheduled', $6, $7)
          RETURNING *;
        `;
        const insertRes = await query(queryStr, [
          tenantId, lead.id, scheduledAt, calendarEventId, bookingLink, timezone, JSON.stringify(metadata)
        ]);
        meetingRecord = insertRes.rows[0];
      }

      // Update lead status and cancel follow-ups
      await query("UPDATE leads SET status = 'meeting_scheduled' WHERE id = $1", [lead.id]);
      await cancelFollowUps(lead.id);

      // Simulate sending a calendar invite back to prospect
      const inviteSubject = `Meeting Confirmed: AI Sales Discussion`;
      const inviteBody = `Hi ${lead.name},\n\nYour meeting has been scheduled for ${scheduledAt} (${timezone}).\n\nCalendar Details: ${bookingLink}\n\nLooking forward to speaking with you!`;
      await query(`
        INSERT INTO messages (tenant_id, lead_id, channel, direction, content, status, subject, metadata)
        VALUES ($1, $2, 'email', 'outbound', $3, 'sent', $4, $5)
      `, [tenantId, lead.id, inviteBody, inviteSubject, JSON.stringify({ calendar_invite: true })]);

      // Notify Sales Rep
      await notifySalesRep(tenantId, rescheduled ? 'rescheduled' : 'booked', lead, meetingRecord);

    } else if (eventType === 'invitee.canceled') {
      // Update meeting status to canceled
      const updateRes = await query(
        "UPDATE meetings SET status = 'canceled' WHERE calendar_event_id = $1 RETURNING *",
        [calendarEventId]
      );
      meetingRecord = updateRes.rows[0];

      if (meetingRecord) {
        // Update lead status (e.g. back to replied, contacted, or opt_out depending on rules. Default is 'replied')
        await query("UPDATE leads SET status = 'replied' WHERE id = $1", [lead.id]);
        
        // Notify Sales Rep
        await notifySalesRep(tenantId, 'canceled', lead, meetingRecord);
      }

    } else if (eventType === 'no_show') {
      // Update meeting status to no_show
      const updateRes = await query(
        "UPDATE meetings SET status = 'no_show' WHERE calendar_event_id = $1 RETURNING *",
        [calendarEventId]
      );
      meetingRecord = updateRes.rows[0];

      if (meetingRecord) {
        // Notify Sales Rep
        await notifySalesRep(tenantId, 'no_show', lead, meetingRecord);
      }
    }

    return meetingRecord;
  });
}

module.exports = {
  getOAuthUrl,
  handleOAuthCallback,
  fetchSchedulingLink,
  notifySalesRep,
  processWebhookEvent
};
