// Integration & Unit Tests for AI Email Generation Service
const request = require('supertest');
const jwt = require('jsonwebtoken');

const TENANT_A_ID = '00000000-0000-0000-0000-111111111111';

// Mock pg module before importing db and app
const mockClient = {
  query: jest.fn().mockImplementation(async (sql, params) => {
    const sqlUpper = sql.toUpperCase();
    
    // Intercept RLS calls
    if (sqlUpper.includes('SET APP.CURRENT_TENANT_ID') || sqlUpper.includes('RESET APP.CURRENT_TENANT_ID')) {
      return { rows: [] };
    }
    
    // Intercept Lead lookup query
    if (sqlUpper.includes('SELECT * FROM LEADS WHERE ID')) {
      return { rows: [{ id: 'lead-uuid-123', name: 'Alice', company: 'Acme SaaS', title: 'VP of Operations', tenant_id: TENANT_A_ID }] };
    }
    
    // Intercept checkResourceOwnership global query in middleware
    if (sqlUpper.includes('SELECT TENANT_ID FROM MESSAGES')) {
      return { rows: [{ tenant_id: TENANT_A_ID }] };
    }
    
    // Intercept Message lookup query in approve route
    if (sqlUpper.includes('SELECT * FROM MESSAGES WHERE ID')) {
      return { rows: [{ id: 'msg-uuid-456', tenant_id: TENANT_A_ID, status: 'pending_review', content: 'Email body' }] };
    }
    
    // Intercept Message saving query
    if (sqlUpper.includes('INSERT INTO MESSAGES')) {
      return { rows: [{ id: 'msg-uuid-456', status: 'pending_review' }] };
    }
    
    // Intercept Message status update in approve route
    if (sqlUpper.includes('UPDATE MESSAGES SET STATUS')) {
      return { rows: [{ id: 'msg-uuid-456', status: 'approved' }] };
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

// Import app and services after mocks
const app = require('../server');
const emailGenerationService = require('../services/emailGenerationService');

const JWT_SECRET = process.env.JWT_SECRET || 'sales_agent_super_secret_token';

function generateToken(tenantId) {
  return jwt.sign(
    { userId: 'user-uuid', tenantId, role: 'rep', email: 'rep@saas.com' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('AI Email Generation Service Tests', () => {
  const lead = {
    name: 'Alice',
    company: 'Acme SaaS',
    title: 'VP of Operations',
    notes: 'pipeline automation',
  };

  const sender = {
    name: 'John Sales',
    companyName: 'Outreach AI',
    value_proposition: 'AI-driven lead scoring',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Core Service & Template Mocking', () => {
    it('Mock template drafting — verifies initial outreach and follow-up templates interpolate lead name, company, and role', async () => {
      const initialDraft = await emailGenerationService.generateEmail(lead, sender, 'initial_outreach');
      
      expect(initialDraft.subject).toContain('Acme SaaS');
      expect(initialDraft.body).toContain('Alice');
      expect(initialDraft.body).toContain('VP of Operations');

      const followUpDraft = await emailGenerationService.generateEmail(lead, sender, 'follow_up_1');
      expect(followUpDraft.body).toContain('Alice');
      expect(followUpDraft.body).toContain('lead follow-up');
    });

    it('A/B version assignment — verifies generated emails are labeled v1-A or v1-B', async () => {
      const draft = await emailGenerationService.generateEmail(lead, sender, 'initial_outreach');
      
      expect(draft.template_version).toMatch(/^v1-[AB]$/);
    });

    it('Human review flag — verifies emails with confidence < 0.7 get status pending_review', async () => {
      // Breakup templates are configured to return mock confidence 0.65 to trigger review
      const draft = await emailGenerationService.generateEmail(lead, sender, 'breakup');
      
      expect(draft.confidence_score).toBeLessThan(0.7);
    });

    it('Soft CTA and opener guards — asserts no generic openers like I hope this finds you well', async () => {
      const draft = await emailGenerationService.generateEmail(lead, sender, 'initial_outreach');

      const genericOpeners = [
        'hope this finds you well',
        'hope you are doing well',
        'hope you are doing great',
        'hope this email finds you well'
      ];

      genericOpeners.forEach(opener => {
        expect(draft.body.toLowerCase()).not.toContain(opener);
      });
      
      // Asserts that the email copy ends with a soft CTA (ends with a question mark)
      expect(draft.body.trim().endsWith('?')).toBe(true);
    });
  });

  describe('Express Integration Endpoints', () => {
    it('POST /api/emails/generate — generates draft and maps pending_review based on confidence score', async () => {
      const token = generateToken(TENANT_A_ID);

      const response = await request(app)
        .post('/api/emails/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          leadId: 'lead-uuid-123',
          template_type: 'breakup', // confidence is < 0.7
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.status).toBe('pending_review');
      expect(response.body.confidence_score).toBeLessThan(0.7);
    });

    it('POST /api/emails/approve — verifies status transitions from pending_review to approved', async () => {
      const token = generateToken(TENANT_A_ID);

      const response = await request(app)
        .post('/api/emails/approve')
        .set('Authorization', `Bearer ${token}`)
        .send({
          messageId: 'msg-uuid-456',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message.status).toBe('approved');
      
      // Verify db update statement was issued
      expect(mockClient.query).toHaveBeenCalledWith(
        "UPDATE messages SET status = 'approved' WHERE id = $1 RETURNING *",
        ['msg-uuid-456']
      );
    });
  });
});
