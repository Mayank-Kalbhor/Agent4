jest.resetModules();
require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');

const TENANT_A_ID = '00000000-0000-0000-0000-111111111111';
const USER_A_ID = '00000000-0000-0000-0000-333333333333';
const LEAD_A_ID = '00000000-0000-0000-0000-aaaaaaaaaaaa';
const MSG_A_ID = '00000000-0000-0000-0000-cccccccccccc';
const JWT_SECRET = process.env.JWT_SECRET || 'sales_agent_super_secret_token';

let dbMockState = {
  tenantSettings: {
    value_proposition: 'pipeline automation',
    booking_link: 'https://calendly.com/mock-sales-rep'
  },
  lead: {
    id: LEAD_A_ID,
    tenant_id: TENANT_A_ID,
    name: 'Twilio Prospect',
    email: 'prospect@twilio-test.com',
    phone: '+15551234567',
    company: 'Twilio Target Co',
    title: 'Outreach Manager',
    status: 'new',
    sequence_paused: false,
    consent_given: true,
    updated_at: new Date().toISOString()
  },
  latestEmail: {
    id: MSG_A_ID,
    tenant_id: TENANT_A_ID,
    lead_id: LEAD_A_ID,
    channel: 'email',
    direction: 'outbound',
    content: 'Initial email copy',
    status: 'sent',
    opened_at: null
  }
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
      return { rows: [{ name: 'Acme Corp', settings: dbMockState.tenantSettings }] };
    }

    if (sqlUpper.includes('SELECT * FROM LEADS WHERE ID')) {
      return { rows: [dbMockState.lead] };
    }

    if (sqlUpper.includes('SELECT * FROM LEADS WHERE PHONE') || sqlUpper.includes('SELECT * FROM LEADS')) {
      return { rows: [dbMockState.lead] };
    }

    if (sqlUpper.includes('SELECT * FROM MESSAGES WHERE LEAD_ID') || sqlUpper.includes('SELECT * FROM MESSAGES')) {
      return { rows: [dbMockState.latestEmail] };
    }

    if (sqlUpper.includes('INSERT INTO MESSAGES')) {
      return { rows: [{ id: 'inserted-msg-uuid' }] };
    }

    if (sqlUpper.includes('INSERT INTO AUDIT_LOGS')) {
      return { rows: [{ id: 'inserted-audit-uuid' }] };
    }

    if (sqlUpper.includes('UPDATE LEADS') || sqlUpper.includes('UPDATE MESSAGES') || sqlUpper.includes('UPDATE TENANTS')) {
      return { rows: [] };
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

const originalFetch = global.fetch;

const app = require('../server');
const twilioService = require('../services/twilioService');
const schedulerService = require('../services/schedulerService');

function generateToken(tenantId) {
  return jwt.sign(
    { userId: USER_A_ID, tenantId, tenant_id: tenantId, role: 'rep', email: 'rep@saas.com' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('Twilio Integration & Multi-Channel Messaging Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.query.mockClear();
    dbMockState.lead.status = 'new';
    dbMockState.lead.sequence_paused = false;
    dbMockState.latestEmail.opened_at = null;
    twilioService.sentMessagesLog.length = 0;
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('Outbound Messaging Functions (Mock & Credentials Modes)', () => {
    it('sendSMS — should send simulated SMS in Mock Mode (no credentials)', async () => {
      const res = await twilioService.sendSMS(TENANT_A_ID, LEAD_A_ID, 'Hello SMS follow-up!');
      expect(res.sid).toContain('mock_sms_sid_');
      expect(twilioService.sentMessagesLog.length).toBe(1);
      expect(twilioService.sentMessagesLog[0].body).toBe('Hello SMS follow-up!');

      // Verify DB storage and audits
      const hasInsert = mockClient.query.mock.calls.some(call =>
        call[0].toUpperCase().includes('INSERT INTO MESSAGES') &&
        call[0].includes("'sms'") &&
        call[1][2] === 'Hello SMS follow-up!'
      );
      expect(hasInsert).toBe(true);
    });

    it('sendSMS — should call Twilio API with credentials configured', async () => {
      process.env.TWILIO_ACCOUNT_SID = 'AC123';
      process.env.TWILIO_AUTH_TOKEN = 'auth_token_secret';

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sid: 'SM_twilio_sid_789', status: 'sent' })
      });

      const res = await twilioService.sendSMS(TENANT_A_ID, LEAD_A_ID, 'Hello Twilio API!');
      expect(res.sid).toBe('SM_twilio_sid_789');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/Accounts/AC123/Messages.json'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('To=%2B15551234567')
        })
      );

      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;
    });

    it('sendWhatsApp — should format To/From correctly with whatsapp: prefix', async () => {
      process.env.TWILIO_ACCOUNT_SID = 'AC123';
      process.env.TWILIO_AUTH_TOKEN = 'auth_token_secret';

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sid: 'WA_twilio_sid_999', status: 'sent' })
      });

      const res = await twilioService.sendWhatsApp(TENANT_A_ID, LEAD_A_ID, 'Hello WhatsApp!');
      expect(res.sid).toBe('WA_twilio_sid_999');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/Accounts/AC123/Messages.json'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('To=whatsapp%3A%2B15551234567')
        })
      );

      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;
    });
  });

  describe('Inbound Webhook Parsing & Reply Router', () => {
    it('handleInboundMessage — detects STOP opt-out and flags opted_out + cancels follow-ups', async () => {
      // Setup scheduler mock jobs to verify cancellation
      await schedulerService.scheduleFollowUps(TENANT_A_ID, LEAD_A_ID, { follow_up_1: 10000, follow_up_2: 20000, breakup: 30000 });
      expect(schedulerService.mockJobs.get(LEAD_A_ID)).toBeDefined();

      const payload = {
        MessageSid: 'SM_inbound_optout_111',
        From: '+15551234567',
        To: '+15559998888',
        Body: '  sToP Please '
      };

      const result = await twilioService.handleInboundMessage(payload);
      expect(result.success).toBe(true);
      expect(result.action).toBe('opt_out');

      // Verify lead status updated to opted_out
      const hasUpdateStatus = mockClient.query.mock.calls.some(call =>
        call[0].toUpperCase().includes('UPDATE LEADS') &&
        call[0].toUpperCase().includes("STATUS = 'OPTED_OUT'")
      );
      expect(hasUpdateStatus).toBe(true);

      // Verify follow-ups cancelled
      expect(schedulerService.mockJobs.get(LEAD_A_ID)).toBeUndefined();

      // Verify opt-out audit logging
      const hasOptOutAudit = mockClient.query.mock.calls.some(call =>
        call[0].toUpperCase().includes('INSERT INTO AUDIT_LOGS') &&
        call[0].toUpperCase().includes('LEAD_OPT_OUT_TWILIO')
      );
      expect(hasOptOutAudit).toBe(true);
    });

    it('handleInboundMessage — processes standard reply and triggers classification & auto booking response', async () => {
      // Setup scheduler mock jobs to verify cancellation
      await schedulerService.scheduleFollowUps(TENANT_A_ID, LEAD_A_ID, { follow_up_1: 10000, follow_up_2: 20000, breakup: 30000 });

      const payload = {
        MessageSid: 'SM_inbound_normal_222',
        From: 'whatsapp:+15551234567',
        To: 'whatsapp:+14155238886',
        Body: 'Yes, I would love to schedule a demo chat.'
      };

      const result = await twilioService.handleInboundMessage(payload);
      expect(result.success).toBe(true);
      expect(result.action).toBe('reply_classified');
      expect(result.intent).toBe('interested');

      // Verify mock booking link replied on same channel (whatsapp)
      expect(twilioService.sentMessagesLog.length).toBe(1);
      expect(twilioService.sentMessagesLog[0].channel).toBe('whatsapp');
      expect(twilioService.sentMessagesLog[0].body).toContain('https://calendly.com/mock-sales-rep');

      // Verify follow-ups cancelled
      expect(schedulerService.mockJobs.get(LEAD_A_ID)).toBeUndefined();
    });
  });

  describe('Twilio Webhook Controller & Email Tracking Routes', () => {
    it('GET /api/emails/track-open/:messageId — updates opened_at status and returns transparent 1x1 image', async () => {
      const res = await request(app)
        .get(`/api/emails/track-open/${MSG_A_ID}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/gif');

      const hasUpdate = mockClient.query.mock.calls.some(call =>
        call[0].toUpperCase().includes('UPDATE MESSAGES') &&
        call[0].toUpperCase().includes('OPENED_AT = NOW()')
      );
      expect(hasUpdate).toBe(true);
    });

    it('POST /api/simulator/twilio-incoming — simulates inbound webhook delivery trigger', async () => {
      const payload = {
        MessageSid: 'SM_simulated_333',
        From: '+15551234567',
        To: '+15559998888',
        Body: 'What is the standard price?'
      };

      const res = await request(app)
        .post('/api/simulator/twilio-incoming')
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.result.action).toBe('reply_classified');
      expect(res.body.result.intent).toBe('question');
    });

    it('POST /api/simulator/twilio-status — updates delivery status webhook', async () => {
      const payload = {
        MessageSid: 'SM_simulated_outbound_999',
        SmsStatus: 'delivered'
      };

      const res = await request(app)
        .post('/api/simulator/twilio-status')
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const hasUpdate = mockClient.query.mock.calls.some(call =>
        call[0].toUpperCase().includes('UPDATE MESSAGES') &&
        call[0].toUpperCase().includes('STATUS = $1') &&
        call[1][0] === 'delivered'
      );
      expect(hasUpdate).toBe(true);
    });
  });

  describe('Fallback Scheduling Logic Sequence', () => {
    it('processFollowUpJob — follow_up_1: sends SMS if email remains unopened', async () => {
      dbMockState.latestEmail.opened_at = null; // Unopened!

      await schedulerService.processFollowUpJob(TENANT_A_ID, LEAD_A_ID, 'follow_up_1');

      // Verify SMS was sent
      expect(twilioService.sentMessagesLog.length).toBe(1);
      expect(twilioService.sentMessagesLog[0].channel).toBe('sms');
      expect(twilioService.sentMessagesLog[0].body).toContain('I sent you an email');
    });

    it('processFollowUpJob — follow_up_1: skips SMS if email was already opened', async () => {
      dbMockState.latestEmail.opened_at = new Date().toISOString(); // Opened!

      await schedulerService.processFollowUpJob(TENANT_A_ID, LEAD_A_ID, 'follow_up_1');

      // Verify no SMS sent
      expect(twilioService.sentMessagesLog.length).toBe(0);
    });

    it('processFollowUpJob — follow_up_2: sends WhatsApp follow-up if lead has not replied', async () => {
      dbMockState.lead.status = 'contacted'; // No reply yet!

      await schedulerService.processFollowUpJob(TENANT_A_ID, LEAD_A_ID, 'follow_up_2');

      // Verify WhatsApp template message was sent
      expect(twilioService.sentMessagesLog.length).toBe(1);
      expect(twilioService.sentMessagesLog[0].channel).toBe('whatsapp');
      expect(twilioService.sentMessagesLog[0].body).toContain('thanks for connecting with Acme Corp');
    });
  });
});
