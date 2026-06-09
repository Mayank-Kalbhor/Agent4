// Jest integration tests for Multi-Tenant Data Isolation
const request = require('supertest');
const jwt = require('jsonwebtoken');

const TENANT_A_ID = '00000000-0000-0000-0000-111111111111';
const TENANT_B_ID = '00000000-0000-0000-0000-222222222222';
const LEAD_ID = '00000000-0000-0000-0000-aaaaaaaaaaaa';

// Global variable to control lead ownership inside mocks
let leadOwnerTenantId = TENANT_A_ID;

// Mock pg module with query-aware mocks before importing db and app
const mockClient = {
  query: jest.fn().mockImplementation(async (sql, params) => {
    const sqlUpper = sql.toUpperCase();
    
    // Intercept RLS configuration calls
    if (sqlUpper.includes('SET APP.CURRENT_TENANT_ID') || sqlUpper.includes('RESET APP.CURRENT_TENANT_ID')) {
      return { rows: [] };
    }
    
    // Intercept checkResourceOwnership query
    if (sqlUpper.includes('SELECT TENANT_ID FROM')) {
      return { rows: [{ tenant_id: leadOwnerTenantId }] };
    }
    
    // Intercept fetch Lead details query in outreach route
    if (sqlUpper.includes('SELECT * FROM LEADS WHERE ID')) {
      return { rows: [{ id: LEAD_ID, name: 'John Doe', company: 'Acme', title: 'VP' }] };
    }
    
    // Intercept message saving query in outreach route
    if (sqlUpper.includes('INSERT INTO MESSAGES')) {
      return { rows: [{ id: 'msg-uuid', status: 'sent' }] };
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

jest.mock('pg', () => {
  return {
    Pool: jest.fn(() => mockPool),
  };
});

// Import app and db after mock setup
const app = require('../server');
const db = require('../db/db');

const JWT_SECRET = process.env.JWT_SECRET || 'sales_agent_super_secret_token';

function generateToken(tenantId, role = 'rep') {
  return jwt.sign(
    { userId: 'user-uuid', tenantId, role, email: 'user@tenant.com' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('Multi-Tenant Data Isolation System Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    leadOwnerTenantId = TENANT_A_ID;
  });

  describe('SQL Query Rewriter Tests (db.query)', () => {
    it('should append tenant_id filter to simple SELECT', async () => {
      await db.query('SELECT * FROM leads', [], TENANT_A_ID);

      // Verify that query was rewritten and correct parameters bound
      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT * FROM leads WHERE tenant_id = $1',
        [TENANT_A_ID]
      );
    });

    it('should append tenant_id filter to SELECT with existing WHERE clause', async () => {
      await db.query('SELECT * FROM leads WHERE status = $1', ['new'], TENANT_A_ID);

      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT * FROM leads WHERE status = $1 AND tenant_id = $2',
        ['new', TENANT_A_ID]
      );
    });

    it('should append tenant_id filter before ORDER BY and LIMIT clauses', async () => {
      await db.query(
        'SELECT * FROM leads WHERE status = $1 ORDER BY created_at DESC LIMIT 5',
        ['new'],
        TENANT_A_ID
      );

      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT * FROM leads WHERE status = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 5',
        ['new', TENANT_A_ID]
      );
    });

    it('should not rewrite INSERT queries', async () => {
      await db.query(
        'INSERT INTO leads (tenant_id, name, email) VALUES ($1, $2, $3)',
        [TENANT_A_ID, 'Alice', 'alice@gmail.com'],
        TENANT_A_ID
      );

      expect(mockClient.query).toHaveBeenCalledWith(
        'INSERT INTO leads (tenant_id, name, email) VALUES ($1, $2, $3)',
        [TENANT_A_ID, 'Alice', 'alice@gmail.com']
      );
    });
  });

  describe('API Access Control Middleware Tests', () => {
    it('should throw 401 when authorization token is missing', async () => {
      const response = await request(app).get('/api/leads');
      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Access token required');
    });

    it('should throw 403 when tenant_id is missing from JWT', async () => {
      // Generate token without tenantId
      const malformedToken = jwt.sign({ userId: 'user-uuid' }, JWT_SECRET);

      const response = await request(app)
        .get('/api/leads')
        .set('Authorization', `Bearer ${malformedToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Tenant ID is missing');
    });

    it('should throw 403 on explicit cross-tenant request attempt', async () => {
      const tokenA = generateToken(TENANT_A_ID);

      // Sending tenant_id parameter that doesn't match User A's token
      const response = await request(app)
        .post('/api/leads')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          tenant_id: TENANT_B_ID,
          name: 'Hacker Joe',
          email: 'hacker@gmail.com',
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Access to another tenant\'s data is not allowed');
    });

    it('should throw 403 on implicit resource cross-tenant access', async () => {
      const tokenA = generateToken(TENANT_A_ID);

      // Configure mock to return another tenant ID for lead owner check
      leadOwnerTenantId = TENANT_B_ID;

      // User A attempts to send message to lead belonging to Tenant B
      const response = await request(app)
        .post('/api/messages/send')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          leadId: LEAD_ID,
          channel: 'email',
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Access to another tenant\'s data is not allowed');
      
      // Verify global lookup query checked ownership first
      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT tenant_id FROM leads WHERE id = $1',
        [LEAD_ID]
      );
    });

    it('should pass through valid request and scope DB connection to tenant RLS', async () => {
      const tokenA = generateToken(TENANT_A_ID);

      const response = await request(app)
        .post('/api/messages/send')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          leadId: LEAD_ID,
          channel: 'email',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify that RLS was set on client checkout
      expect(mockClient.query).toHaveBeenCalledWith(
        `SET app.current_tenant_id = '${TENANT_A_ID}'`
      );
    });
  });
});
