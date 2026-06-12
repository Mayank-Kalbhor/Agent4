const request = require('supertest');
const jwt = require('jsonwebtoken');

const TENANT_A_ID = '00000000-0000-0000-0000-111111111111';
const TENANT_B_ID = '00000000-0000-0000-0000-222222222222';
const JWT_SECRET = process.env.JWT_SECRET || 'sales_agent_super_secret_token';

let leadOwnerTenantId = TENANT_B_ID;
let queryExecuted = '';

const mockClient = {
  query: jest.fn().mockImplementation(async (sql, params) => {
    queryExecuted = sql;
    const sqlUpper = sql.toUpperCase();

    if (sqlUpper.includes('SET APP.CURRENT_TENANT_ID') || sqlUpper.includes('RESET APP.CURRENT_TENANT_ID')) {
      return { rows: [] };
    }
    
    // Intercept checkResourceOwnership query
    if (sqlUpper.includes('SELECT TENANT_ID FROM')) {
      return { rows: [{ tenant_id: leadOwnerTenantId }] };
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

jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPool),
}));

const app = require('../server');
const db = require('../db/db');

function generateToken(tenantId) {
  return jwt.sign(
    { userId: 'user-uuid', tenantId, role: 'rep', email: 'rep@tenant.com' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('AI Sales Agent Security Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    leadOwnerTenantId = TENANT_B_ID;
    queryExecuted = '';
  });

  describe('1. Cross-Tenant Data Access Prevention', () => {
    it('should deny a Tenant A user access to Tenant B resources (HTTP 403)', async () => {
      const tokenA = generateToken(TENANT_A_ID);
      leadOwnerTenantId = TENANT_B_ID; // Resource belongs to Tenant B

      // Tenant A attempts to send message to Lead belonging to Tenant B
      const response = await request(app)
        .post('/api/messages/send')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          leadId: 'lead-belonging-to-tenant-b',
          channel: 'email'
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Access to another tenant');
    });
  });

  describe('2. SQL Injection Parameterization & Protection', () => {
    it('should cleanly escape and parameterize inputs containing SQL injection syntax', async () => {
      const sqlInjectionPayload = "Alice'; DROP TABLE leads;--";
      
      // Perform database query utilizing our db wrapper
      await db.query('SELECT * FROM leads WHERE name = $1', [sqlInjectionPayload], TENANT_A_ID);

      // Verify parameters are bound dynamically rather than interpolated directly
      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT * FROM leads WHERE name = $1 AND tenant_id = $2',
        [sqlInjectionPayload, TENANT_A_ID]
      );
    });
  });

  describe('3. JWT Token Tampering Rejection', () => {
    it('should reject requests with modified JWT payload signatures (HTTP 403)', async () => {
      const token = generateToken(TENANT_A_ID);
      
      // Tamper with the JWT by replacing a character in the signature block
      const tamperedParts = token.split('.');
      tamperedParts[2] = tamperedParts[2].substring(0, tamperedParts[2].length - 1) + (tamperedParts[2].endsWith('a') ? 'b' : 'a');
      const tamperedToken = tamperedParts.join('.');

      const response = await request(app)
        .get('/api/leads')
        .set('Authorization', `Bearer ${tamperedToken}`);

      // Rejects compromised or modified signature tokens
      expect([401, 403]).toContain(response.status);
    });

    it('should reject requests signed with a different key (HTTP 403)', async () => {
      // Sign token using a completely fake secret key
      const maliciousToken = jwt.sign(
        { userId: 'hacker-uuid', tenantId: TENANT_A_ID, role: 'rep' },
        'wrong_secret_key_123',
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .get('/api/leads')
        .set('Authorization', `Bearer ${maliciousToken}`);

      expect([401, 403]).toContain(response.status);
    });
  });
});
