jest.resetModules();
require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');

const TENANT_A_ID = '00000000-0000-0000-0000-111111111111';
const USER_A_ID = '00000000-0000-0000-0000-333333333333';
const LEAD_A_ID = '00000000-0000-0000-0000-aaaaaaaaaaaa';
const MSG_A_ID = '00000000-0000-0000-0000-bbbbbbbbbbbb';
const JWT_SECRET = process.env.JWT_SECRET || 'sales_agent_super_secret_token';

let dbMockState = {
  integrationSettings: {
    gmail: {
      email: 'rep@gmail.com',
      access_token: 'valid_access_token_123',
      expires_at: Date.now() + 3600000,
      encrypted_refresh_token: 'encrypted_refresh_token_xyz',
      iv: '00112233445566778899aabbccddeeff',
      status: 'active'
    }
  },
  lead: {
    id: LEAD_A_ID,
    tenant_id: TENANT_A_ID,
    name: 'Alice Cooper',
    email: 'alice.cooper@rock.com',
    company: 'Rock Co',
    status: 'new'
  },
  outboundMessage: {
    id: MSG_A_ID,
    tenant_id: TENANT_A_ID,
    lead_id: LEAD_A_ID,
    content: 'Outbound outreach email body',
    direction: 'outbound',
    metadata: {
      gmail_message_id: '<unique-parent-id@saas-sales-agent.com>'
    }
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

    if (sqlUpper.includes('SELECT INTEGRATION_SETTINGS FROM USERS')) {
      return { rows: [{ integration_settings: dbMockState.integrationSettings }] };
    }

    if (sqlUpper.includes('SELECT * FROM LEADS WHERE ID') || sqlUpper.includes('SELECT * FROM LEADS WHERE EMAIL')) {
      return { rows: [dbMockState.lead] };
    }

    if (sqlUpper.includes('SELECT ID, TENANT_ID FROM USERS')) {
      return { rows: [{ id: USER_A_ID, tenant_id: TENANT_A_ID }] };
    }

    if (sqlUpper.includes('SELECT ID, TENANT_ID, LEAD_ID FROM MESSAGES') || sqlUpper.includes('FROM MESSAGES WHERE DIRECTION = \'OUTBOUND\'')) {
      return { rows: [dbMockState.outboundMessage] };
    }

    if (sqlUpper.includes('INSERT INTO MESSAGES') || sqlUpper.includes('UPDATE MESSAGES') || sqlUpper.includes('UPDATE LEADS')) {
      return { rows: [{ id: 'inbound-msg-uuid', tenant_id: TENANT_A_ID, lead_id: LEAD_A_ID, content: 'Clean response', intent: 'interested' }] };
    }

    if (sqlUpper.includes('INSERT INTO AUDIT_LOGS')) {
      return { rows: [{ id: 'audit-log-uuid' }] };
    }

    if (sqlUpper.includes('UPDATE USERS')) {
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

// Mock replyDetectionService.processInboundMessage to prevent actual AI classification calls in tests
jest.mock('../services/replyDetectionService', () => {
  return {
    processInboundMessage: jest.fn().mockResolvedValue(true),
    classifyIntent: jest.fn().mockResolvedValue({ intent: 'interested', rationale: 'mock rationale' })
  };
});

// Store native global.fetch
const originalFetch = global.fetch;

const app = require('../server');
const gmailService = require('../services/gmailService');
const encryption = require('../utils/encryption');
const replyDetectionService = require('../services/replyDetectionService');

function generateToken(tenantId) {
  return jwt.sign(
    { userId: USER_A_ID, tenantId, tenant_id: tenantId, role: 'rep', email: 'rep@saas.com' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('Gmail Integration Module Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.query.mockClear();
    dbMockState = {
      integrationSettings: {
        gmail: {
          email: 'rep@gmail.com',
          access_token: 'valid_access_token_123',
          expires_at: Date.now() + 3600000,
          encrypted_refresh_token: 'encrypted_refresh_token_xyz',
          iv: '00112233445566778899aabbccddeeff',
          status: 'active'
        }
      },
      lead: {
        id: LEAD_A_ID,
        tenant_id: TENANT_A_ID,
        name: 'Alice Cooper',
        email: 'alice.cooper@rock.com',
        company: 'Rock Co',
        status: 'new'
      },
      outboundMessage: {
        id: MSG_A_ID,
        tenant_id: TENANT_A_ID,
        lead_id: LEAD_A_ID,
        content: 'Outbound outreach email body',
        direction: 'outbound',
        metadata: {
          gmail_message_id: '<unique-parent-id@saas-sales-agent.com>'
        }
      }
    };
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('Token Encryption & Decryption Utility', () => {
    it('encrypt & decrypt — securely cycles a refresh token', () => {
      const token = 'my_super_secret_refresh_token_123';
      const encrypted = encryption.encrypt(token);
      expect(encrypted).toHaveProperty('encryptedData');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted.encryptedData).not.toBe(token);

      const decrypted = encryption.decrypt(encrypted.encryptedData, encrypted.iv);
      expect(decrypted).toBe(token);
    });
  });

  describe('Core Gmail Connection & OAuth', () => {
    it('getOAuthUrl — should build a redirect URL with correct scopes and state', () => {
      const url = gmailService.getOAuthUrl(TENANT_A_ID, USER_A_ID);
      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url).toContain(encodeURIComponent('https://www.googleapis.com/auth/gmail.send'));
      expect(url).toContain(encodeURIComponent(JSON.stringify({ tenantId: TENANT_A_ID, userId: USER_A_ID })));
    });

    it('handleCallback — exchanges code for refresh token, encrypts token and saves email profile', async () => {
      // Setup mock responses for fetch
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'access_exchange_999',
            refresh_token: 'refresh_exchange_999',
            expires_in: 3600
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ emailAddress: 'my-gmail@company.com' })
        });

      // Set GMAIL keys temporarily to trigger real execution branch
      process.env.GMAIL_CLIENT_ID = 'client_123';
      process.env.GMAIL_CLIENT_SECRET = 'secret_123';

      const result = await gmailService.handleCallback('code_123', TENANT_A_ID, USER_A_ID);
      expect(result.emailAddress).toBe('my-gmail@company.com');

      // Verify db insert audit logs & updates settings
      const hasUpdate = mockClient.query.mock.calls.some(call =>
        call[0].toUpperCase().includes('UPDATE USERS SET INTEGRATION_SETTINGS')
      );
      expect(hasUpdate).toBe(true);

      delete process.env.GMAIL_CLIENT_ID;
      delete process.env.GMAIL_CLIENT_SECRET;
    });
  });

  describe('Token Autorefresh and Error Handling', () => {
    it('getFreshAccessToken — returns cached token if it is not expired', async () => {
      const token = await gmailService.getFreshAccessToken(TENANT_A_ID, USER_A_ID);
      expect(token).toBe('valid_access_token_123');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('getFreshAccessToken — triggers refresh when token is expired and decrypts refresh token', async () => {
      dbMockState.integrationSettings.gmail.expires_at = Date.now() - 10000; // Expired
      
      const encryptToken = encryption.encrypt('real_refresh_token');
      dbMockState.integrationSettings.gmail.encrypted_refresh_token = encryptToken.encryptedData;
      dbMockState.integrationSettings.gmail.iv = encryptToken.iv;

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new_refreshed_access_token',
          expires_in: 3600
        })
      });

      process.env.GMAIL_CLIENT_ID = 'client_123';
      process.env.GMAIL_CLIENT_SECRET = 'secret_123';

      const token = await gmailService.getFreshAccessToken(TENANT_A_ID, USER_A_ID);
      expect(token).toBe('new_refreshed_access_token');

      // Check fetch payload was correct
      expect(global.fetch).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/token',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('refresh_token=real_refresh_token')
        })
      );

      delete process.env.GMAIL_CLIENT_ID;
      delete process.env.GMAIL_CLIENT_SECRET;
    });

    it('getFreshAccessToken — deactivates account and logs audit on invalid_grant token revocation', async () => {
      dbMockState.integrationSettings.gmail.expires_at = Date.now() - 10000; // Expired
      
      const encryptToken = encryption.encrypt('real_refresh_token');
      dbMockState.integrationSettings.gmail.encrypted_refresh_token = encryptToken.encryptedData;
      dbMockState.integrationSettings.gmail.iv = encryptToken.iv;

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
      });

      process.env.GMAIL_CLIENT_ID = 'client_123';
      process.env.GMAIL_CLIENT_SECRET = 'secret_123';

      await expect(gmailService.getFreshAccessToken(TENANT_A_ID, USER_A_ID))
        .rejects.toThrow('Gmail token refresh failed');

      // Assert user record is marked as inactive
      const deactivatedCheck = mockClient.query.mock.calls.some(call =>
        call[0].toUpperCase().includes('UPDATE USERS') &&
        call[0].includes('inactive')
      );
      expect(deactivatedCheck).toBe(true);

      // Assert audit log records GMAIL_INTEGRATION_DEACTIVATED
      const auditLogCheck = mockClient.query.mock.calls.some(call =>
        call[0].toUpperCase().includes('INSERT INTO AUDIT_LOGS') &&
        call[0].includes('GMAIL_INTEGRATION_DEACTIVATED')
      );
      expect(auditLogCheck).toBe(true);

      delete process.env.GMAIL_CLIENT_ID;
      delete process.env.GMAIL_CLIENT_SECRET;
    });
  });

  describe('Outbound Email Sending & RFC 822 format', () => {
    it('sendEmail — builds message with List-Unsubscribe, custom Message-ID headers and logs status to DB', async () => {
      process.env.GMAIL_CLIENT_ID = 'client_123';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'sent_id_999', threadId: 'thread_id_999' })
      });

      const messageRecord = await gmailService.sendEmail(
        TENANT_A_ID,
        USER_A_ID,
        LEAD_A_ID,
        'alice.cooper@rock.com',
        'Rock outreach',
        '<p>Heavy metal rock and roll</p>',
        '<mailto:unsub@company.com>'
      );

      expect(messageRecord).toBeDefined();
      
      // Check that fetch payload included MIME headers
      const sendCall = global.fetch.mock.calls[0];
      expect(sendCall[0]).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
      const bodyPayload = JSON.parse(sendCall[1].body);
      const decodedRaw = Buffer.from(bodyPayload.raw, 'base64').toString('utf8');
      
      expect(decodedRaw).toContain('To: alice.cooper@rock.com');
      expect(decodedRaw).toContain('Subject: Rock outreach');
      expect(decodedRaw).toContain('List-Unsubscribe: <mailto:unsub@company.com>');
      expect(decodedRaw).toContain('Message-ID:');
      expect(decodedRaw).toContain('<p>Heavy metal rock and roll</p>');

      // Verify db saved outbound logs containing unique Message-ID
      const dbInsertOutbound = mockClient.query.mock.calls.some(call =>
        call[0].toUpperCase().includes('INSERT INTO MESSAGES') &&
        call[1][4].includes('gmail_message_id')
      );
      expect(dbInsertOutbound).toBe(true);

      delete process.env.GMAIL_CLIENT_ID;
    });
  });

  describe('Reply Parsing, Quote Stripping, and Threading Webhook', () => {
    it('stripQuotedReply — deletes thread context from response content', () => {
      const rawText = `This is my actual response body.\n\nOn 2026-06-11 rep wrote:\n> Outreach text here\n> multiple lines`;
      const clean = gmailService.stripQuotedReply(rawText);
      expect(clean).toBe('This is my actual response body.');
      
      const sigText = `Hello,\nI want a meeting.\n-----Original Message-----\nFrom: rep@company.com\nSent: today`;
      const cleanSig = gmailService.stripQuotedReply(sigText);
      expect(cleanSig).toBe('Hello,\nI want a meeting.');
    });

    it('processPubSubNotification — parses base64 data, extracts In-Reply-To, finds lead, saves msg and classifications', async () => {
      // Webhook payload containing base64 data encoding { emailAddress: 'rep@gmail.com', historyId: 100 }
      const pubSubPayload = {
        message: {
          data: Buffer.from(JSON.stringify({ emailAddress: 'rep@gmail.com', historyId: 100 })).toString('base64')
        },
        // In mock mode, we inject the mockMessage details directly
        mockMessage: {
          messageId: '<incoming-msg-id-111@gmail.com>',
          threadId: 'thread-id-000',
          inReplyTo: '<unique-parent-id@saas-sales-agent.com>',
          from: 'alice.cooper@rock.com',
          subject: 'Re: Rock outreach',
          body: 'I want a meeting!\n\nOn 2026-06-11, rep wrote:\n> Outbound outreach email body'
        }
      };

      const records = await gmailService.processPubSubNotification(pubSubPayload);
      expect(records.length).toBe(1);

      // Verify parent was looked up correctly
      const parentLookup = mockClient.query.mock.calls.some(call =>
        call[0].toUpperCase().includes('SELECT') &&
        call[0].toUpperCase().includes('MESSAGES') &&
        call[1].includes('<unique-parent-id@saas-sales-agent.com>')
      );
      expect(parentLookup).toBe(true);

      // Verify clean body (quote stripped) is saved to the db as received inbound message
      const savedInbound = mockClient.query.mock.calls.some(call =>
        call[0].toUpperCase().includes('INSERT INTO MESSAGES') &&
        call[1][2] === 'I want a meeting!' &&
        call[1][3] === 'Re: Rock outreach'
      );
      expect(savedInbound).toBe(true);

      // Verify processInboundMessage was invoked for classification
      expect(replyDetectionService.processInboundMessage).toHaveBeenCalled();
    });
  });

  describe('API Routing Handlers', () => {
    it('GET /api/integrations/gmail/connect — returns OAuth consent URL', async () => {
      const token = generateToken(TENANT_A_ID);
      const res = await request(app)
        .get('/api/integrations/gmail/connect')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.url).toContain('mock?client_id=mock_id');
    });

    it('GET /api/integrations/gmail/callback — connects profile successfully', async () => {
      const state = JSON.stringify({ tenantId: TENANT_A_ID, userId: USER_A_ID });
      const res = await request(app)
        .get(`/api/integrations/gmail/callback?code=mock_code&state=${encodeURIComponent(state)}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.email).toBe('rep@company.com'); // Mock address returned
    });

    it('POST /api/integrations/gmail/webhook — handles incoming Pub/Sub notifications', async () => {
      const payload = {
        emailAddress: 'rep@gmail.com',
        historyId: 100,
        mockMessage: {
          messageId: '<incoming-msg-id-111@gmail.com>',
          threadId: 'thread-id-000',
          inReplyTo: '<unique-parent-id@saas-sales-agent.com>',
          from: 'alice.cooper@rock.com',
          subject: 'Re: Rock outreach',
          body: 'Count me in for a demo.'
        }
      };

      const res = await request(app)
        .post('/api/integrations/gmail/webhook')
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.processedCount).toBe(1);
    });

    it('POST /api/simulator/gmail-webhook — simulates inbound emails through webhook pipeline', async () => {
      const payload = {
        emailAddress: 'rep@gmail.com',
        historyId: 100,
        mockMessage: {
          messageId: '<incoming-msg-id-111@gmail.com>',
          threadId: 'thread-id-000',
          inReplyTo: '<unique-parent-id@saas-sales-agent.com>',
          from: 'alice.cooper@rock.com',
          subject: 'Re: Rock outreach',
          body: 'I am interested.'
        }
      };

      const res = await request(app)
        .post('/api/simulator/gmail-webhook')
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.processedCount).toBe(1);
      expect(res.body.records).toBeDefined();
    });
  });
});
