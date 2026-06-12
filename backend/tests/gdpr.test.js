jest.resetModules();
require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');

const TENANT_A_ID = '00000000-0000-0000-0000-111111111111';
const USER_A_ID = '00000000-0000-0000-0000-333333333333';
const LEAD_A_ID = '00000000-0000-0000-0000-aaaaaaaaaaaa';
const MSG_A_ID = '00000000-0000-0000-0000-cccccccccccc';
const MEETING_A_ID = '00000000-0000-0000-0000-dddddddddddd';
const JWT_SECRET = process.env.JWT_SECRET || 'sales_agent_super_secret_token';

let dbMockState = {
  tenant: {
    id: TENANT_A_ID,
    name: 'GDPR Acme Corp',
    data_residency: 'US',
    settings: {
      value_proposition: 'pipeline automation',
      booking_link: 'https://calendly.com/mock-sales-rep'
    }
  },
  lead: {
    id: LEAD_A_ID,
    tenant_id: TENANT_A_ID,
    name: 'GDPR Prospect',
    email: 'prospect@gdpr-test.com',
    phone: '+15551234567',
    company: 'GDPR Target Co',
    title: 'Privacy Director',
    status: 'new',
    sequence_paused: false,
    consent_given: true,
    consent_source: 'Webform',
    updated_at: new Date().toISOString()
  },
  messages: [
    {
      id: MSG_A_ID,
      tenant_id: TENANT_A_ID,
      lead_id: LEAD_A_ID,
      channel: 'email',
      direction: 'outbound',
      content: 'Outbound email content',
      status: 'sent',
      sent_at: new Date().toISOString()
    }
  ],
  meetings: [
    {
      id: MEETING_A_ID,
      tenant_id: TENANT_A_ID,
      lead_id: LEAD_A_ID,
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      booking_link: 'https://calendly.com/mock-sales-rep/meeting',
      status: 'scheduled'
    }
  ],
  audit_logs: [],
  suppression_list: []
};

