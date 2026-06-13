jest.resetModules();
require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');

const TENANT_A_ID = '00000000-0000-0000-0000-111111111111';
const TENANT_B_ID = '00000000-0000-0000-0000-222222222222';
const JWT_SECRET = process.env.JWT_SECRET || 'sales_agent_super_secret_token';

// Setup Mock DB Client
const mockClient = {
  query: jest.fn().mockImplementation(async (sql, params) => {
    const s = (sql || '').toUpperCase();
    if (s.includes('APP.CURRENT_TENANT')) return { rows: [] };
    if (s.includes('MEETINGS')) {
      return {
        rows: [
          { scheduled_at: new Date(Date.now() + 86400000).toISOString(), title: 'Demo Call', lead_name: 'Alice Smith' }
        ]
      };
    }
    if (s.includes('KNOWLEDGE_BASE')) {
      return {
        rows: [
          { id: 'chunk-1', source: 'pricing.txt', content: 'Our product cost is $50/month per user.' }
        ]
      };
    }
    if (s.includes('COUNT(*)') && s.includes('LEADS')) {
      return { rows: [{ count: 12 }] };
    }
    if (s.includes('LEADS') && s.includes('GROUP BY')) {
      return {
        rows: [
          { score: 'high', count: 5 },
          { score: 'medium', count: 4 },
          { score: 'low', count: 3 }
        ]
      };
    }
    if (s.includes('LEADS') && s.includes('ORDER BY')) {
      return {
        rows: [
          { name: 'Alice Smith', company: 'Acme Corp', email: 'alice@acme.com', score: 'high', status: 'contacted' }
        ]
      };
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
const aiAssistantService = require('../services/aiAssistantService');

function generateToken(tenantId) {
  return jwt.sign(
    { userId: 'user-001', tenantId, tenant_id: tenantId, role: 'admin', email: 'rep@saas.com' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('AI Sales Copilot Chat Assistant Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Core Assistant Service (Mock Mode)', () => {
    it('Routes query to leads summary if leads keyword is detected', async () => {
      const response = await aiAssistantService.generateResponse(TENANT_A_ID, 'Show me my top leads');
      expect(response).toContain('Based on your CRM data, you have **12** total leads');
      expect(response).toContain('Alice Smith');
      expect(response).toContain('Acme Corp');
    });

    it('Routes query to meetings calendar summary if meeting keyword is detected', async () => {
      const response = await aiAssistantService.generateResponse(TENANT_A_ID, 'Do I have any scheduled meetings?');
      expect(response).toContain('Demo Call');
      expect(response).toContain('Alice Smith');
    });

    it('Grounds response using RAG context if general query matches document keywords', async () => {
      // General question that doesn't trigger leads or meetings
      const response = await aiAssistantService.generateResponse(TENANT_A_ID, 'What is the product cost or pricing?');
      expect(response).toContain('pricing.txt');
      expect(response).toContain('Our product cost is $50/month per user.');
    });

    it('Returns general onboarding fallback when no keywords match', async () => {
      // Mock retrieveContext to return empty
      const originalQuery = mockClient.query;
      mockClient.query = jest.fn().mockImplementation(async (sql) => {
        return { rows: [] }; // No knowledge base match
      });

      const response = await aiAssistantService.generateResponse(TENANT_A_ID, 'tell me something interesting');
      expect(response).toContain('I am your **AI Sales Copilot**');

      mockClient.query = originalQuery;
    });
  });

  describe('API Endpoint Routing', () => {
    it('POST /api/assistant/chat — returns 401 if unauthorized', async () => {
      const response = await request(app)
        .post('/api/assistant/chat')
        .send({ message: 'Hello' });
      expect(response.status).toBe(401);
    });

    it('POST /api/assistant/chat — returns 400 if message is empty', async () => {
      const token = generateToken(TENANT_A_ID);
      const response = await request(app)
        .post('/api/assistant/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ history: [] });
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Message is required');
    });

    it('POST /api/assistant/chat — completes successfully with response structure', async () => {
      const token = generateToken(TENANT_A_ID);
      const response = await request(app)
        .post('/api/assistant/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({
          message: 'Show me my leads',
          history: []
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.reply).toBeDefined();
      expect(response.body.reply).toContain('total leads');
      expect(response.body.suggestions).toEqual(
        expect.arrayContaining([
          'Who are my highest scoring leads?',
          'Show scheduled meetings for this week.'
        ])
      );
    });
  });
});
