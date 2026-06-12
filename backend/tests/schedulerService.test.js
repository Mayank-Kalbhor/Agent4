jest.resetModules();
require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');

const TENANT_A_ID = '00000000-0000-0000-0000-111111111111';
const LEAD_ID = '00000000-0000-0000-0000-aaaaaaaaaaaa';
const MSG_ID = '00000000-0000-0000-0000-111111111112';
const JWT_SECRET = process.env.JWT_SECRET || 'sales_agent_super_secret_token';

// Define a variable to dynamically simulate different lead statuses in tests
let mockLeadStatus = 'new';
let mockLeadPaused = false;

const mockClient = {
  query: jest.fn().mockImplementation(async (sql, params) => {
    const s = (sql || '').toUpperCase();
    if (s.includes('APP.CURRENT_TENANT')) return { rows: [] };
    
    // Lead details lookup
    if (s.includes('SELECT * FROM LEADS WHERE ID') || s.includes('SELECT * FROM LEADS WHERE EMAIL')) {
      return { rows: [{
        id: LEAD_ID,
        tenant_id: TENANT_A_ID,
        name: 'Alice',
        email: 'alice@acme.com',
        title: 'VP of Operations',
        company: 'Acme SaaS',
        status: mockLeadStatus,
        sequence_paused: mockLeadPaused,
        painPoints: ['pipeline follow-up']
      }] };
    }

    // Tenant details lookup
    if (s.includes('SELECT NAME, SETTINGS FROM TENANTS')) {
      return { rows: [{
        name: 'Acme Tenant Corp',
        settings: {
          value_proposition: 'AI outreach scheduling tools',
          booking_link: 'https://calendly.com/acme-sales'
        }
      }] };
    }

    // Inbound reply intent validation check
    if (s.includes('SELECT INTENT FROM MESSAGES')) {
      return { rows: [{ intent: null }] };
    }

    // Message details lookup
    if (s.includes('SELECT * FROM MESSAGES WHERE ID')) {
      return { rows: [{
        id: MSG_ID,
        tenant_id: TENANT_A_ID,
        lead_id: LEAD_ID,
        content: 'I am interested in setting up a meeting.',
        intent: 'interested'
      }] };
    }

    // Prior message lookup for templates
    if (s.includes('FROM MESSAGES WHERE LEAD_ID') && s.includes('ORDER BY SENT_AT')) {
      return { rows: [{ content: 'Initial outreach content' }] };
    }

    if (s.includes('INSERT INTO MESSAGES')) {
      return { rows: [{
        id: MSG_ID,
        tenant_id: (params && params[0]) || TENANT_A_ID,
        lead_id: (params && params[1]) || LEAD_ID,
        content: (params && params[2]) || 'I am interested',
        status: 'received'
      }] };
    }

    if (s.includes('UPDATE MESSAGES') || s.includes('UPDATE LEADS') || s.includes('INSERT INTO AUDIT_LOGS')) {
      return { rows: [{ id: MSG_ID, status: 'sent' }] };
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

// Mock pg module before loading dependencies
jest.mock('pg', () => {
  return { Pool: jest.fn(() => mockPool) };
});

const app = require('../server');
const schedulerService = require('../services/schedulerService');
const replyDetectionService = require('../services/replyDetectionService');

function generateToken(tenantId) {
  return jwt.sign(
    { userId: 'user-001', tenantId, tenant_id: tenantId, role: 'admin', email: 'rep@saas.com' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('Event-Driven Follow-Up Scheduler Tests', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockClient.query.mockClear();
    mockLeadStatus = 'new';
    mockLeadPaused = false;
    // Cancel all timeout jobs in mockJobs to prevent async pollution
    for (const leadId of schedulerService.mockJobs.keys()) {
      await schedulerService.cancelFollowUps(leadId);
    }
    schedulerService.mockJobs.clear();
  });

  describe('1. Core Scheduler functionality (In-Memory Fallback Queue)', () => {
    it('scheduleFollowUps — schedules 3 delayed follow-up jobs (Day 2, Day 5, Day 9)', async () => {
      const customDelays = {
        follow_up_1: 20,
        follow_up_2: 50,
        breakup: 90
      };

      await schedulerService.scheduleFollowUps(TENANT_A_ID, LEAD_ID, customDelays);

      const scheduledJobs = schedulerService.mockJobs.get(LEAD_ID);
      expect(scheduledJobs).toBeDefined();
      expect(scheduledJobs.length).toBe(3);
      
      const templates = scheduledJobs.map(j => j.templateType);
      expect(templates).toContain('follow_up_1');
      expect(templates).toContain('follow_up_2');
      expect(templates).toContain('breakup');
    });

    it('cancelFollowUps — cancels scheduled timeout handles and removes them from the map', async () => {
      const customDelays = { follow_up_1: 2000, follow_up_2: 5000, breakup: 9000 };
      await schedulerService.scheduleFollowUps(TENANT_A_ID, LEAD_ID, customDelays);

      expect(schedulerService.mockJobs.get(LEAD_ID)).toBeDefined();

      await schedulerService.cancelFollowUps(LEAD_ID);
      expect(schedulerService.mockJobs.get(LEAD_ID)).toBeUndefined();
    });
  });

  describe('2. Job Eligibility & Execution Guards', () => {
    it('processFollowUpJob — does not generate outreach if lead status is opted_out', async () => {
      mockLeadStatus = 'opted_out';
      
      await schedulerService.processFollowUpJob(TENANT_A_ID, LEAD_ID, 'follow_up_1');
      
      // Should query the lead details but skip generating emails or audit logging outreach
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM leads WHERE id = $1'),
        [LEAD_ID, TENANT_A_ID]
      );
      const outreachCall = mockClient.query.mock.calls.some(call => call[0].toUpperCase().includes('INSERT INTO MESSAGES'));
      expect(outreachCall).toBe(false);
    });

    it('processFollowUpJob — does not generate outreach if lead follow-up sequence is paused', async () => {
      mockLeadPaused = true;
      
      await schedulerService.processFollowUpJob(TENANT_A_ID, LEAD_ID, 'follow_up_1');
      
      const outreachCall = mockClient.query.mock.calls.some(call => call[0].toUpperCase().includes('INSERT INTO MESSAGES'));
      expect(outreachCall).toBe(false);
    });
  });

  describe('3. Reply Intent Classification & Routing Actions', () => {
    it('classifyIntent — correctly classifies interested responses', async () => {
      const result = await replyDetectionService.classifyIntent('Yes, I want a demo. Can we jump on a call next Tuesday?');
      expect(result.intent).toBe('interested');
    });

    it('classifyIntent — correctly classifies query responses', async () => {
      const result = await replyDetectionService.classifyIntent('What is your pricing model for enterprise plans?');
      expect(result.intent).toBe('question');
    });

    it('processInboundMessage — interested reply routes calendar bookings and cancels followups', async () => {
      const inboundMsg = {
        id: MSG_ID,
        tenant_id: TENANT_A_ID,
        lead_id: LEAD_ID,
        content: 'I want a demo. Send me a calendar link.'
      };

      // Set up mock jobs to verify they get cancelled on reply
      await schedulerService.scheduleFollowUps(TENANT_A_ID, LEAD_ID, { follow_up_1: 1000, follow_up_2: 2000, breakup: 3000 });
      expect(schedulerService.mockJobs.get(LEAD_ID)).toBeDefined();

      await replyDetectionService.processInboundMessage(inboundMsg);

      // Should:
      // 1. Cancel pending followups
      expect(schedulerService.mockJobs.get(LEAD_ID)).toBeUndefined();
      
      // 2. Classify reply and write intent to DB
      const hasUpdateIntent = mockClient.query.mock.calls.some(call => 
        call[0].toUpperCase().includes('UPDATE MESSAGES') && 
        call[0].toUpperCase().includes('INTENT = $1') &&
        call[1][0] === 'interested'
      );
      expect(hasUpdateIntent).toBe(true);

      // 3. Send calendar link (outbound message insert containing booking link)
      const hasCalendarSend = mockClient.query.mock.calls.some(call => 
        call[0].toUpperCase().includes('INSERT INTO MESSAGES') && 
        (call[0].toUpperCase().includes('CALENDAR_LINK_DISPATCH') || 
         (call[1] && JSON.stringify(call[1]).includes('calendar_link_dispatch')))
      );
      expect(hasCalendarSend).toBe(true);
    });

    it('processInboundMessage — question reply flags needs_human_review', async () => {
      const inboundMsg = {
        id: MSG_ID,
        tenant_id: TENANT_A_ID,
        lead_id: LEAD_ID,
        content: 'How much does it cost?'
      };

      await replyDetectionService.processInboundMessage(inboundMsg);

      const hasFlagHuman = mockClient.query.mock.calls.some(call => 
        call[0].toUpperCase().includes('UPDATE MESSAGES') && 
        call[0].toUpperCase().includes('NEEDS_HUMAN_REVIEW = TRUE')
      );
      expect(hasFlagHuman).toBe(true);
    });
  });

  describe('4. Express Integration API Endpoints', () => {
    it('POST /api/leads/:id/pause — pauses follow-ups and cancels scheduler jobs', async () => {
      const token = generateToken(TENANT_A_ID);
      await schedulerService.scheduleFollowUps(TENANT_A_ID, LEAD_ID, { follow_up_1: 1000, follow_up_2: 2000, breakup: 3000 });

      const response = await request(app)
        .post(`/api/leads/${LEAD_ID}/pause`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(schedulerService.mockJobs.get(LEAD_ID)).toBeUndefined();
    });

    it('POST /api/leads/:id/resume — resumes follow-ups and re-schedules jobs', async () => {
      const token = generateToken(TENANT_A_ID);

      const response = await request(app)
        .post(`/api/leads/${LEAD_ID}/resume`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(schedulerService.mockJobs.get(LEAD_ID)).toBeDefined();
    });

    it('POST /api/simulator/incoming-response — classifies content and triggers downstream routing', async () => {
      const token = generateToken(TENANT_A_ID);

      const response = await request(app)
        .post('/api/simulator/incoming-response')
        .set('Authorization', `Bearer ${token}`)
        .send({
          tenantId: TENANT_A_ID,
          leadId: LEAD_ID,
          replyContent: 'I am interested in setting up a meeting.'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message.intent).toBe('interested');

      // Verify outbound calendar link dispatch was run during reply detection routing
      const hasCalendarSend = mockClient.query.mock.calls.some(call => 
        call[0].toUpperCase().includes('INSERT INTO MESSAGES') && 
        (call[0].toUpperCase().includes('CALENDAR_LINK_DISPATCH') || 
         (call[1] && JSON.stringify(call[1]).includes('calendar_link_dispatch')))
      );
      expect(hasCalendarSend).toBe(true);
    });
  });
});