const mockClient = {
  query: jest.fn().mockImplementation(async (sql, params) => {
    const sqlUpper = sql.toUpperCase();

    if (sqlUpper.includes('SET APP.CURRENT_TENANT_ID') || sqlUpper.includes('RESET APP.CURRENT_TENANT_ID')) {
      return { rows: [] };
    }

    if (sqlUpper.includes('SELECT TENANT_ID FROM')) {
      return { rows: [{ tenant_id: TENANT_A_ID }] };
    }

    if (sqlUpper.includes('SELECT NAME, SETTINGS FROM TENANTS') || sqlUpper.includes('SELECT SETTINGS FROM TENANTS')) {
      return { rows: [dbMockState.tenant] };
    }

    if (sqlUpper.includes('SELECT DATA_RESIDENCY FROM TENANTS')) {
      return { rows: [{ data_residency: dbMockState.tenant.data_residency }] };
    }

    if (sqlUpper.includes('UPDATE TENANTS SET DATA_RESIDENCY')) {
      dbMockState.tenant.data_residency = params[0];
      return { rows: [dbMockState.tenant] };
    }

    if (sqlUpper.includes('SELECT * FROM LEADS WHERE ID')) {
      return { rows: dbMockState.lead ? [dbMockState.lead] : [] };
    }

    if (sqlUpper.includes('SELECT * FROM LEADS WHERE PHONE') || sqlUpper.includes('SELECT * FROM LEADS')) {
      return { rows: dbMockState.lead ? [dbMockState.lead] : [] };
    }

    if (sqlUpper.includes('UPDATE LEADS')) {
      if (sql.includes("[deleted]")) {
        if (dbMockState.lead) {
          dbMockState.lead.name = '[deleted]';
          dbMockState.lead.email = '[deleted]';
          dbMockState.lead.phone = '[deleted]';
        }
      }
      return { rows: [] };
    }

    if (sqlUpper.includes('INSERT INTO LEADS')) {
      const isImport = params.length > 11;
      const newL = {
        id: 'new-lead-uuid',
        tenant_id: params[0],
        name: params[1],
        email: params[2],
        phone: params[3],
        company: params[4],
        title: params[5],
        notes: params[6],
        score: params[7],
        similarity: params[8],
        status: 'new',
        enrichment_data: JSON.parse(params[9]),
        assigned_to: params[10],
        consent_given: params[11],
        consent_source: params[12]
      };
      return { rows: [newL] };
    }

    if (sqlUpper.includes('DELETE FROM MESSAGES WHERE LEAD_ID')) {
      dbMockState.messages = [];
      return { rows: [] };
    }

    if (sqlUpper.includes('SELECT * FROM MESSAGES WHERE LEAD_ID') || sqlUpper.includes('SELECT * FROM MESSAGES')) {
      return { rows: dbMockState.messages };
    }

    if (sqlUpper.includes('SELECT * FROM MEETINGS WHERE LEAD_ID') || sqlUpper.includes('SELECT * FROM MEETINGS')) {
      return { rows: dbMockState.meetings };
    }

    if (sqlUpper.includes('SELECT * FROM AUDIT_LOGS')) {
      // Check if filtering by created_at (for S3 archiving)
      if (sqlUpper.includes('CREATED_AT < NOW()')) {
        return { rows: dbMockState.audit_logs.filter(log => new Date(log.created_at) < new Date(Date.now() - (90 * 24 * 3600 * 1000))) };
      }
      return { rows: dbMockState.audit_logs };
    }

    if (sqlUpper.includes('DELETE FROM AUDIT_LOGS WHERE ID = ANY')) {
      const ids = params[0];
      dbMockState.audit_logs = dbMockState.audit_logs.filter(log => !ids.includes(log.id));
      return { rows: [] };
    }

    if (sqlUpper.includes('INSERT INTO AUDIT_LOGS')) {
      let action = 'UNKNOWN';
      if (sqlUpper.includes("'GDPR_ERASURE'")) action = 'GDPR_ERASURE';
      else if (sqlUpper.includes("'UPDATE_DATA_RESIDENCY'")) action = 'UPDATE_DATA_RESIDENCY';
      else if (sqlUpper.includes("'CREATE_LEAD'")) action = 'CREATE_LEAD';
      else if (sqlUpper.includes("'IMPORT_LEADS'")) action = 'IMPORT_LEADS';
      
      let entityType = 'unknown';
      if (sqlUpper.includes("'leads'")) entityType = 'leads';
      else if (sqlUpper.includes("'tenants'")) entityType = 'tenants';

      let metadata = {};
      let entityId = null;
      for (const p of params) {
        if (typeof p === 'string') {
          if (p.startsWith('{') && p.endsWith('}')) {
            try { metadata = JSON.parse(p); } catch(e) {}
          } else if (p.length === 36 && p.includes('-')) {
            if (p !== params[0] && p !== params[1]) {
              entityId = p;
            }
          }
        }
      }

      if (action === 'UNKNOWN') {
        action = params[2] || 'UNKNOWN';
      }
      if (entityType === 'unknown') {
        entityType = params[3] || 'unknown';
      }
      if (!entityId) {
        entityId = params[4] || null;
      }
      if (Object.keys(metadata).length === 0 && params[5]) {
        try { metadata = JSON.parse(params[5]); } catch(e) {}
      }

      const newAudit = {
        id: 'inserted-audit-uuid',
        tenant_id: params[0],
        user_id: params[1],
        action,
        entity_type: entityType,
        entity_id: entityId,
        metadata,
        created_at: new Date().toISOString()
      };
      dbMockState.audit_logs.push(newAudit);
      return { rows: [newAudit] };
    }

    if (sqlUpper.includes('INSERT INTO SUPPRESSION_LIST')) {
      const newSup = {
        id: 'sup-uuid',
        tenant_id: params[0],
        email: params[1],
        reason: params[2],
        created_at: new Date().toISOString()
      };
      dbMockState.suppression_list.push(newSup);
      return { rows: [newSup] };
    }

    if (sqlUpper.includes('SELECT 1 FROM SUPPRESSION_LIST WHERE EMAIL')) {
      const matched = dbMockState.suppression_list.some(s => s.email === params[0].toLowerCase().trim());
      return { rows: matched ? [{ 1: 1 }] : [] };
    }

    if (sqlUpper.includes('SELECT * FROM SUPPRESSION_LIST')) {
      return { rows: dbMockState.suppression_list };
    }

    return { rows: [] };
  }),
  release: jest.fn(),
  escapeLiteral: (val) => `'${val}'`,
};

