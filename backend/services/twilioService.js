const { query, tenantStorage } = require('../db/db');
const { classifyIntent } = require('./replyDetectionService');

// Global mock state for testing and simulator logs
const sentMessagesLog = [];

/**
 * Normalizes phone number strings by removing all non-numeric characters.
 */
function cleanPhoneNumber(phone) {
  if (!phone) return '';
  return phone.replace('whatsapp:', '').replace(/\D/g, '');
}

/**
 * Sends SMS follow-up via Twilio.
 */
async function sendSMS(tenantId, leadId, body) {
  let lead = null;
  await tenantStorage.run({ tenantId }, async () => {
    const res = await query('SELECT * FROM leads WHERE id = $1', [leadId]);
    lead = res.rows[0];
  });

  if (!lead || !lead.phone) {
    console.warn(`[Twilio SMS Failed] No valid phone number for lead: ${leadId}`);
    return null;
  }

  const { isSuppressed } = require('./gdprService');
  const isLeadSuppressed = lead.email ? await isSuppressed(tenantId, lead.email) : false;
  if (!lead.consent_given || isLeadSuppressed) {
    console.warn(`[Twilio SMS Blocked] Lead lacks consent or is suppressed: ${leadId}`);
    return null;
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromSMS = process.env.TWILIO_FROM_SMS_NUMBER || '+15559998888';
  const statusCallback = process.env.TWILIO_STATUS_CALLBACK_URL || 'http://localhost:5000/api/integrations/twilio/status-callback';

  let messageSid = 'mock_sms_sid_' + Math.random().toString(36).substring(2, 15);
  let status = 'queued';

  if (accountSid && authToken) {
    try {
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          To: lead.phone,
          From: fromSMS,
          Body: body,
          StatusCallback: statusCallback
        }).toString()
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Twilio API responded with error: ${errText}`);
      }

      const data = await response.json();
      messageSid = data.sid;
      status = data.status || 'sent';
    } catch (err) {
      console.error(`[Twilio SMS Error] Failed to send to ${lead.phone}:`, err.message);
      throw err;
    }
  } else {
    // MOCK SMS MODE
    console.log(`[TWILIO SMS MOCK] Sent SMS to ${lead.phone} (Lead: ${lead.name}): "${body}"`);
    sentMessagesLog.push({ channel: 'sms', to: lead.phone, body, sid: messageSid });
  }

  // Save outreach message in database
  await tenantStorage.run({ tenantId }, async () => {
    await query(`
      INSERT INTO messages (tenant_id, lead_id, channel, direction, content, status, metadata)
      VALUES ($1, $2, 'sms', 'outbound', $3, $4, $5)
    `, [tenantId, leadId, body, status, JSON.stringify({ twilio_message_sid: messageSid })]);

    await query("UPDATE leads SET status = 'contacted', updated_at = NOW() WHERE id = $1", [leadId]);

    await query(`
      INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
      VALUES ($1, NULL, 'SEND_SMS_OUTREACH', 'messages', $2, $3)
    `, [tenantId, leadId, JSON.stringify({ twilio_message_sid: messageSid, channel: 'sms' })]);
  });

  return { sid: messageSid, status };
}

/**
 * Sends WhatsApp pre-approved template message via Twilio WhatsApp API.
 */
async function sendWhatsApp(tenantId, leadId, body) {
  let lead = null;
  await tenantStorage.run({ tenantId }, async () => {
    const res = await query('SELECT * FROM leads WHERE id = $1', [leadId]);
    lead = res.rows[0];
  });

  if (!lead || !lead.phone) {
    console.warn(`[Twilio WhatsApp Failed] No valid phone number for lead: ${leadId}`);
    return null;
  }

  const { isSuppressed } = require('./gdprService');
  const isLeadSuppressed = lead.email ? await isSuppressed(tenantId, lead.email) : false;
  if (!lead.consent_given || isLeadSuppressed) {
    console.warn(`[Twilio WhatsApp Blocked] Lead lacks consent or is suppressed: ${leadId}`);
    return null;
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromWA = process.env.TWILIO_FROM_WHATSAPP_NUMBER || '+14155238886';
  const statusCallback = process.env.TWILIO_STATUS_CALLBACK_URL || 'http://localhost:5000/api/integrations/twilio/status-callback';

  let messageSid = 'mock_wa_sid_' + Math.random().toString(36).substring(2, 15);
  let status = 'queued';

  if (accountSid && authToken) {
    try {
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          To: `whatsapp:${lead.phone}`,
          From: `whatsapp:${fromWA}`,
          Body: body,
          StatusCallback: statusCallback
        }).toString()
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Twilio API responded with error: ${errText}`);
      }

      const data = await response.json();
      messageSid = data.sid;
      status = data.status || 'sent';
    } catch (err) {
      console.error(`[Twilio WhatsApp Error] Failed to send to ${lead.phone}:`, err.message);
      throw err;
    }
  } else {
    // MOCK WHATSAPP MODE
    console.log(`[TWILIO WHATSAPP MOCK] Sent WhatsApp message to ${lead.phone} (Lead: ${lead.name}): "${body}"`);
    sentMessagesLog.push({ channel: 'whatsapp', to: lead.phone, body, sid: messageSid });
  }

  // Save outreach message in database
  await tenantStorage.run({ tenantId }, async () => {
    await query(`
      INSERT INTO messages (tenant_id, lead_id, channel, direction, content, status, metadata)
      VALUES ($1, $2, 'whatsapp', 'outbound', $3, $4, $5)
    `, [tenantId, leadId, body, status, JSON.stringify({ twilio_message_sid: messageSid })]);

    await query("UPDATE leads SET status = 'contacted', updated_at = NOW() WHERE id = $1", [leadId]);

    await query(`
      INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
      VALUES ($1, NULL, 'SEND_WHATSAPP_OUTREACH', 'messages', $2, $3)
    `, [tenantId, leadId, JSON.stringify({ twilio_message_sid: messageSid, channel: 'whatsapp' })]);
  });

  return { sid: messageSid, status };
}

