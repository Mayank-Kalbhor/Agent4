const crypto = require('crypto');
const { query, tenantStorage } = require('../db/db');
const { encrypt, decrypt } = require('../utils/encryption');

/**
 * Returns OAuth redirect URL to connect user's Gmail account.
 */
function getOAuthUrl(tenantId, userId) {
  const redirectUri = process.env.GMAIL_REDIRECT_URI || 'http://localhost:5000/api/integrations/gmail/callback';
  const state = JSON.stringify({ tenantId, userId });
  const scopes = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly'
  ].join(' ');

  const clientId = process.env.GMAIL_CLIENT_ID;
  if (!clientId) {
    // Return simulated OAuth url for offline/test mode
    return `https://accounts.google.com/o/oauth2/v2/auth/mock?client_id=mock_id&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`;
  }

  return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`;
}

/**
 * Registers Gmail Push Notifications Watch via Google Cloud Pub/Sub
 */
async function registerGmailWatch(tenantId, userId, accessToken) {
  const topicName = process.env.GMAIL_PUB_SUB_TOPIC;
  if (!topicName) {
    console.log('Skipping watch registration: GMAIL_PUB_SUB_TOPIC is not set.');
    return { mockWatch: true };
  }

  if (!process.env.GMAIL_CLIENT_ID) {
    return { historyId: 'mock_history_id_watch' };
  }

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/watch', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ topicName })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to register Gmail watch: ${errText}`);
  }

  return await response.json();
}

/**
 * Handles OAuth callback code exchange.
 */
