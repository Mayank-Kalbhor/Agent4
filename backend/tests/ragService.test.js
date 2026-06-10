// Integration & Unit Tests for Multi-Tenant RAG Ingestion & Grounding Service
const request = require('supertest');
const jwt = require('jsonwebtoken');

const TENANT_A_ID = '00000000-0000-0000-0000-111111111111';
const CHUNK_A_ID = '00000000-0000-0000-0000-aaaaaaaaaaaa';
const CHUNK_B_ID = '00000000-0000-0000-0000-bbbbbbbbbbbb';

// Mock pdf-parse module
jest.mock('pdf-parse', () => {
  return jest.fn().mockResolvedValue({ text: 'Parsed PDF content about pipeline lead conversion' });
});

// Mock pg module before importing db, app, and services
const mockClient = {
  query: jest.fn((sql, params) => {
    const sqlUpper = sql.toUpperCase();
    
    // RLS session variable calls
    if (sqlUpper.includes('APP.CURRENT_TENANT_ID')) {
      return { rows: [] };
    }
    
    // Knowledge base insert
    if (sqlUpper.includes('INSERT INTO KNOWLEDGE_BASE')) {
      return { rows: [{ id: CHUNK_A_ID, tenant_id: TENANT_A_ID, source: 'collateral.txt' }] };
    }
    
    // Lead ownership lookup
    if (sqlUpper.includes('FROM LEADS') || (sqlUpper.includes('SELECT') && sqlUpper.includes('TENANT_ID') && params && params.includes('lead-uuid-123'))) {
      return { rows: [{ 
        id: 'lead-uuid-123', 
        tenant_id: TENANT_A_ID,
        name: 'Alice',
        title: 'VP of Operations',
        company: 'Acme SaaS',
        industry: 'SaaS',
        notes: 'pipeline automation'
      }] };
    }
    
    // Messages insert for email generation
    if (sqlUpper.includes('INSERT INTO MESSAGES')) {
      return { rows: [{ id: 'msg-uuid-789', status: 'pending_review' }] };
    }
    
    // Intercept knowledge_base listings or checks
    if (sqlUpper.includes('SELECT * FROM KNOWLEDGE_BASE') || sqlUpper.includes('SELECT ID, SOURCE')) {
      return {
        rows: [
          { id: CHUNK_A_ID, tenant_id: TENANT_A_ID, source: 'pricing.txt', type: 'txt', content: 'Our standard subscription pricing plan covers lead capture pipeline automation.' },
          { id: CHUNK_B_ID, tenant_id: TENANT_A_ID, source: 'collab.txt', type: 'txt', content: 'We help enterprise software teams score high priority prospects.' }
        ]
      };
    }
    
    // Default
    return { rows: [] };
  }),
  release: jest.fn(),
  escapeLiteral: jest.fn((val) => `'${val}'`),
};

const mockPool = {
  connect: jest.fn().mockResolvedValue(mockClient),
  query: jest.fn().mockImplementation((sql, params) => Promise.resolve(mockClient.query(sql, params))),
};

jest.mock('pg', () => {
  return {
    Pool: jest.fn(() => mockPool),
  };
});

// Import app and services after mock configurations
const app = require('../server');
const ragService = require('../services/ragService');
const emailGenerationService = require('../services/emailGenerationService');

const JWT_SECRET = process.env.JWT_SECRET || 'sales_agent_super_secret_token';

function generateToken(tenantId) {
  return jwt.sign(
    { userId: 'user-uuid', tenantId, role: 'rep', email: 'rep@saas.com' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('AI RAG Grounding Service Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Core Chunking and Keyword Lookup Engine', () => {
    it('Chunking with Overlap — verifies that a long document is successfully divided into 400-token chunks with 50-token overlap bounds', () => {
      // 400 tokens ≈ 300 words. Let's create a 400-word block (exceeds chunk size of ~300)
      const longText = Array(400).fill('word').join(' ');
      const chunks = ragService.chunkText(longText, 400, 50);

      // Verify that the text split produced more than one segment due to limits
      expect(chunks.length).toBeGreaterThan(1);
      
      // Verify that the overlap matches contextual word bounds (overlap is ~38 words)
      const firstChunkWords = chunks[0].split(/\s+/);
      const secondChunkWords = chunks[1].split(/\s+/);
      
      // The last 38 words of the first chunk should match the first 38 words of the second chunk
      const overlapWords = 38;
      const firstOverlap = firstChunkWords.slice(firstChunkWords.length - overlapWords).join(' ');
      const secondOverlap = secondChunkWords.slice(0, overlapWords).join(' ');
      
      expect(firstOverlap).toBe(secondOverlap);
    });

    it('Keyword Fallback Index Search — verifies mock retrieval searches the SQL table using keyword matching and retrieves the top-3 records', async () => {
      // Test search using overlapping words: "pipeline lead capture"
      const results = await ragService.calculateMockKeywordRetrieval(TENANT_A_ID, 'pipeline lead capture');

      expect(results.length).toBeGreaterThan(0);
      
      // Asserts that the chunk containing matching terms like "pipeline" and "capture" ranks first
      expect(results[0].source).toBe('pricing.txt');
      expect(results[0].content).toContain('pipeline');
      expect(results[0].similarity).toBeGreaterThan(0.6);
    });

    it('Namespaced Vector Isolation — verifies mock vectors strictly isolate content checks inside tenant scopes', async () => {
      const sqlSpy = jest.spyOn(mockClient, 'query');
      
      await ragService.calculateMockKeywordRetrieval(TENANT_A_ID, 'pipeline');
      
      // Verify query is strictly scoped by active tenant_id parameter
      expect(sqlSpy).toHaveBeenCalledWith(
        'SELECT * FROM knowledge_base WHERE tenant_id = $1',
        [TENANT_A_ID]
      );
      
      sqlSpy.mockRestore();
    });
  });

  describe('API Routing & Audited Email Grounding Integration', () => {
    it('POST /api/knowledge/upload — upload and ingest text files', async () => {
      const token = generateToken(TENANT_A_ID);
      const fileBuffer = Buffer.from('We provide custom analytics packages for pipeline follow-ups.');

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

      // Verify that drafting endpoint pulls RAG chunks and maps source_ids in output
      const response = await request(app)
        .post('/api/emails/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          leadId: 'lead-uuid-123',
          template_type: 'initial_outreach',
        });

      console.log("DEBUG RESPONSE:", response.status, response.body);
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      // Asserts that the response object contains the RAG audit tag source_ids
      expect(response.body.source_ids).toBeDefined();
      expect(response.body.source_ids).toContain(CHUNK_A_ID);
      expect(response.body.source_ids).toContain(CHUNK_B_ID);
      expect(response.body.rationale).toContain('Grounded in knowledge source');
    });
  });
});

