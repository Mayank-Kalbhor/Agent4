const cron = require('node-cron');
const { OpenAI } = require('openai');
const { query, tenantStorage } = require('../db/db');
const { cancelFollowUps } = require('./schedulerService');
const { generateEmail } = require('./emailGenerationService');

// Initialize OpenAI client if API key is set
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/**
 * Classifies the email intent using GPT-4 or a rule-based mock engine.
 * Intents: 'interested', 'not_interested', 'not_now', 'question'
 */
async function classifyIntent(emailContent) {
  if (!openai) {
    return calculateMockIntent(emailContent);
  }

  const prompt = `You are a B2B sales email intent classifier.
Analyze the email content below and classify the user's intent into exactly one of the following classes:
- 'interested' (wants a call, meeting, calendar link, demo, or more info)
- 'not_interested' (asks to stop, unsubscribe, says no, or moving on)
- 'not_now' (asks to connect later, next quarter, next year, busy right now)
- 'question' (asks a specific question about product, pricing, details, or features)

You must output a valid JSON object matching this schema:
{
  "intent": "interested" | "not_interested" | "not_now" | "question",
  "rationale": "Short explanation of the choice"
}

Email Content:
"${emailContent}"
`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'system', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    return {
      intent: parsed.intent || 'question',
      rationale: parsed.rationale || 'GPT-4 classified'
    };
  } catch (err) {
    console.error('GPT-4 classification failed. Falling back to keyword mock.', err.message);
    return calculateMockIntent(emailContent);
  }
}

/**
 * Deterministic keyword-based intent classifier.
 */
function calculateMockIntent(content) {
  const c = content.toLowerCase();

  let intent = 'not_interested'; // Safe default
  let rationale = 'Default fallback classification';

  if (
    c.includes('interested') || 
    c.includes('yes') || 
    c.includes('sure') || 
    c.includes('call') || 
    c.includes('talk') || 
    c.includes('chat') || 
    c.includes('calendar') || 
    c.includes('time') || 
    c.includes('meeting') ||
    c.includes('demo')
  ) {
    intent = 'interested';
    rationale = 'Matches interest keywords (call, meeting, yes, calendar)';
  } else if (
    c.includes('remove') || 
    c.includes('stop') || 
    c.includes('unsubscribe') || 
    c.includes('not interested') || 
    c.includes('no thanks') || 
    c.includes("don't reach out")
  ) {
    intent = 'not_interested';
    rationale = 'Matches opt-out keywords (stop, remove, unsubscribe)';
  } else if (
    c.includes('later') || 
    c.includes('busy') || 
    c.includes('next quarter') || 
    c.includes('next year') || 
    c.includes('not now')
  ) {
    intent = 'not_now';
    rationale = 'Matches delay/busy keywords';
  } else if (
    c.includes('?') || 
    c.includes('what') || 
    c.includes('how') || 
    c.includes('who') || 
    c.includes('pricing') || 
    c.includes('cost') || 
    c.includes('features') || 
    c.includes('details')
  ) {
    intent = 'question';
    rationale = 'Matches question punctuation or interrogative keywords';
  }

  return { intent, rationale };
}

/**
 * Processes a single inbound message. Classifies intent, triggers follow-up actions, 
 * cancels future follow-ups, and logs audits.
 */
