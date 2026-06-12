const request = require('supertest');
const jwt = require('jsonwebtoken');

// 1. Mock pg database module before importing app and db
let mockTenantPlan = 'free';
let mockTenantStatus = 'active';
let mockEmailsSent = 0;
let mockLeadsImported = 0;
let mockFailedPayments = 0;
let mockLeadsUpdatedCount = 0;
let dbQueriesExecuted = [];

const mockClient = {
  query: jest.fn().mockImplementation(async (sql, params) => {
    dbQueriesExecuted.push({ sql, params });
    const sqlUpper = sql.toUpperCase();

    if (sqlUpper.includes('SET APP.CURRENT_TENANT_ID') || sqlUpper.includes('RESET APP.CURRENT_TENANT_ID')) {
      return { rows: [] };
    }

    if (sqlUpper.includes('SELECT ID, NAME, PLAN, TRIAL_START')) {
      return {
        rows: [{
          id: 'tenant-uuid',
          name: 'Test Tenant',
          plan: mockTenantPlan,
          subscription_status: mockTenantStatus,
          trial_start: new Date(Date.now() - (mockFailedPayments === 99 ? 14 : 12) * 24 * 3600 * 1000), // failedPayments=99 triggers Day 14
          trial_end: new Date(),
        }],
      };
    }

    if (sqlUpper.includes('FROM TENANTS')) {
      return {
        rows: [{
          id: 'tenant-uuid',
          name: 'Test Tenant',
          plan: mockTenantPlan,
          subscription_status: mockTenantStatus,
          emails_sent_count: mockEmailsSent,
          leads_imported_count: mockLeadsImported,
          failed_payment_attempts: mockFailedPayments,
          stripe_customer_id: 'cus_mock_123',
          stripe_subscription_id: 'sub_mock_123',
          trial_start: new Date(Date.now() - (12 * 24 * 3600 * 1000)), // default: Day 12
          trial_end: new Date(Date.now() + (2 * 24 * 3600 * 1000)),
        }],
      };
    }

    if (sqlUpper.includes('UPDATE LEADS SET SEQUENCE_PAUSED')) {
      mockLeadsUpdatedCount++;
      return { rows: [] };
    }

    if (sqlUpper.includes('UPDATE TENANTS SET PLAN')) {
      // Mock plan update
      if (params.includes('startup')) mockTenantPlan = 'startup';
      if (params.includes('free')) mockTenantPlan = 'free';
      return { rows: [] };
    }

    if (sqlUpper.includes('SELECT * FROM LEADS WHERE ID')) {
      return { rows: [{ id: params[0], name: 'Lead', status: 'new', email: 'test@lead.com', consent_given: true }] };
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

// Mock Stripe library methods
const mockRetrieveSubscription = jest.fn().mockResolvedValue({
  id: 'sub_mock_123',
  status: 'active',
  current_period_start: 1718000000,
  current_period_end: 1720000000,
  items: {
    data: [{ price: { id: 'price_startup_mock' } }],
  },
});

jest.mock('stripe', () => {
  return jest.fn(() => ({
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/pay/mock_session' }),
      },
    },
    billingPortal: {
      sessions: {
        create: jest.fn().mockResolvedValue({ url: 'https://billing.stripe.com/portal/mock_session' }),
      },
    },
    subscriptions: {
      retrieve: mockRetrieveSubscription,
    },
  }));
});
jest.mock('../services/hubspotService', () => ({
  syncHubSpot: jest.fn().mockResolvedValue({ success: true }),
  pushLeadUpdate: jest.fn().mockResolvedValue({ success: true }),
  logEmailActivity: jest.fn().mockResolvedValue({ success: true }),
}));

const app = require('../server');
const billingService = require('../services/billingService');
const JWT_SECRET = process.env.JWT_SECRET || 'sales_agent_super_secret_token';
const TENANT_ID = '00000000-0000-0000-0000-111111111111';

function generateToken(role = 'admin') {
  return jwt.sign(
    { userId: 'user-uuid', tenantId: TENANT_ID, role, email: 'admin@tenant.com' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('Stripe Billing & Subscription SaaS Integration Tests', () => {
  let token;

  beforeEach(() => {
    jest.clearAllMocks();
    dbQueriesExecuted = [];
    mockTenantPlan = 'free';
    mockTenantStatus = 'active';
    mockEmailsSent = 0;
    mockLeadsImported = 0;
    mockFailedPayments = 0;
    mockLeadsUpdatedCount = 0;
    token = generateToken();
  });

  describe('1. Billing Plan Quota & Feature Enforcement', () => {
    it('should allow HubSpot CRM sync on Startup plan, but reject with 403 on Free plan', async () => {
      // Test A: Free plan
      mockTenantPlan = 'free';
      const resFree = await request(app)
        .post('/api/integrations/hubspot/sync')
        .set('Authorization', `Bearer ${token}`);

      expect(resFree.status).toBe(403);
      expect(resFree.body.error).toContain('CRM integrations are not supported');

      // Test B: Startup plan
      mockTenantPlan = 'startup';
      const resStartup = await request(app)
        .post('/api/integrations/hubspot/sync')
        .set('Authorization', `Bearer ${token}`);

      expect(resStartup.status).toBe(200);
      expect(resStartup.body.success).toBe(true);
    });

    it('should reject email sends with 402 if billing cycle quota is exceeded', async () => {
      mockTenantPlan = 'free';
      mockEmailsSent = 50; // Free limit is 50

      const response = await request(app)
        .post('/api/messages/send')
        .set('Authorization', `Bearer ${token}`)
        .send({ leadId: 'lead-uuid', channel: 'email' });

      expect(response.status).toBe(402);
      expect(response.body.code).toBe('EMAIL_QUOTA_EXCEEDED');
    });

    it('should block SMS channel with 403 on Free plan, but allow it on Startup', async () => {
      // Test A: Free plan
      mockTenantPlan = 'free';
      const resFree = await request(app)
        .post('/api/messages/send')
        .set('Authorization', `Bearer ${token}`)
        .send({ leadId: 'lead-uuid', channel: 'sms' });

      expect(resFree.status).toBe(403);
      expect(resFree.body.code).toBe('CHANNEL_RESTRICTED');

      // Test B: Startup plan
      mockTenantPlan = 'startup';
      const resStartup = await request(app)
        .post('/api/messages/send')
        .set('Authorization', `Bearer ${token}`)
        .send({ leadId: 'lead-uuid', channel: 'sms' });

      expect(resStartup.status).toBe(200);
      expect(resStartup.body.success).toBe(true);
    });

    it('should enforce lead import quota limits (HTTP 402)', async () => {
      mockTenantPlan = 'free';
      mockLeadsImported = 48; // Free limit is 50

      const payload = {
        leads: [
          { name: 'Lead 1', email: 'l1@test.com' },
          { name: 'Lead 2', email: 'l2@test.com' },
          { name: 'Lead 3', email: 'l3@test.com' } // Importing 3 puts usage at 51 (> 50)
        ]
      };

      const response = await request(app)
        .post('/api/leads/import')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(response.status).toBe(402);
      expect(response.body.code).toBe('LEAD_QUOTA_EXCEEDED');
    });
  });

  describe('2. Stripe Checkout & Customer Portal Endpoints', () => {
    it('should generate a valid Stripe Checkout url (HTTP 200)', async () => {
      const response = await request(app)
        .post('/api/billing/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send({
          planType: 'startup',
          successUrl: 'http://localhost/success',
          cancelUrl: 'http://localhost/cancel'
        });

      expect(response.status).toBe(200);
      expect(response.body.checkoutUrl).toBe('https://checkout.stripe.com/pay/mock_session');
    });

    it('should generate a valid Customer Portal url (HTTP 200)', async () => {
      const response = await request(app)
        .post('/api/billing/portal')
        .set('Authorization', `Bearer ${token}`)
        .send({
          returnUrl: 'http://localhost/dashboard'
        });

      expect(response.status).toBe(200);
      expect(response.body.portalUrl).toBe('https://billing.stripe.com/portal/mock_session');
    });
  });

  describe('3. Stripe Webhook Receivers', () => {
    it('should process checkout.session.completed and upgrade tenant plan', async () => {
      const payload = {
        type: 'checkout.session.completed',
        data: {
          object: {
            client_reference_id: TENANT_ID,
            customer: 'cus_new_999',
            subscription: 'sub_new_999'
          }
        }
      };

      const response = await request(app)
        .post('/api/billing/webhook')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body.received).toBe(true);

      const updateQuery = dbQueriesExecuted.find(q => q.sql.includes('UPDATE tenants SET'));
      expect(updateQuery).toBeDefined();
      expect(updateQuery.params[0]).toBe('cus_new_999');
      expect(updateQuery.params[2]).toBe('startup'); // mapped price price_startup_mock -> startup
    });

    it('should process customer.subscription.deleted and downgrade tenant to free', async () => {
      const payload = {
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_cancel_123'
          }
        }
      };

      const response = await request(app)
        .post('/api/billing/webhook')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body.received).toBe(true);

      const updateQuery = dbQueriesExecuted.find(q => q.sql.includes("UPDATE tenants SET \n            plan = 'free'"));
      expect(updateQuery).toBeDefined();
      expect(mockLeadsUpdatedCount).toBe(1); // sequence_paused trigger executed
    });
  });

  describe('4. Dunning Logic Verification', () => {
    it('should handle invoice.payment_failed, increment attempts, and pause sequences', async () => {
      mockFailedPayments = 1;

      const payload = {
        type: 'invoice.payment_failed',
        data: {
          object: {
            customer: 'cus_pastdue_123'
          }
        }
      };

      const response = await request(app)
        .post('/api/billing/webhook')
        .send(payload);

      expect(response.status).toBe(200);
      expect(mockLeadsUpdatedCount).toBe(1); // Leads paused during grace period

      const updateAttempts = dbQueriesExecuted.find(q => q.sql.includes('failed_payment_attempts = $1'));
      expect(updateAttempts).toBeDefined();
      expect(updateAttempts.params[0]).toBe(2); // incremented 1 -> 2
    });

    it('should automatically downgrade tenant to Free after 3 failed payment attempts', async () => {
      mockFailedPayments = 2; // Next failure will make it 3

      const payload = {
        type: 'invoice.payment_failed',
        data: {
          object: {
            customer: 'cus_pastdue_123'
          }
        }
      };

      const response = await request(app)
        .post('/api/billing/webhook')
        .send(payload);

      expect(response.status).toBe(200);
      expect(mockLeadsUpdatedCount).toBe(1); // Leads paused

      const downgradeQuery = dbQueriesExecuted.find(q => q.sql.includes("plan = 'free'"));
      expect(downgradeQuery).toBeDefined();
    });
  });

  describe('5. Free Trial (14-Day startup plan) Cron Checks', () => {
    it('should log warning alert on Day 12 of trial', async () => {
      mockFailedPayments = 0; // indicates trial duration: Day 12
      
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      
      await billingService.checkTrials();

      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('trial ends in 2 days'));
      consoleWarnSpy.mockRestore();
    });

    it('should automatically downgrade tenant and pause sequences on Day 14+ of trial', async () => {
      mockFailedPayments = 99; // Mock will trigger Day 14 trial date elapsed
      
      await billingService.checkTrials();

      const downgradeQuery = dbQueriesExecuted.find(q => q.sql.includes("plan = 'free'"));
      expect(downgradeQuery).toBeDefined();
      expect(mockLeadsUpdatedCount).toBe(1); // Leads paused
    });
  });
});
