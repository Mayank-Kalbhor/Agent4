jest.resetModules();
require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');

const TENANT_A_ID = '00000000-0000-0000-0000-111111111111';
const USER_A_ID = '00000000-0000-0000-0000-333333333333';
const LEAD_A_ID = '00000000-0000-0000-0000-aaaaaaaaaaaa';
const MEETING_A_ID = '00000000-0000-0000-0000-bbbbbbbbbbbb';
const MSG_A_ID = '00000000-0000-0000-0000-cccccccccccc';
const JWT_SECRET = process.env.JWT_SECRET || 'sales_agent_super_secret_token';

let dbMockState = {
  tenantSettings: {
    hubspot: {
      access_token: 'valid_hs_access_token_123',
      expires_at: Date.now() + 3600000,
      encrypted_refresh_token: 'encrypted_refresh_token_xyz',
      iv: '00112233445566778899aabbccddeeff',
      status: 'active',
      last_sync_at: 0
    }
  },
  lead: {
    id: LEAD_A_ID,
    tenant_id: TENANT_A_ID,
    name: 'HubSpot Prospect',
    email: 'prospect@hubspot.com',
    phone: '+15551234',
    company: 'HubSpot Target Co',
    title: 'Sales VP',
    status: 'new',
    updated_at: new Date().toISOString(),
    enrichment_data: {
      hubspot_contact_id: 'hs_contact_id_999'
    }
  },
  meeting: {
    id: MEETING_A_ID,
    tenant_id: TENANT_A_ID,
    lead_id: LEAD_A_ID,
    scheduled_at: '2026-06-15T10:00:00Z',
    calendar_event_id: 'evt-789',
    booking_link: 'https://calendly.com/mock-sales-rep',
    status: 'scheduled',
    meeting_metadata: {}
  },
  message: {
    id: MSG_A_ID,
    tenant_id: TENANT_A_ID,
    lead_id: LEAD_A_ID,
    subject: 'Outreach to HubSpot Lead',
    content: 'Email body copy text for HubSpot integration test.',
    direction: 'outbound',
    metadata: {}
  }
};

const defaultQueryImpl = async (sql, params) => {
    const sqlUpper = sql.toUpperCase();
    
    if (sqlUpper.includes('SET APP.CURRENT_TENANT_ID') || sqlUpper.includes('RESET APP.CURRENT_TENANT_ID')) {
      return { rows: [] };
    }

    if (sqlUpper.includes('SELECT TENANT_ID FROM')) {
      return { rows: [{ tenant_id: TENANT_A_ID }] };
    }

    if (sqlUpper.includes('SELECT SETTINGS FROM TENANTS')) {
      return { rows: [{ settings: dbMockState.tenantSettings }] };
    }

    if (sqlUpper.includes('SELECT * FROM LEADS WHERE ID') || sqlUpper.includes('SELECT * FROM LEADS WHERE EMAIL')) {
      return { rows: [dbMockState.lead] };
    }

    if (sqlUpper.includes('SELECT * FROM LEADS WHERE UPDATED_AT')) {
      return { rows: [dbMockState.lead] };
    }

    if (sqlUpper.includes('SELECT * FROM MEETINGS WHERE ID')) {
      return { rows: [dbMockState.meeting] };
    }

    if (sqlUpper.includes('SELECT * FROM MESSAGES WHERE ID')) {
      return { rows: [dbMockState.message] };
    }

    if (sqlUpper.includes('INSERT INTO AUDIT_LOGS') || sqlUpper.includes('INSERT INTO MESSAGES') || sqlUpper.includes('INSERT INTO LEADS')) {
      return { rows: [{ id: 'inserted-uuid' }] };
    }

    if (sqlUpper.includes('UPDATE TENANTS') || sqlUpper.includes('UPDATE LEADS') || sqlUpper.includes('UPDATE MEETINGS') || sqlUpper.includes('UPDATE MESSAGES')) {
      return { rows: [] };
    }

    return { rows: [] };
  };

