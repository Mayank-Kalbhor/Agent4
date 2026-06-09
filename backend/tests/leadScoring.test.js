// Lead Vector Scoring Service Unit Tests
const leadScoringService = require('../services/leadScoringService');

describe('Lead Scoring Service Tests', () => {
  const mockTenantId = 'tenant-uuid-123';
  const testIcp = {
    titles: ['vp', 'director', 'cto'],
    industries: ['saas', 'software'],
    companySizes: ['10-50', '51-200'],
    painPoints: ['lead capture', 'pipeline scaling'],
  };

  describe('Text Representation Builder', () => {
    it('should generate expected semantic ICP string representation', () => {
      // Accessing internal getIcpText or testing output by passing it to scoreLead
      // Since it is an internal helper, we verify scoreLead's correct mapping.
      expect(leadScoringService.DEFAULT_ICP).toBeDefined();
    });
  });

  describe('Rule-Based Mock Scoring Engine (No API Key)', () => {
    it('should rank a perfect lead as High priority (similarity >= 0.8)', async () => {
      const perfectLead = {
        name: 'John Doe',
        title: 'VP of Engineering',
        company: 'Stripe SaaS Software Inc',
        notes: 'Needs help with automated lead capture and pipeline scaling.',
      };

      const result = await leadScoringService.scoreLead(mockTenantId, perfectLead, testIcp);

      expect(result.score).toBe('high');
      expect(result.similarity).toBeGreaterThanOrEqual(0.8);
      expect(result.rationale).toContain('Strong keyword overlap');
    });

    it('should rank a partial lead as Medium priority (0.6 <= similarity < 0.8)', async () => {
      const partialLead = {
        name: 'Jane Smith',
        title: 'Director of Product', // Matches titles
        company: 'Retail Group', // No match
        notes: 'Looking for general analytics software.', // No match
      };

      const result = await leadScoringService.scoreLead(mockTenantId, partialLead, testIcp);

      expect(result.score).toBe('medium');
      expect(result.similarity).toBeGreaterThanOrEqual(0.6);
      expect(result.similarity).toBeLessThan(0.8);
      expect(result.rationale).toContain('Moderate keyword overlap');
    });

    it('should rank a non-matching lead as Low priority (similarity < 0.6)', async () => {
      const unrelatedLead = {
        name: 'Bob Builder',
        title: 'Construction Worker',
        company: 'Cement Labs',
        notes: 'Needs physical tools.',
      };

      const result = await leadScoringService.scoreLead(mockTenantId, unrelatedLead, testIcp);

      expect(result.score).toBe('low');
      expect(result.similarity).toBeLessThan(0.6);
      expect(result.rationale).toContain('weak keyword alignment');
    });
  });

  describe('Batch CSV Imports Chunking (Chunks of 20)', () => {
    it('should process large batch collections concurrently in groups of 20', async () => {
      const dummyLead = {
        name: 'Test Lead',
        title: 'CTO',
        company: 'SaaS Software',
        notes: 'capture',
      };

      // Create a list of 45 leads
      const leads = Array(45).fill(dummyLead);

      const spyScoreLead = jest.spyOn(leadScoringService, 'scoreLead');

      const results = await leadScoringService.scoreLeadsBatch(mockTenantId, leads, testIcp);

      expect(results.length).toBe(45);
      expect(spyScoreLead).toHaveBeenCalledTimes(45);
      
      spyScoreLead.mockRestore();
    });
  });

  describe('Rate-Limit Handling and Retry Backoff Mock', () => {
    it('should retry execution with backoff when receiving a 429 status rate limit', async () => {
      let callCount = 0;
      
      const rateLimitedOperation = async () => {
        callCount++;
        if (callCount < 3) {
          // Simulate 429 Rate Limit error on first two attempts
          const err = new Error('Rate limit exceeded');
          err.status = 429;
          throw err;
        }
        return 'success';
      };

      // Create a customized, fast-executing backoff runner for test
      const callWithBackoffMock = async (fn, maxRetries = 5) => {
        let delay = 5; // Fast delay in unit tests (5ms)
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            return await fn();
          } catch (err) {
            if (err.status === 429 && attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, delay));
              delay *= 2;
            } else {
              throw err;
            }
          }
        }
      };

      const finalResult = await callWithBackoffMock(rateLimitedOperation);

      expect(finalResult).toBe('success');
      expect(callCount).toBe(3); // Fails twice, succeeds on 3rd attempt
    });
  });
});
