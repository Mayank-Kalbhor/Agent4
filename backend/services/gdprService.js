const { query, tenantStorage } = require('../db/db');
const crypto = require('crypto');

/**
 * Adds an email to the suppression list for a specific tenant.
 */
async function addToSuppressionList(tenantId, email, reason = 'Opt-out keyword detected') {
  if (!email || email === '[deleted]') return null;
  
  const insertSql = `
    INSERT INTO suppression_list (tenant_id, email, reason)
    VALUES ($1, $2, $3)
    ON CONFLICT (tenant_id, email) 
    DO UPDATE SET reason = EXCLUDED.reason, created_at = CURRENT_TIMESTAMP
    RETURNING *;
  `;
  const res = await query(insertSql, [tenantId, email.toLowerCase().trim(), reason], false);
  return res.rows[0];
}

/**
 * Checks if an email is suppressed for a specific tenant.
 */
async function isSuppressed(tenantId, email) {
  if (!email || email === '[deleted]') return false;
  const sql = 'SELECT 1 FROM suppression_list WHERE email = $1';
  const res = await query(sql, [email.toLowerCase().trim()], tenantId);
  return res.rows.length > 0;
}

/**
 * Executes a GDPR Right to Erasure request on a lead.
 * Anonymizes name, email, and phone with "[deleted]", deletes all related messages,
 * cancels pending sequences, and writes a log to the audit logs.
 */
async function anonymizeLead(tenantId, leadId, userId = null) {
  return await tenantStorage.run({ tenantId }, async () => {
    // 1. Verify existence of lead
    const leadRes = await query('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (leadRes.rows.length === 0) {
      throw new Error('Lead not found or unauthorized.');
    }
    const lead = leadRes.rows[0];

    // 2. Add to suppression list if lead has a valid email before anonymizing
    if (lead.email && lead.email !== '[deleted]') {
      await addToSuppressionList(tenantId, lead.email, 'GDPR Right to Erasure Request');
    }

    // 3. Anonymize personal info in leads table
    await query(
      "UPDATE leads SET name = '[deleted]', email = '[deleted]', phone = '[deleted]', updated_at = NOW() WHERE id = $1",
      [leadId]
    );

    // 4. Cascade delete associated messages
    await query('DELETE FROM messages WHERE lead_id = $1', [leadId]);

    // 5. Cancel scheduled sequences
    const { cancelFollowUps } = require('./schedulerService');
    await cancelFollowUps(leadId);

    // 6. Log erasure in audit_logs table
    await query(`
      INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
      VALUES ($1, $2, 'GDPR_ERASURE', 'leads', $3, $4)
    `, [tenantId, userId, leadId, JSON.stringify({ erased_at: new Date().toISOString() })]);

    return { success: true };
  });
}

/**
 * Exports all stored data associated with a lead for portability.
 */
async function exportLeadData(tenantId, leadId) {
  return await tenantStorage.run({ tenantId }, async () => {
    // Fetch lead details
    const leadRes = await query('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (leadRes.rows.length === 0) {
      throw new Error('Lead not found or unauthorized.');
    }
    const lead = leadRes.rows[0];

    // Fetch message history
    const messagesRes = await query('SELECT * FROM messages WHERE lead_id = $1 ORDER BY sent_at DESC', [leadId]);

    // Fetch meeting history
    const meetingsRes = await query('SELECT * FROM meetings WHERE lead_id = $1 ORDER BY scheduled_at DESC', [leadId]);

    // Fetch audit activities referring to this lead
    const auditLogsRes = await query(
      "SELECT * FROM audit_logs WHERE entity_id = $1 OR (entity_type = 'leads' AND entity_id = $1) ORDER BY created_at DESC",
      [leadId]
    );

    return {
      lead,
      messages: messagesRes.rows,
      meetings: meetingsRes.rows,
      audit_logs: auditLogsRes.rows
    };
  });
}

/**
 * Archives audit logs older than a minimum age (default 90 days) to AWS S3,
 * then purges the archived logs from the active DB table.
 */
async function archiveAuditLogs(olderThanDays = 90) {
  // Retrieve old audit logs globally (bypass RLS)
  const selectSql = `
    SELECT * FROM audit_logs 
    WHERE created_at < NOW() - CAST($1 || ' days' AS INTERVAL)
    ORDER BY created_at ASC;
  `;
  const res = await query(selectSql, [olderThanDays], false);
  const oldLogs = res.rows;

  if (oldLogs.length === 0) {
    return { archivedCount: 0 };
  }

  const payload = JSON.stringify(oldLogs, null, 2);
  const bucket = process.env.GDPR_S3_BUCKET || 'gdpr-audit-logs-archive';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const s3Key = `audit-logs-archive/archive_${timestamp}.json`;

  let uploaded = false;
  let s3Error = null;

  // Attempt upload using AWS SDK if keys are configured
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    try {
      // Attempt v3 SDK first
      const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
      const client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: payload,
        ContentType: 'application/json'
      }));
      uploaded = true;
    } catch (err) {
      try {
        // Fallback to v2 SDK
        const AWS = require('aws-sdk');
        const s3 = new AWS.S3();
        await s3.putObject({
          Bucket: bucket,
          Key: s3Key,
          Body: payload,
          ContentType: 'application/json'
        }).promise();
        uploaded = true;
      } catch (err2) {
        s3Error = err2.message;
        console.error('AWS S3 upload failed in both SDK versions:', err.message, err2.message);
      }
    }
  }

  if (!uploaded) {
    // MOCK S3 ARCHIVE MODE
    console.log(`[S3 Archive Mock] Uploaded ${oldLogs.length} audit logs to S3 bucket "${bucket}" under key "${s3Key}"`);
  }

  // Purge archived records from the database
  const logIds = oldLogs.map(log => log.id);
  await query('DELETE FROM audit_logs WHERE id = ANY($1)', [logIds], false);

  return {
    archivedCount: oldLogs.length,
    s3Key,
    bucket,
    mock: !uploaded,
    error: s3Error
  };
}

module.exports = {
  addToSuppressionList,
  isSuppressed,
  anonymizeLead,
  exportLeadData,
  archiveAuditLogs
};