const mockPool = {
  connect: jest.fn().mockResolvedValue(mockClient),
  query: jest.fn().mockImplementation(async (sql, params) => {
    return mockClient.query(sql, params);
  }),
};

jest.mock('pg', () => {
  return { Pool: jest.fn(() => mockPool) };
});

const app = require('../server');
const gdprService = require('../services/gdprService');
const schedulerService = require('../services/schedulerService');

function generateToken(tenantId, role = 'rep') {
  return jwt.sign(
    { userId: USER_A_ID, tenantId, tenant_id: tenantId, role, email: 'rep@gdpr-saas.com' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('GDPR Compliance Module Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.query.mockClear();
    dbMockState.lead = {
      id: LEAD_A_ID,
      tenant_id: TENANT_A_ID,
      name: 'GDPR Prospect',
      email: 'prospect@gdpr-test.com',
      phone: '+15551234567',
      company: 'GDPR Target Co',
      title: 'Privacy Director',
      status: 'new',
      sequence_paused: false,
      consent_given: true,
      consent_source: 'Webform',
      updated_at: new Date().toISOString()
    };
    dbMockState.messages = [
      {
        id: MSG_A_ID,
        tenant_id: TENANT_A_ID,
        lead_id: LEAD_A_ID,
        channel: 'email',
        direction: 'outbound',
        content: 'Outbound email content',
        status: 'sent',
        sent_at: new Date().toISOString()
      }
    ];
    dbMockState.meetings = [
      {
        id: MEETING_A_ID,
        tenant_id: TENANT_A_ID,
        lead_id: LEAD_A_ID,
        scheduled_at: new Date(Date.now() + 86400000).toISOString(),
        booking_link: 'https://calendly.com/mock-sales-rep/meeting',
        status: 'scheduled'
      }
    ];
    dbMockState.tenant.data_residency = 'US';
    dbMockState.audit_logs = [];
    dbMockState.suppression_list = [];
  });

  describe('Feature 1: Right to erasure (DELETE /api/leads/:id/personal-data)', () => {
    it('should anonymize name/email/phone, cascade delete messages, cancel scheduled sequences, and write audit log', async () => {
      // Pre-populate mock scheduler timeouts to verify sequence cancellation
      await schedulerService.scheduleFollowUps(TENANT_A_ID, LEAD_A_ID);
      expect(schedulerService.mockJobs.get(LEAD_A_ID)).toBeDefined();

      const token = generateToken(TENANT_A_ID, 'admin');
      const response = await request(app)
        .delete(`/api/leads/${LEAD_A_ID}/personal-data`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify lead anonymization occurred
      expect(dbMockState.lead.name).toBe('[deleted]');
      expect(dbMockState.lead.email).toBe('[deleted]');
      expect(dbMockState.lead.phone).toBe('[deleted]');

      // Verify messages were deleted
      expect(dbMockState.messages.length).toBe(0);

      // Verify follow-ups sequence was cancelled
      expect(schedulerService.mockJobs.get(LEAD_A_ID)).toBeUndefined();

      // Verify audit logs was created with GDPR_ERASURE action
      const erasureLog = dbMockState.audit_logs.find(log => log.action === 'GDPR_ERASURE');
      expect(erasureLog).toBeDefined();
      expect(erasureLog.entity_id).toBe(LEAD_A_ID);
    });

    it('should fall back to standard non-/api prefix endpoint correctly', async () => {
      const token = generateToken(TENANT_A_ID, 'admin');
      const response = await request(app)
        .delete(`/leads/${LEAD_A_ID}/personal-data`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 if the lead does not exist', async () => {
      dbMockState.lead = null; // simulate lead not found
      const token = generateToken(TENANT_A_ID, 'admin');
      const response = await request(app)
        .delete(`/api/leads/${LEAD_A_ID}/personal-data`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('not found');
    });
  });

  describe('Feature 2: Data Portability Export (GET /api/leads/:id/export)', () => {
    it('should export all stored lead, message, meeting, and audit log data in JSON format', async () => {
      // Populate audit logs for this lead
      dbMockState.audit_logs.push({
        id: 'audit-log-uuid-1',
        tenant_id: TENANT_A_ID,
        action: 'CREATE_LEAD',
        entity_type: 'leads',
        entity_id: LEAD_A_ID,
        created_at: new Date().toISOString()
      });

      const token = generateToken(TENANT_A_ID, 'rep');
      const response = await request(app)
        .get(`/api/leads/${LEAD_A_ID}/export`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.lead.name).toBe('GDPR Prospect');
      expect(response.body.messages.length).toBe(1);
      expect(response.body.meetings.length).toBe(1);
      expect(response.body.audit_logs.length).toBe(1);
    });

    it('should fallback to standard non-/api export endpoint correctly', async () => {
      const token = generateToken(TENANT_A_ID, 'rep');
      const response = await request(app)
        .get(`/leads/${LEAD_A_ID}/export`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.lead).toBeDefined();
    });
  });

  describe('Feature 3: Consent Tracking', () => {
    it('should store consent_given and consent_source on lead creation', async () => {
      const token = generateToken(TENANT_A_ID, 'rep');
      const response = await request(app)
        .post('/api/leads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Consent Prospect',
          email: 'consent@prospect.com',
          phone: '+15558887777',
          consent_given: true,
          consent_source: 'API Signup Form'
        });

      expect(response.status).toBe(201);
      expect(response.body.consent_given).toBe(true);
      expect(response.body.consent_source).toBe('API Signup Form');
    });

    it('should default consent_given to false if not provided on creation', async () => {
      const token = generateToken(TENANT_A_ID, 'rep');
      const response = await request(app)
        .post('/api/leads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'No Consent Prospect',
          email: 'noconsent@prospect.com'
        });

      expect(response.status).toBe(201);
      expect(response.body.consent_given).toBe(false);
    });

    it('should block scheduler follow-up and twilio outreach if consent_given is false', async () => {
      dbMockState.lead.consent_given = false;

      // Import twilioService and schedulerService follow-up to test blocking
      const twilioService = require('../services/twilioService');
      const smsRes = await twilioService.sendSMS(TENANT_A_ID, LEAD_A_ID, 'Hello Outreach SMS');
      expect(smsRes).toBeNull(); // blocked!

      const waRes = await twilioService.sendWhatsApp(TENANT_A_ID, LEAD_A_ID, 'Hello Outreach WhatsApp');
      expect(waRes).toBeNull(); // blocked!

      // Trigger follow-up scheduler job directly, should do nothing
      mockClient.query.mockClear();
      await schedulerService.processFollowUpJob(TENANT_A_ID, LEAD_A_ID, 'breakup');
      
      // Verify no message insert queries were made
      const hasInsertMessage = mockClient.query.mock.calls.some(call =>
        call[0].toUpperCase().includes('INSERT INTO MESSAGES')
      );
      expect(hasInsertMessage).toBe(false);
    });
  });

  describe('Feature 4: Data Residency Toggle', () => {
    it('should retrieve US or EU data residency settings correctly', async () => {
      const token = generateToken(TENANT_A_ID, 'admin');
      const response = await request(app)
        .get('/api/settings/data-residency')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data_residency).toBe('US');
    });

    it('should toggle and save data residency US -> EU successfully', async () => {
      const token = generateToken(TENANT_A_ID, 'admin');
      const response = await request(app)
        .post('/api/settings/data-residency')
        .set('Authorization', `Bearer ${token}`)
        .send({ data_residency: 'EU' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data_residency).toBe('EU');
      expect(dbMockState.tenant.data_residency).toBe('EU');

      // Verify audit logs logged this residency change
      const residencyAudit = dbMockState.audit_logs.find(log => log.action === 'UPDATE_DATA_RESIDENCY');
      expect(residencyAudit).toBeDefined();
    });

    it('should reject invalid region values', async () => {
      const token = generateToken(TENANT_A_ID, 'admin');
      const response = await request(app)
        .post('/api/settings/data-residency')
        .set('Authorization', `Bearer ${token}`)
        .send({ data_residency: 'ASIA' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('must be US or EU');
    });
  });

  describe('Feature 5: Audit Log Retention S3 Archiving', () => {
    it('should manually trigger archiving of logs older than 90 days and clear them from DB', async () => {
      // Mock old log
      dbMockState.audit_logs.push({
        id: 'old-log-uuid-99',
        tenant_id: TENANT_A_ID,
        action: 'CREATE_LEAD',
        entity_type: 'leads',
        created_at: new Date(Date.now() - (100 * 24 * 3600 * 1000)).toISOString() // 100 days ago
      });
      // Mock fresh log
      dbMockState.audit_logs.push({
        id: 'fresh-log-uuid-1',
        tenant_id: TENANT_A_ID,
        action: 'CREATE_LEAD',
        entity_type: 'leads',
        created_at: new Date().toISOString()
      });

      const token = generateToken(TENANT_A_ID, 'admin');
      const response = await request(app)
        .post('/api/gdpr/archive-audit-logs')
        .set('Authorization', `Bearer ${token}`)
        .send({ olderThanDays: 90 });

      expect(response.status).toBe(200);
      expect(response.body.archivedCount).toBe(1);
      expect(response.body.s3Key).toBeDefined();

      // Verify the old log has been removed from DB state, and new log remains
      const oldLogExists = dbMockState.audit_logs.some(log => log.id === 'old-log-uuid-99');
      const freshLogExists = dbMockState.audit_logs.some(log => log.id === 'fresh-log-uuid-1');
      expect(oldLogExists).toBe(false);
      expect(freshLogExists).toBe(true);
    });

    it('should reject retention periods less than 90 days', async () => {
      const token = generateToken(TENANT_A_ID, 'admin');
      const response = await request(app)
        .post('/api/gdpr/archive-audit-logs')
        .set('Authorization', `Bearer ${token}`)
        .send({ olderThanDays: 45 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Minimum retention period is 90 days');
    });
  });

  describe('Feature 6: Suppression List', () => {
    it('should retrieve lists and allow adding emails manually to the suppression list', async () => {
      const token = generateToken(TENANT_A_ID, 'admin');
      
      // 1. Verify list is initially empty
      let response = await request(app)
        .get('/api/gdpr/suppression-list')
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(200);
      expect(response.body.length).toBe(0);

      // 2. Add an email to suppression list
      response = await request(app)
        .post('/api/gdpr/suppression-list')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'blockme@suppressed.com', reason: 'Unsubscribed' });

      expect(response.status).toBe(201);
      expect(response.body.email).toBe('blockme@suppressed.com');
      expect(dbMockState.suppression_list.length).toBe(1);

      // 3. Verify SMS is now blocked for lead with suppressed email
      dbMockState.lead.email = 'blockme@suppressed.com';
      const twilioService = require('../services/twilioService');
      const smsRes = await twilioService.sendSMS(TENANT_A_ID, LEAD_A_ID, 'Hello suppressed lead');
      expect(smsRes).toBeNull(); // blocked!
    });
  });
});