/**
 * Handles inbound Twilio SMS/WhatsApp messages.
 * Payload parameters: MessageSid, From, To, Body
 */
async function handleInboundMessage(payload) {
  const { MessageSid, From, To, Body } = payload;
  if (!From || !Body) {
    throw new Error('Inbound message missing From or Body params.');
  }

  const cleanFrom = cleanPhoneNumber(From);
  const isWhatsApp = From.startsWith('whatsapp:');
  const channel = isWhatsApp ? 'whatsapp' : 'sms';

  // 1. Locate Lead globally bypassing RLS
  const leadsRes = await query('SELECT * FROM leads WHERE phone IS NOT NULL', [], false);
  const lead = leadsRes.rows.find(l => {
    const cleanLeadPhone = cleanPhoneNumber(l.phone);
    return cleanLeadPhone && (cleanLeadPhone.endsWith(cleanFrom) || cleanFrom.endsWith(cleanLeadPhone));
  });

  if (!lead) {
    console.warn(`[Twilio Inbound correlation skipped] No matching lead found for phone: ${cleanFrom}`);
    return { success: false, reason: 'No lead matched' };
  }

  const tenantId = lead.tenant_id;
  const leadId = lead.id;

  return await tenantStorage.run({ tenantId }, async () => {
    const textNormalized = Body.trim().toUpperCase();
    const optOutKeywords = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'OPT OUT', 'REMOVE'];

    // Avoid circular import of schedulerService
    const { cancelFollowUps } = require('./schedulerService');

    // 2. Detect Opt-out Keywords
    if (optOutKeywords.some(keyword => textNormalized.includes(keyword))) {
      await query("UPDATE leads SET status = 'opted_out', updated_at = NOW() WHERE id = $1", [leadId]);
      await cancelFollowUps(leadId);

      if (lead.email && lead.email !== '[deleted]') {
        const { addToSuppressionList } = require('./gdprService');
        await addToSuppressionList(tenantId, lead.email, 'Twilio Opt-out keyword detected');
      }

      await query(`
        INSERT INTO messages (tenant_id, lead_id, channel, direction, content, status, intent, metadata)
        VALUES ($1, $2, $3, 'inbound', $4, 'processed', 'not_interested', $5)
      `, [tenantId, leadId, channel, Body, JSON.stringify({ twilio_message_sid: MessageSid, opt_out: true })]);

      await query(`
        INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
        VALUES ($1, NULL, 'LEAD_OPT_OUT_TWILIO', 'leads', $2, $3)
      `, [tenantId, leadId, JSON.stringify({ channel, body: Body })]);

      return { success: true, action: 'opt_out' };
    }

    // 3. Save standard inbound message
    const msgRes = await query(`
      INSERT INTO messages (tenant_id, lead_id, channel, direction, content, status, metadata)
      VALUES ($1, $2, $3, 'inbound', $4, 'received', $5)
      RETURNING *
    `, [tenantId, leadId, channel, Body, JSON.stringify({ twilio_message_sid: MessageSid })]);

    const inboundMsg = msgRes.rows[0];

    // 4. Update Lead state to replied and cancel follow-ups
    await query("UPDATE leads SET status = 'replied', updated_at = NOW() WHERE id = $1", [leadId]);
    await cancelFollowUps(leadId);

    // 5. Run GPT Classification
    const { intent, rationale } = await classifyIntent(Body);

    await query(`
      UPDATE messages 
      SET intent = $1, status = 'processed', metadata = metadata || $2::jsonb 
      WHERE id = $3
    `, [intent, JSON.stringify({ classification_rationale: rationale }), inboundMsg.id]);

    // 6. Action Routing based on Classified Intent
    if (intent === 'interested') {
      const tenantRes = await query('SELECT settings FROM tenants WHERE id = $1', [tenantId], false);
      const bookingLink = tenantRes.rows[0]?.settings?.booking_link || 'https://calendly.com/sales-team';
      const replyText = `Great to hear! Here's a link to book 15 mins: ${bookingLink}`;

      if (channel === 'sms') {
        await sendSMS(tenantId, leadId, replyText);
      } else {
        await sendWhatsApp(tenantId, leadId, replyText);
      }
    } else if (intent === 'question') {
      await query('UPDATE messages SET needs_human_review = TRUE WHERE id = $1', [inboundMsg.id]);
    } else if (intent === 'not_interested' || intent === 'not_now') {
      await query("UPDATE leads SET status = 'opted_out', updated_at = NOW() WHERE id = $1", [leadId]);
    }

    await query(`
      INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
      VALUES ($1, NULL, 'REPLY_CLASSIFICATION', 'messages', $2, $3)
    `, [tenantId, inboundMsg.id, JSON.stringify({ intent, rationale, lead_id: leadId, channel })]);

    return { success: true, action: 'reply_classified', intent };
  });
}

/**
 * Handles message status callback from Twilio.
 * Payload parameters: MessageSid, SmsStatus
 */
async function handleStatusCallback(payload) {
  const { MessageSid, SmsStatus } = payload;
  if (!MessageSid || !SmsStatus) {
    throw new Error('Status callback missing MessageSid or SmsStatus.');
  }

  // Update status in DB globally
  const mappedStatus = SmsStatus.toLowerCase();
  const res = await query(
    `UPDATE messages 
     SET status = $1 
     WHERE metadata->>'twilio_message_sid' = $2 
     RETURNING *`,
    [mappedStatus, MessageSid],
    false
  );

  return { success: res.rows.length > 0, messageCount: res.rows.length };
}

module.exports = {
  sendSMS,
  sendWhatsApp,
  handleInboundMessage,
  handleStatusCallback,
  sentMessagesLog
};