async function handleCallback(code, tenantId, userId) {
  let tokens = {
    access_token: 'mock_gmail_access_token_123',
    refresh_token: 'mock_gmail_refresh_token_123',
    expires_in: 3600
  };
  let emailAddress = 'rep@company.com';

  if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET) {
    const redirectUri = process.env.GMAIL_REDIRECT_URI || 'http://localhost:5000/api/integrations/gmail/callback';
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GMAIL_CLIENT_ID,
        client_secret: process.env.GMAIL_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      }).toString()
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gmail OAuth token exchange failed: ${errText}`);
    }

    tokens = await response.json();

    // Get user email
    const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { 'Authorization': `Bearer ${tokens.access_token}` }
    });
    if (profileRes.ok) {
      const profile = await profileRes.json();
      emailAddress = profile.emailAddress;
    }
  }

  // Encrypt refresh token
  const encrypted = encrypt(tokens.refresh_token);
  const gmailSettings = {
    email: emailAddress,
    access_token: tokens.access_token,
    expires_at: Date.now() + (tokens.expires_in * 1000),
    encrypted_refresh_token: encrypted.encryptedData,
    iv: encrypted.iv,
    status: 'active',
    updated_at: Date.now()
  };

  await tenantStorage.run({ tenantId }, async () => {
    await query(
      "UPDATE users SET integration_settings = integration_settings || $1::jsonb WHERE id = $2",
      [JSON.stringify({ gmail: gmailSettings }), userId]
    );

    // Audit log
    await query(`
      INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
      VALUES ($1, $2, 'CONNECT_GMAIL_INTEGRATION', 'users', $2, $3)
    `, [tenantId, userId, JSON.stringify({ success: true, email: emailAddress })]);
  });

  // Try watch registration
  try {
    await registerGmailWatch(tenantId, userId, tokens.access_token);
  } catch (err) {
    console.error(`Gmail watch registration warning: ${err.message}`);
  }

  return { emailAddress };
}

/**
 * Disables Gmail integration when token refresh fails.
 */
async function handleDeactivatedIntegration(tenantId, userId, reason) {
  console.warn(`Deactivating Gmail integration for user ${userId}. Reason: ${reason}`);
  
  await query(
    "UPDATE users SET integration_settings = jsonb_set(integration_settings, '{gmail,status}', '\"inactive\"', false) WHERE id = $1",
    [userId]
  );

  await query(`
    INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
    VALUES ($1, $2, 'GMAIL_INTEGRATION_DEACTIVATED', 'users', $2, $3)
  `, [tenantId, userId, JSON.stringify({ reason })]);
}

/**
 * Returns a fresh access token, refreshing it automatically if expired.
 */
async function getFreshAccessToken(tenantId, userId) {
  const userRes = await query('SELECT integration_settings FROM users WHERE id = $1', [userId]);
  if (userRes.rows.length === 0) {
    throw new Error('User not found.');
  }

  const settings = userRes.rows[0].integration_settings?.gmail;
  if (!settings || settings.status !== 'active') {
    throw new Error('Gmail integration is not connected or is inactive.');
  }

  if (settings.access_token && settings.expires_at > Date.now() + 60000) {
    return settings.access_token;
  }

  if (!settings.encrypted_refresh_token || !settings.iv) {
    throw new Error('No refresh token found for Gmail integration.');
  }

  // Decrypt refresh token
  let refreshToken;
  try {
    refreshToken = decrypt(settings.encrypted_refresh_token, settings.iv);
  } catch (err) {
    throw new Error(`Failed to decrypt Gmail refresh token: ${err.message}`);
  }

  let access_token = 'mock_gmail_access_token_refreshed_123';
  let expires_in = 3600;

  if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET) {
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GMAIL_CLIENT_ID,
          client_secret: process.env.GMAIL_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token'
        }).toString()
      });

      if (!response.ok) {
        const errText = await response.text();
        const errJson = JSON.parse(errText || '{}');
        
        if (errJson.error === 'invalid_grant' || response.status === 400 || response.status === 401) {
          await handleDeactivatedIntegration(tenantId, userId, `OAuth validation failed: ${errJson.error_description || errJson.error}`);
        }
        throw new Error(`Gmail token refresh failed: ${errText}`);
      }

      const refreshData = await response.json();
      access_token = refreshData.access_token;
      expires_in = refreshData.expires_in;
    } catch (err) {
      console.error('Failed to auto-refresh Gmail access token:', err.message);
      throw err;
    }
  }

  // Save refreshed token
  const updatedGmail = {
    ...settings,
    access_token,
    expires_at: Date.now() + (expires_in * 1000),
    updated_at: Date.now()
  };

  await query(
    "UPDATE users SET integration_settings = integration_settings || $1::jsonb WHERE id = $2",
    [JSON.stringify({ gmail: updatedGmail }), userId]
  );

  return access_token;
}

/**
 * Compiles and sends a raw MIME/RFC 822 email message using the user's Gmail profile.
 */
async function sendEmail(tenantId, userId, leadId, leadEmail, subject, htmlBody, listUnsubscribeHeader = null) {
  const accessToken = await getFreshAccessToken(tenantId, userId);
  
  // Custom unique Message-ID header for thread correlation
  const uniqueMsgId = `<${crypto.randomUUID()}@saas-sales-agent.com>`;
  
  // Build standard RFC 822 compilation
  const emailLines = [];
  emailLines.push(`To: ${leadEmail}`);
  emailLines.push(`Subject: ${subject}`);
  emailLines.push(`Message-ID: ${uniqueMsgId}`);
  emailLines.push(`MIME-Version: 1.0`);
  if (listUnsubscribeHeader) {
    emailLines.push(`List-Unsubscribe: ${listUnsubscribeHeader}`);
  }
  emailLines.push(`Content-Type: text/html; charset=utf-8`);
  emailLines.push(`Content-Transfer-Encoding: 7bit`);
  emailLines.push(``);
  emailLines.push(htmlBody);
  
  const rawEmail = emailLines.join('\r\n');
  const base64SafeEmail = Buffer.from(rawEmail)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  let gmailMessageId = 'mock_gmail_msg_id_' + Date.now();
  let gmailThreadId = 'mock_gmail_thread_id_' + Date.now();

  if (process.env.GMAIL_CLIENT_ID) {
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ raw: base64SafeEmail })
    });

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 429) {
        throw new Error('Gmail API rate limit exceeded. Please try again later.');
      }
      throw new Error(`Failed to send email via Gmail API: ${errText}`);
    }

    const result = await response.json();
    gmailMessageId = result.id;
    gmailThreadId = result.threadId;
  }

  // Create message record
  const messageRecord = await tenantStorage.run({ tenantId }, async () => {
    const queryStr = `
      INSERT INTO messages (tenant_id, lead_id, channel, direction, content, status, subject, metadata)
      VALUES ($1, $2, 'email', 'outbound', $3, 'sent', $4, $5)
      RETURNING *;
    `;
    const metadata = {
      gmail_message_id: uniqueMsgId,
      gmail_internal_id: gmailMessageId,
      gmail_thread_id: gmailThreadId,
      list_unsubscribe: listUnsubscribeHeader
    };
    const res = await query(queryStr, [tenantId, leadId, htmlBody, subject, JSON.stringify(metadata)]);
    
    await query(`
      INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
      VALUES ($1, $2, 'SEND_GMAIL_OUTREACH', 'messages', $3, $4)
    `, [tenantId, userId, res.rows[0].id, JSON.stringify({ gmail_message_id: uniqueMsgId, gmail_thread_id: gmailThreadId })]);

    return res.rows[0];
  });

  return messageRecord;
}

/**
 * Strips quoted reply blocks and trailing email signatures.
 */
function stripQuotedReply(text) {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  const cleanLines = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    // Stop at common quote indicators
    if (
      trimmed.startsWith('>') ||
      trimmed.startsWith('-----') ||
      (trimmed.toLowerCase().startsWith('on ') && trimmed.toLowerCase().endsWith(' wrote:')) ||
      trimmed.toLowerCase().startsWith('from:') ||
      trimmed.toLowerCase().startsWith('sent:') ||
      trimmed.toLowerCase().startsWith('to:') ||
      trimmed.toLowerCase().startsWith('subject:')
    ) {
      break;
    }
    cleanLines.push(line);
  }
  return cleanLines.join('\n').trim();
}

/**
 * Helper to parse fields from Gmail message resource details
 */
function parseGmailMessageDetail(detail) {
  const headers = detail.payload?.headers || [];
  const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value;

  const messageId = getHeader('Message-ID');
  const inReplyTo = getHeader('In-Reply-To');
  const from = getHeader('From');
  const subject = getHeader('Subject');

  let body = '';
  if (detail.payload?.body?.data) {
    body = Buffer.from(detail.payload.body.data, 'base64').toString('utf8');
  } else if (detail.payload?.parts) {
    const plainPart = detail.payload.parts.find(p => p.mimeType === 'text/plain');
    if (plainPart?.body?.data) {
      body = Buffer.from(plainPart.body.data, 'base64').toString('utf8');
    }
  }

  return {
    messageId,
    threadId: detail.threadId,
    inReplyTo,
    from,
    subject,
    body
  };
}

/**
 * Decodes Google Cloud Pub/Sub push notification webhooks, fetches message contents, and dispatches them.
 */
async function processPubSubNotification(pubSubPayload) {
  let emailAddress;
  let historyId;
  
  if (pubSubPayload.message && pubSubPayload.message.data) {
    const dataJson = Buffer.from(pubSubPayload.message.data, 'base64').toString('utf8');
    const parsedData = JSON.parse(dataJson);
    emailAddress = parsedData.emailAddress;
    historyId = parsedData.historyId;
  } else {
    emailAddress = pubSubPayload.emailAddress;
    historyId = pubSubPayload.historyId;
  }

  if (!emailAddress) {
    throw new Error('Email address context missing in Pub/Sub notification.');
  }

  const userRes = await query(
    "SELECT id, tenant_id FROM users WHERE integration_settings->'gmail'->>'email' = $1",
    [emailAddress],
    false
  );
  if (userRes.rows.length === 0) {
    throw new Error(`No connected user found for Gmail address: ${emailAddress}`);
  }

  const user = userRes.rows[0];
  const tenantId = user.tenant_id;
  const userId = user.id;

  let incomingMsgDetails = [];

  if (process.env.GMAIL_CLIENT_ID) {
    const accessToken = await getFreshAccessToken(tenantId, userId);
    
    const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    if (!listRes.ok) {
      throw new Error(`Failed to list Gmail messages: ${await listRes.text()}`);
    }

    const listData = await listRes.json();
    const messages = listData.messages || [];

    for (const msg of messages) {
      const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (detailRes.ok) {
        const detail = await detailRes.json();
        incomingMsgDetails.push(parseGmailMessageDetail(detail));
      }
    }
  } else {
    // Mock Mode
    if (pubSubPayload.mockMessage) {
      incomingMsgDetails.push(pubSubPayload.mockMessage);
    } else {
      incomingMsgDetails.push({
        messageId: 'mock_incoming_gmail_msg_id',
        threadId: 'mock_incoming_gmail_thread_id',
        inReplyTo: '<mock_parent_msg_id@saas-sales-agent.com>',
        from: 'prospect@acme.com',
        subject: 'Re: Meeting Booking Link',
        body: 'Yes, I am interested in a meeting. Let\'s schedule.\n\nOn 2026-06-11, rep wrote:\n> ...'
      });
    }
  }

  const processedRecords = [];

  for (const msg of incomingMsgDetails) {
    const { messageId: gmailMsgId, threadId: gmailThreadId, inReplyTo, from: senderEmail, subject, body } = msg;

    if (!inReplyTo) {
      console.log(`Skipping threading check: In-Reply-To header is missing.`);
      continue;
    }

    // Find parent outbound message in database (using In-Reply-To correlation)
    const parentRes = await query(
      "SELECT id, tenant_id, lead_id FROM messages WHERE direction = 'outbound' AND metadata->>'gmail_message_id' = $1",
      [inReplyTo],
      false
    );

    if (parentRes.rows.length === 0) {
      console.log(`Skipping message: No matching outbound thread found for In-Reply-To: ${inReplyTo}`);
      continue;
    }

    const parentMsg = parentRes.rows[0];
    const leadId = parentMsg.lead_id;
    const activeTenantId = parentMsg.tenant_id;

    const cleanBody = stripQuotedReply(body);

    const inboundRecord = await tenantStorage.run({ tenantId: activeTenantId }, async () => {
      const insertStr = `
        INSERT INTO messages (tenant_id, lead_id, channel, direction, content, status, subject, metadata)
        VALUES ($1, $2, 'email', 'inbound', $3, 'received', $4, $5)
        RETURNING *;
      `;
      const metadata = {
        gmail_message_id: gmailMsgId,
        gmail_thread_id: gmailThreadId,
        in_reply_to: inReplyTo
      };
      const insertRes = await query(insertStr, [activeTenantId, leadId, cleanBody, subject, JSON.stringify(metadata)]);
      
      await query(`
        INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
        VALUES ($1, NULL, 'RECEIVE_GMAIL_REPLY', 'messages', $2, $3)
      `, [activeTenantId, insertRes.rows[0].id, JSON.stringify({ gmail_message_id: gmailMsgId, lead_id: leadId })]);

      return insertRes.rows[0];
    });

    // Run reply detection pipeline
    const { processInboundMessage } = require('./replyDetectionService');
    await processInboundMessage(inboundRecord);

    processedRecords.push(inboundRecord);
  }

  return processedRecords;
}

module.exports = {
  getOAuthUrl,
  handleCallback,
  getFreshAccessToken,
  sendEmail,
  stripQuotedReply,
  processPubSubNotification
};
