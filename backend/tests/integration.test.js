const request = require('supertest');
const jwt = require('jsonwebtoken');

const TENANT_ID = '00000000-0000-0000-0000-111111111111';
const USER_ID = '00000000-0000-0000-0000-222222222222';
const JWT_SECRET = process.env.JWT_SECRET || 'sales_agent_super_secret_token';

// Mock DB states and tracking arrays for queries
let dbQueriesExecuted = [];
let mockLeadsDb = [];

const mockClient = {
  query: jest.fn().mockImplementation(async (sql, params) => {
    dbQueriesExecuted.push({ sql, params });
    const sqlUpper = sql.toUpperCase();

    if (sqlUpper.includes('SET APP.CURRENT_TENANT_ID') || sqlUpper.includes('RESET APP.CURRENT_TENANT_ID')) {
      return { rows: [] };
    }

    if (sqlUpper.includes('SELECT * FROM LEADS WHERE ID')) {
      const leadId = params[0];
      const lead = mockLeadsDb.find(l => l.id === leadId) || { id: leadId, name: 'Imported Lead', email: 'lead@test.com', status: 'new' };
      return { rows: [lead] };
    }

    if (sqlUpper.includes('INSERT INTO LEADS')) {
      const name = params[1];
      const email = params[2];
      const newLead = { id: 'lead-uuid-' + Math.random().toString(36).substr(2, 5), name, email, status: 'new' };
      mockLeadsDb.push(newLead);
      return { rows: [newLead] };
    }

    if (sqlUpper.includes('INSERT INTO MESSAGES')) {
      const direction = sqlUpper.includes("'INBOUND'") ? 'inbound' : 'outbound';
      const status = direction === 'inbound' ? 'received' : 'sent';
      const content = direction === 'inbound' ? params[2] : params[4];
      const leadId = params[1];
      const tenantId = params[0];
      return {
        rows: [{
          id: 'msg-uuid-' + Math.random().toString(36).substr(2, 5),
          tenant_id: tenantId,
          lead_id: leadId,
          direction,
          content: content || 'mock outreach content',
          status
        }]
      };
    }

    if (sqlUpper.includes('UPDATE LEADS SET STATUS')) {
      const leadId = params[0];
      let status = 'new';
      if (sqlUpper.includes("STATUS = 'CONTACTED'")) {
        status = 'contacted';
      } else if (sqlUpper.includes("STATUS = 'REPLIED'")) {
        status = 'replied';
      } else if (sqlUpper.includes("STATUS = 'OPTED_OUT'")) {
        status = 'opted_out';
      } else if (sqlUpper.includes("STATUS = 'MEETING_SCHEDULED'")) {
        status = 'meeting_scheduled';
      } else {
        // Fallback for parameterized status updates
        const paramStatus = params[0];
        const paramLeadId = params[1];
        const lead = mockLeadsDb.find(l => l.id === paramLeadId);
        if (lead) {
          lead.status = paramStatus;
          return { rows: [lead] };
        }
      }

      const lead = mockLeadsDb.find(l => l.id === leadId);
      if (lead) lead.status = status;
      return { rows: [lead || {}] };
    }

    return { rows: [] };
  }),
  release: jest.fn(),
  escapeLiteral: jest.fn((val) => `'${val}'`),
};

const mockPool = {
  connect: jest.fn().mockResolvedValue(mockClient),
  query: jest.fn().mockImplementation(async (sql, params) => {
    return mockClient.query(sql, params);
  }),
};

// Mock the postgres pool
jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPool),
}));

// Mock HubSpot integration service methods directly
jest.mock('../services/hubspotService', () => ({
  syncHubSpot: jest.fn().mockResolvedValue({ success: true, message: 'HubSpot synchronization completed successfully.' }),
  pushLeadUpdate: jest.fn().mockResolvedValue({}),
  createHubSpotDeal: jest.fn().mockResolvedValue({}),
  logEmailActivity: jest.fn().mockResolvedValue({}),
  getOAuthUrl: jest.fn().mockReturnValue('https://app.hubspot.com/oauth/authorize'),
  handleCallback: jest.fn().mockResolvedValue({}),
}));

const app = require('../server');

function generateToken() {
  return jwt.sign(
    { userId: USER_ID, tenantId: TENANT_ID, role: 'admin', email: 'admin@tenant.com' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('AI Sales Agent Integration Tests', () => {
  let token;

  beforeEach(() => {
    jest.clearAllMocks();
    dbQueriesExecuted = [];
    mockLeadsDb = [];
    token = generateToken();
  });

  describe('1. Lead Import Flow', () => {
    it('should successfully import bulk leads and trigger AI lead scoring', async () => {
      const payload = {
        leads: [
          { name: 'John Doe', email: 'john@stripe.com', company: 'Stripe', title: 'VP of Product' },
          { name: 'Jane Smith', email: 'jane@netflix.com', company: 'Netflix', title: 'Director' }
        ]
      };

      const response = await request(app)
        .post('/api/leads/import')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.count).toBe(2);
      expect(mockLeadsDb.length).toBe(2);

      const inserts = dbQueriesExecuted.filter(q => q.sql.toUpperCase().includes('INSERT INTO LEADS'));
      expect(inserts.length).toBe(2);
    });
  });

  describe('2. Outreach Sequence & Simulated Reply Flow', () => {
    it('should transition lead status to contacted on outreach, then replied on incoming webhook', async () => {
      const leadId = 'lead-seq-123';
      mockLeadsDb.push({ id: leadId, name: 'Alice', email: 'alice@test.com', status: 'new' });

      // Step A: Trigger outreach email
      const outreachRes = await request(app)
        .post('/api/messages/send')
        .set('Authorization', `Bearer ${token}`)
        .send({ leadId, channel: 'email' });

      expect(outreachRes.status).toBe(200);
      expect(outreachRes.body.success).toBe(true);

      const leadAfterOutreach = mockLeadsDb.find(l => l.id === leadId);
      expect(leadAfterOutreach.status).toBe('contacted');

      // Step B: Inject inbound message simulation
      const replyRes = await request(app)
        .post('/api/simulator/incoming-response')
        .send({
          tenantId: TENANT_ID,
          leadId,
          replyContent: 'I am interested in scheduling a demo, how about next Tuesday?'
        });

      expect(replyRes.status).toBe(200);
      expect(replyRes.body.success).toBe(true);

      const leadAfterReply = mockLeadsDb.find(l => l.id === leadId);
      expect(leadAfterReply.status).toBe('replied');
    });
  });

  describe('3. HubSpot CRM Integration Sync', () => {
    it('should execute HubSpot synchronisation and handle credentials auth mock', async () => {
      const response = await request(app)
        .post('/api/integrations/hubspot/sync')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