const mockClient = {
  query: jest.fn().mockImplementation(defaultQueryImpl),
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

const originalFetch = global.fetch;

const app = require('../server');
const hubspotService = require('../services/hubspotService');
const encryption = require('../utils/encryption');

function generateToken(tenantId) {
  return jwt.sign(
    { userId: USER_A_ID, tenantId, tenant_id: tenantId, role: 'rep', email: 'rep@saas.com' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('HubSpot CRM Integration Module Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.query.mockClear();
    mockClient.query.mockImplementation(defaultQueryImpl);
    dbMockState = {
      tenantSettings: {
        hubspot: {
          access_token: 'valid_hs_access_token_123',
          expires_at: Date.now() + 3600000,
          encrypted_refresh_token: 'encrypted_refresh_token_xyz',
          iv: '00112233445566778899aabbccddeeff',
          status: 'active',
          last_sync_at: 0
        }
      },
      lead: {
        id: LEAD_A_ID,
        tenant_id: TENANT_A_ID,
        name: 'HubSpot Prospect',
        email: 'prospect@hubspot.com',
        phone: '+15551234',
        company: 'HubSpot Target Co',
        title: 'Sales VP',
        status: 'new',
        updated_at: new Date().toISOString(),
        enrichment_data: {
          hubspot_contact_id: 'hs_contact_id_999'
        }
      },
      meeting: {
        id: MEETING_A_ID,
        tenant_id: TENANT_A_ID,
        lead_id: LEAD_A_ID,
        scheduled_at: '2026-06-15T10:00:00Z',
        calendar_event_id: 'evt-789',
        booking_link: 'https://calendly.com/mock-sales-rep',
        status: 'scheduled',
        meeting_metadata: {}
      },
      message: {
        id: MSG_A_ID,
        tenant_id: TENANT_A_ID,
        lead_id: LEAD_A_ID,
        subject: 'Outreach to HubSpot Lead',
        content: 'Email body copy text for HubSpot integration test.',
        direction: 'outbound',
        metadata: {}
      }
    };
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('OAuth Authorization and Configuration', () => {
    it('getOAuthUrl — returns correct redirect auth URL with scopes', () => {
      const url = hubspotService.getOAuthUrl(TENANT_A_ID);
      expect(url).toContain('https://app.hubspot.com/oauth/authorize');
      expect(url).toContain('crm.objects.contacts.read');
      expect(url).toContain(encodeURIComponent(JSON.stringify({ tenantId: TENANT_A_ID })));
    });

    it('handleCallback — exchanges code for refresh token, encrypts token and saves credentials to settings', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'exchange_access_token_888',
          refresh_token: 'exchange_refresh_token_888',
          expires_in: 1800
        })
      });

      process.env.HUBSPOT_CLIENT_ID = 'client_hs';
      process.env.HUBSPOT_CLIENT_SECRET = 'secret_hs';

      const res = await hubspotService.handleCallback('code_hs_123', TENANT_A_ID);
      expect(res.success).toBe(true);

      const hasUpdate = mockClient.query.mock.calls.some(call =>
        call[0].toUpperCase().includes('UPDATE TENANTS SET SETTINGS')
      );
      expect(hasUpdate).toBe(true);

      delete process.env.HUBSPOT_CLIENT_ID;
      delete process.env.HUBSPOT_CLIENT_SECRET;
    });
  });

  describe('Token Auto-refresh & Deactivation', () => {
    it('getFreshAccessToken — returns cached token if not expired', async () => {
      const token = await hubspotService.getFreshAccessToken(TENANT_A_ID);
      expect(token).toBe('valid_hs_access_token_123');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('getFreshAccessToken — triggers auto-refresh when expired and decrypts refresh token', async () => {
      dbMockState.tenantSettings.hubspot.expires_at = Date.now() - 5000; // Expired
      
      const encryptToken = encryption.encrypt('real_hs_refresh_token');
      dbMockState.tenantSettings.hubspot.encrypted_refresh_token = encryptToken.encryptedData;
      dbMockState.tenantSettings.hubspot.iv = encryptToken.iv;

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new_hs_refreshed_access_token',
          expires_in: 1800
        })
      });

      process.env.HUBSPOT_CLIENT_ID = 'client_hs';
      process.env.HUBSPOT_CLIENT_SECRET = 'secret_hs';

      const token = await hubspotService.getFreshAccessToken(TENANT_A_ID);
      expect(token).toBe('new_hs_refreshed_access_token');
      
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.hubapi.com/oauth/v1/token',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('refresh_token=real_hs_refresh_token')
        })
      );

      delete process.env.HUBSPOT_CLIENT_ID;
      delete process.env.HUBSPOT_CLIENT_SECRET;
    });

    it('getFreshAccessToken — deactivates connection and logs audit on invalid_grant token failures', async () => {
      dbMockState.tenantSettings.hubspot.expires_at = Date.now() - 5000;
      
      const encryptToken = encryption.encrypt('real_hs_refresh_token');
      dbMockState.tenantSettings.hubspot.encrypted_refresh_token = encryptToken.encryptedData;
      dbMockState.tenantSettings.hubspot.iv = encryptToken.iv;

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: 'invalid_grant', error_description: 'Revoked refresh token.' })
      });

      process.env.HUBSPOT_CLIENT_ID = 'client_hs';
      process.env.HUBSPOT_CLIENT_SECRET = 'secret_hs';

      await expect(hubspotService.getFreshAccessToken(TENANT_A_ID))
        .rejects.toThrow('HubSpot token refresh failed');

      // Check settings update
      const deactCheck = mockClient.query.mock.calls.some(call =>
        call[0].toUpperCase().includes('UPDATE TENANTS') &&
        call[1][0].includes('"status":"inactive"')
      );
      expect(deactCheck).toBe(true);

      // Check audit logs connect deactivation
      const auditCheck = mockClient.query.mock.calls.some(call =>
        call[0].toUpperCase().includes('INSERT INTO AUDIT_LOGS') &&
        call[0].includes('HUBSPOT_INTEGRATION_DEACTIVATED')
      );
      expect(auditCheck).toBe(true);

      delete process.env.HUBSPOT_CLIENT_ID;
      delete process.env.HUBSPOT_CLIENT_SECRET;
    });
  });

  describe('Bidirectional Contact Import (Pull) and Conflict Resolution', () => {
    it('importFromHubSpot — creates new lead if email does not exist', async () => {
      // Setup HubSpot contacts search returning a contact
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('/search')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              results: [{
                id: 'hs_contact_777',
                properties: {
                  firstname: 'HubSpot',
                  lastname: 'Prospect',
                  email: 'hs.prospect@sales.com',
                  phone: '+18887776',
                  company: 'CRM Inc',
                  jobtitle: 'CTO',
                  hs_lead_status: 'NEW',
                  lastmodifieddate: new Date().toISOString()
                }
              }]
            })
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            properties: {
              lastmodifieddate: new Date().toISOString(),
              hs_lead_status: 'NEW'
            }
          })
        });
      });

      process.env.HUBSPOT_CLIENT_ID = 'client_hs';
      // Mock db lookup to return empty array (lead does not exist)
      mockClient.query.mockImplementation(async (sql, params) => {
        const sqlUpper = sql.toUpperCase();
        if (sqlUpper.includes('SELECT SETTINGS FROM TENANTS')) {
          return { rows: [{ settings: dbMockState.tenantSettings }] };
        }
        if (sqlUpper.includes('SELECT * FROM LEADS WHERE EMAIL')) {
          return { rows: [] }; // No lead found
        }
        if (sqlUpper.includes('INSERT INTO LEADS') || sqlUpper.includes('INSERT INTO AUDIT_LOGS')) {
          return { rows: [{ id: 'inserted-uuid' }] };
        }
        return { rows: [] };
      });

      await hubspotService.syncHubSpot(TENANT_A_ID);

      const createCheck = mockClient.query.mock.calls.some(call =>
        call[0].toUpperCase().includes('INSERT INTO LEADS') &&
        call[1].includes('hs.prospect@sales.com')
      );
      expect(createCheck).toBe(true);

      delete process.env.HUBSPOT_CLIENT_ID;
    });

    it('importFromHubSpot — overwrites local lead and logs conflict if HubSpot is newer', async () => {
      // Local lead modified at Date.now() - 50000
      dbMockState.lead.updated_at = new Date(Date.now() - 50000).toISOString();
      
      // HubSpot contact modified at Date.now() (newer!)
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('/search')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              results: [{
                id: 'hs_contact_id_999',
                properties: {
                  firstname: 'HubSpot',
                  lastname: 'Updated Prospect',
                  email: 'prospect@hubspot.com',
                  phone: '+15551234',
                  company: 'HubSpot Target Co',
                  jobtitle: 'VP of Sales',
                  hs_lead_status: 'IN_PROGRESS',
                  lastmodifieddate: new Date().toISOString()
                }
              }]
            })
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            properties: {
              lastmodifieddate: new Date().toISOString(),
              hs_lead_status: 'IN_PROGRESS'
            }
          })
        });
      });

      process.env.HUBSPOT_CLIENT_ID = 'client_hs';

      // Mock sinceTime as Date.now() - 100000
      const sinceTime = Date.now() - 100000;
      dbMockState.tenantSettings.hubspot.last_sync_at = sinceTime;

      await hubspotService.syncHubSpot(TENANT_A_ID);

      // Verify lead updated query
      const updateCheck = mockClient.query.mock.calls.some(call =>
        call[0].toUpperCase().includes('UPDATE LEADS') &&
        call[1].includes('replied') // mapped from IN_PROGRESS
      );
      expect(updateCheck).toBe(true);

      // Both modified since sinceTime, verify conflict logged in audit logs
      const conflictCheck = mockClient.query.mock.calls.some(call =>
        call[0].toUpperCase().includes('INSERT INTO AUDIT_LOGS') &&
        call[0].includes('HUBSPOT_SYNC_CONFLICT')
      );
      expect(conflictCheck).toBe(true);

      delete process.env.HUBSPOT_CLIENT_ID;
    });
  });

  describe('Real-time Triggers (Deals, Status, Activities)', () => {
    it('pushLeadUpdate — patches HubSpot contact status when status changes in app', async () => {
      process.env.HUBSPOT_CLIENT_ID = 'client_hs';
      global.fetch = jest.fn().mockResolvedValue({ ok: true });

      dbMockState.lead.status = 'replied';

      await hubspotService.pushLeadUpdate(TENANT_A_ID, LEAD_A_ID);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.hubapi.com/crm/v3/objects/contacts/hs_contact_id_999',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ properties: { hs_lead_status: 'IN_PROGRESS' } })
        })
      );

      delete process.env.HUBSPOT_CLIENT_ID;
    });

    it('createHubSpotDeal — creates Deal and links to contact when meeting scheduled webhook executes', async () => {
      process.env.HUBSPOT_CLIENT_ID = 'client_hs';
      
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'hs_deal_uuid_100' }) // created Deal
        })
        .mockResolvedValueOnce({
          ok: true // associated
        });

      await hubspotService.createHubSpotDeal(TENANT_A_ID, MEETING_A_ID);

      // Assert Deal creation body structure
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        'https://api.hubapi.com/crm/v3/objects/deals',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            properties: {
              dealname: 'Sales Outreach Deal — HubSpot Prospect',
              dealstage: 'appointmentscheduled',
              pipeline: 'default'
            }
          })
        })
      );

      // Assert Deal-to-Contact association URL
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'https://api.hubapi.com/crm/v3/objects/deals/hs_deal_uuid_100/associations/contacts/hs_contact_id_999/3',
        expect.objectContaining({ method: 'PUT' })
      );

      // Assert local DB updated meeting record metadata
      const dbUpdateMeet = mockClient.query.mock.calls.some(call =>
        call[0].toUpperCase().includes('UPDATE MEETINGS SET MEETING_METADATA') &&
        call[1][0].includes('hs_deal_uuid_100')
      );
      expect(dbUpdateMeet).toBe(true);

      delete process.env.HUBSPOT_CLIENT_ID;
    });

    it('logEmailActivity — registers communications / email activity history in CRM contact', async () => {
      process.env.HUBSPOT_CLIENT_ID = 'client_hs';
      
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'hs_activity_uuid_200' })
        })
        .mockResolvedValueOnce({
          ok: true
        });

      await hubspotService.logEmailActivity(TENANT_A_ID, MSG_A_ID);

      // Assert Email creation structure
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        'https://api.hubapi.com/crm/v3/objects/emails',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Email body copy text for HubSpot integration test.')
        })
      );

      // Assert association URL (type 10 is email-to-contact)
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'https://api.hubapi.com/crm/v3/objects/emails/hs_activity_uuid_200/associations/contacts/hs_contact_id_999/10',
        expect.objectContaining({ method: 'PUT' })
      );

      delete process.env.HUBSPOT_CLIENT_ID;
    });
  });

  describe('API Controller Actions & manual sync triggers', () => {
    it('GET /api/integrations/hubspot/connect — returns OAuth redirect link', async () => {
      const token = generateToken(TENANT_A_ID);
      const res = await request(app)
        .get('/api/integrations/hubspot/connect')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.url).toContain('https://app.hubspot.com/oauth/authorize');
    });

    it('GET /api/integrations/hubspot/callback — processes code redirection Callback', async () => {
      const state = JSON.stringify({ tenantId: TENANT_A_ID });
      const res = await request(app)
        .get(`/api/integrations/hubspot/callback?code=mock_code&state=${encodeURIComponent(state)}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('successfully');
    });

    it('POST /api/integrations/hubspot/sync — manual trigger sync updates from dashboard', async () => {
      const token = generateToken(TENANT_A_ID);
      const res = await request(app)
        .post('/api/integrations/hubspot/sync')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('completed');
    });
  });
});