async function processInboundMessage(message) {
  const { id: messageId, tenant_id: tenantId, lead_id: leadId, content } = message;

  await tenantStorage.run({ tenantId }, async () => {
    // 1. Double check if this message is already processed to be idempotent
    const checkRes = await query('SELECT intent FROM messages WHERE id = $1', [messageId]);
    if (checkRes.rows.length > 0 && checkRes.rows[0].intent) {
      return; // Already processed
    }

    // 2. Classify Inbound Reply
    const { intent, rationale } = await classifyIntent(content);

    // 3. Update Message in Database with intent
    await query(
      "UPDATE messages SET intent = $1, status = 'processed', metadata = metadata || $2::jsonb WHERE id = $3",
      [intent, JSON.stringify({ classification_rationale: rationale }), messageId]
    );

    // 4. Update Lead Status based on reply
    await query("UPDATE leads SET status = 'replied' WHERE id = $1", [leadId]);

    // 5. Cancel all future scheduled follow-up jobs for this lead
    await cancelFollowUps(leadId);

    // 6. Action Routing based on Intent
    if (intent === 'interested') {
      // Trigger calendar link dispatch
      await sendCalendarLink(tenantId, leadId);
    } else if (intent === 'question') {
      // Flag message for human review
      await query("UPDATE messages SET needs_human_review = TRUE WHERE id = $1", [messageId]);
    } else if (intent === 'not_interested' || intent === 'not_now') {
      // Opt lead out of sequence
      await query("UPDATE leads SET status = 'opted_out' WHERE id = $1", [leadId]);

      const leadRes = await query("SELECT email FROM leads WHERE id = $1", [leadId]);
      const lead = leadRes.rows[0];
      if (lead && lead.email && lead.email !== '[deleted]') {
        const { addToSuppressionList } = require('./gdprService');
        await addToSuppressionList(tenantId, lead.email, `Inbound email classified as ${intent}`);
      }
    }

    // 7. Insert Audit Log
    await query(`
      INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
      VALUES ($1, NULL, 'REPLY_CLASSIFICATION', 'messages', $2, $3)
    `, [
      tenantId,
      messageId,
      JSON.stringify({ intent, rationale, lead_id: leadId })
    ]);
  });
}

/**
 * Generates and sends a calendar booking link email to interested leads.
 */
async function sendCalendarLink(tenantId, leadId) {
  const leadRes = await query('SELECT * FROM leads WHERE id = $1', [leadId]);
  if (leadRes.rows.length === 0) return;
  const lead = leadRes.rows[0];

  const tenantRes = await query('SELECT name, settings FROM tenants WHERE id = $1', [tenantId], false);
  const tenantName = tenantRes.rows[0]?.name || 'Our SaaS Platform';
  const bookingLink = tenantRes.rows[0]?.settings?.booking_link || 'https://calendly.com/sales-team';

  const sender = {
    name: 'Sales Director',
    companyName: tenantName,
    value_proposition: 'automated lead workflow scheduling'
  };

  const subject = `Meeting Booking Link — ${tenantName}`;
  const body = `Hi ${lead.name},\n\nThanks for your interest! You can choose a convenient slot directly on my calendar here:\n\n${bookingLink}\n\nLooking forward to speaking with you!\n\nBest regards,\nAI Sales Executive`;

  const queryStr = `
    INSERT INTO messages (tenant_id, lead_id, channel, direction, content, status, subject, metadata)
    VALUES ($1, $2, 'email', 'outbound', $3, 'sent', $4, $5)
    RETURNING *;
  `;
  const messageMetadata = {
    automated: true,
    calendar_link_dispatch: true
  };
  await query(queryStr, [
    tenantId, leadId, body, subject, JSON.stringify(messageMetadata)
  ]);

  // Log audit activity
  await query(`
    INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
    VALUES ($1, NULL, 'SEND_CALENDAR_LINK', 'messages', $2, NULL)
  `, [tenantId, leadId]);
}

/**
 * Database poller to retrieve all unprocessed inbound messages globally and execute routing.
 */
async function pollReplies() {
  // Query globally bypassing RLS for scanning across all tenants
  const sql = "SELECT * FROM messages WHERE direction = 'inbound' AND intent IS NULL";
  const res = await query(sql, [], false);
  const messages = res.rows;

  for (const message of messages) {
    try {
      await processInboundMessage(message);
    } catch (err) {
      console.error(`❌ Error processing inbound message ${message.id}:`, err.message);
    }
  }
}

// Schedule polling to run every 15 minutes
if (process.env.NODE_ENV !== 'test') {
  cron.schedule('*/15 * * * *', async () => {
    console.log('⏰ Running scheduled 15-minute reply detection polling...');
    await pollReplies();
  });
}

module.exports = {
  classifyIntent,
  calculateMockIntent,
  processInboundMessage,
  pollReplies
};
