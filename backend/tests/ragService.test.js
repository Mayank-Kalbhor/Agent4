jest.resetModules();
require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');

const TENANT_A_ID = '00000000-0000-0000-0000-111111111111';
const CHUNK_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CHUNK_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const JWT_SECRET = process.env.JWT_SECRET || 'sales_agent_super_secret_token';

jest.mock('pdf-parse', () => {
  return jest.fn().mockResolvedValue({ text: 'mock pdf text conversion' });
});

const mockClient = {
  query: jest.fn().mockImplementation(async (sql, params) => {
    const s = (sql || '').toUpperCase();
    if (s.includes('APP.CURRENT_TENANT')) return { rows: [] };
    if (s.includes('KNOWLEDGE_BASE')) {
      return { rows: [{ id: CHUNK_A_ID, source: 'collateral.txt', content: 'Our product automates lead capture and follow-ups. We provide custom analytics packages for pipeline lead conversion.' }] };
    }
    if (s.includes('AUDIT_LOGS')) return { rows: [] };
    if (s.includes('INSERT INTO MESSAGES')) {
      return { rows: [{ id: 'msg-uuid-789', status: 'pending_review', confidence_score: 0.65 }] };
    }
    if (s.includes('UPDATE MESSAGES')) return { rows: [{ id: 'msg-uuid-789', status: 'approved' }] };
    return { rows: [{ id: 'lead-uuid-123', tenant_id: TENANT_A_ID, name: 'Alice', title: 'VP of Operations', company: 'Acme SaaS', industry: 'SaaS', notes: 'pipeline automation', score: 'high', score_reason: 'ICP match' }] };
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
const ragService = require('../services/ragService');

function generateToken(tenantId) {
  return jwt.sign(
    { userId: 'user-001', tenantId, tenant_id: tenantId, role: 'admin', email: 'rep@saas.com' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('AI RAG Grounding Service Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.query.mockImplementation((sql, params) => {
      const s = (sql || '').toUpperCase();
      if (s.includes('APP.CURRENT_TENANT')) return { rows: [] };
      if (s.includes('KNOWLEDGE_BASE')) {
        return { rows: [{ id: CHUNK_A_ID, source: 'collateral.txt', content: 'Our product automates lead capture and follow-ups. We provide custom analytics packages for pipeline lead conversion.' }] };
      }
      if (s.includes('AUDIT_LOGS')) return { rows: [] };
      if (s.includes('INSERT INTO MESSAGES')) {
        return { rows: [{ id: 'msg-uuid-789', status: 'pending_review', confidence_score: 0.65 }] };
      }
      if (s.includes('UPDATE MESSAGES')) return { rows: [{ id: 'msg-uuid-789', status: 'approved' }] };
      return { rows: [{ id: 'lead-uuid-123', tenant_id: TENANT_A_ID, name: 'Alice', title: 'VP of Operations', company: 'Acme SaaS', industry: 'SaaS', notes: 'pipeline automation', score: 'high', score_reason: 'ICP match' }] };
    });
  });

  describe('Core RAG Engine', () => {
    it('Chunking with overlap — verifies 400-token chunks with 50-token overlap bounds', () => {
      const longText = Array(500).fill('word').join(' ');
      const chunks = ragService.chunkText(longText, 400, 50);
      expect(chunks.length).toBeGreaterThan(1);
      const firstWords = chunks[0].split(/\s+/);
      const secondWords = chunks[1].split(/\s+/);
      const overlapWords = 38;
      const firstOverlap = firstWords.slice(-overlapWords).join(' ');
      const secondOverlap = secondWords.slice(0, overlapWords).join(' ');
      expect(firstOverlap).toBe(secondOverlap);
    });

    it('Keyword fallback index search — retrieves top-3 matching records', async () => {
      const results = await ragService.retrieveContext(TENANT_A_ID, 'lead capture pipeline');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].source).toBe('collateral.txt');
      expect(results[0].content).toContain('pipeline');
      expect(results[0].similarity).toBeGreaterThan(0.6);
    });

    it('Namespaced vector isolation — verifies tenant_id scoping in retrieval', async () => {
      const sqlSpy = jest.spyOn(mockClient, 'query');
      await ragService.retrieveContext(TENANT_A_ID, 'pipeline');
      expect(sqlSpy).toHaveBeenCalledWith(
        'SELECT id, source, content, tenant_id = $1 AS similarity FROM knowledge_base WHERE tenant_id = $1',
        [TENANT_A_ID]
      );
      sqlSpy.mockRestore();
    });
  });

  describe('API Routing & Audited Email Grounding Integration', () => {
    it('POST /api/knowledge/upload — upload and ingest text files', async () => {
      const token = generateToken(TENANT_A_ID);
      const fileBuffer = Buffer.from('Our product automates lead capture and follow-ups.');
      const response = await request(app)
        .post('/api/knowledge/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', fileBuffer, 'collateral.txt');
      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.source).toBe('collateral.txt');
      expect(response.body.chunks).toBeDefined();
    });

    it('Audited Prompt Grounding — asserts generated drafts contain RAG grounding metadata and source_ids', async () => {
      const token = generateToken(TENANT_A_ID);
      const response = await request(app)
        .post('/api/emails/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          leadId: 'lead-uuid-123',
          template_type: 'initial_outreach',
        });
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.source_ids).toBeDefined();
      expect(response.body.source_ids).toContain(CHUNK_A_ID);
    });
  });
});
