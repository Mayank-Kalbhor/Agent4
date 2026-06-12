jest.resetModules();
require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');

const TENANT_A_ID = '00000000-0000-0000-0000-111111111111';
const USER_A_ID = '00000000-0000-0000-0000-333333333333';
const LEAD_A_ID = '00000000-0000-0000-0000-aaaaaaaaaaaa';
const MEETING_A_ID = '00000000-0000-0000-0000-bbbbbbbbbbbb';
const JWT_SECRET = process.env.JWT_SECRET || 'sales_agent_super_secret_token';

let dbMockState = {
  userCalendarLink: 'https://calendly.com/mock-sales-rep',
  tenantBookingLink: 'https://calendly.com/tenant-sales',
  lead: {
    id: LEAD_A_ID,
    tenant_id: TENANT_A_ID,
    name: 'Alice Smith',
    email: 'alice.smith@acme.com',
    company: 'Acme Corp',
    status: 'new'
  },
  meeting: {
    id: MEETING_A_ID,
    tenant_id: TENANT_A_ID,
    lead_id: LEAD_A_ID,
    scheduled_at: '2026-06-15T10:00:00Z',
    calendar_event_id: 'evt-123',
    booking_link: 'https://calendly.com/mock-sales-rep',
    status: 'scheduled',
    timezone: 'UTC'
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

    if (sqlUpper.includes('SELECT CALENDAR_LINK FROM USERS')) {
      return { rows: dbMockState.userCalendarLink ? [{ calendar_link: dbMockState.userCalendarLink }] : [] };
    }

    if (sqlUpper.includes('SELECT SETTINGS FROM Tenants') || sqlUpper.includes('SELECT SETTINGS FROM TENANTS')) {
      return { rows: [{ settings: { booking_link: dbMockState.tenantBookingLink } }] };
    }

    if (sqlUpper.includes('SELECT * FROM LEADS WHERE EMAIL') || sqlUpper.includes('SELECT * FROM LEADS WHERE ID')) {
      return { rows: [dbMockState.lead] };
    }

    if (sqlUpper.includes('SELECT * FROM MEETINGS WHERE CALENDAR_EVENT_ID')) {
      return { rows: [] }; // Upsert checks return empty initially
    }

    if (sqlUpper.includes('INSERT INTO MEETINGS') || sqlUpper.includes('UPDATE MEETINGS')) {
      return { rows: [dbMockState.meeting] };
    }

    if (sqlUpper.includes('UPDATE USERS')) {
      return { rows: [] };
    }

    if (sqlUpper.includes('INSERT INTO AUDIT_LOGS') || sqlUpper.includes('INSERT INTO MESSAGES')) {
      return { rows: [{ id: 'some-inserted-id' }] };
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

// Mock the schedulerService to avoid in-memory timeouts running asynchronously
jest.mock('../services/schedulerService', () => {
  return {
    cancelFollowUps: jest.fn().mockResolvedValue(true),
    scheduleFollowUps: jest.fn().mockResolvedValue(true)
  };
});

const app = require('../server');
const bookingService = require('../services/bookingService');
const schedulerService = require('../services/schedulerService');

function generateToken(tenantId, userId = USER_A_ID) {
  return jwt.sign(
    { userId, tenantId, tenant_id: tenantId, role: 'rep', email: 'rep@saas.com' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('Meeting Booking Integration Module Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.query.mockClear();
    dbMockState = {
      userCalendarLink: 'https://calendly.com/mock-sales-rep',
      tenantBookingLink: 'https://calendly.com/tenant-sales',
      lead: {
        id: LEAD_A_ID,
        tenant_id: TENANT_A_ID,
        name: 'Alice Smith',
        email: 'alice.smith@acme.com',
        company: 'Acme Corp',
        status: 'new'
      },
      meeting: {
        id: MEETING_A_ID,
        tenant_id: TENANT_A_ID,
        lead_id: LEAD_A_ID,
        scheduled_at: '2026-06-15T10:00:00Z',
        calendar_event_id: 'evt-123',
        booking_link: 'https://calendly.com/mock-sales-rep',
        status: 'scheduled',
        timezone: 'UTC'
      }
    };
  });

  describe('Core Service Logic', () => {
    it('getOAuthUrl — should return a valid OAuth redirection URL', () => {
      const url = bookingService.getOAuthUrl(TENANT_A_ID, USER_A_ID, 'calendly');
      expect(url).toContain('https://auth.calendly.com/oauth/authorize');
      expect(url).toContain('client_id=');
      expect(url).toContain(encodeURIComponent(JSON.stringify({ tenantId: TENANT_A_ID, userId: USER_A_ID, provider: 'calendly' })));
    });

    it('handleOAuthCallback — exchanges authorization code and updates user connection settings', async () => {
      const result = await bookingService.handleOAuthCallback('mock_code_abc', TENANT_A_ID, USER_A_ID, 'calendly');
      expect(result.calendarLink).toBeDefined();
      
      // Verify DB update is called
      const hasUpdate = mockClient.query.mock.calls.some(call => 
        call[0].toUpperCase().includes('UPDATE USERS SET CALENDAR_LINK')
      );
      expect(hasUpdate).toBe(true);

      // Verify audit logs are populated
      const hasAudit = mockClient.query.mock.calls.some(call => 
        call[0].toUpperCase().includes('CONNECT_CALENDAR_INTEGRATION')
      );
      expect(hasAudit).toBe(true);
    });

    it('fetchSchedulingLink — should return user calendar link if configured', async () => {
      const link = await bookingService.fetchSchedulingLink(TENANT_A_ID, USER_A_ID);
      expect(link).toBe('https://calendly.com/mock-sales-rep');
    });

    it('fetchSchedulingLink — should fall back to tenant booking link if user profile link is missing', async () => {
      dbMockState.userCalendarLink = null;
      const link = await bookingService.fetchSchedulingLink(TENANT_A_ID, USER_A_ID);
      expect(link).toBe('https://calendly.com/tenant-sales');
    });

    it('fetchSchedulingLink — should return default company link if both are missing', async () => {
      dbMockState.userCalendarLink = null;
      dbMockState.tenantBookingLink = null;
      const link = await bookingService.fetchSchedulingLink(TENANT_A_ID, USER_A_ID);
      expect(link).toBe('https://calendly.com/sales-team');
    });
  });

  describe('Webhook Event Processing', () => {
    it('processWebhookEvent (invitee.created) — schedules meeting, cancels follow-ups, updates lead status, and logs outbound invite email', async () => {
      const payload = {
        email: 'alice.smith@acme.com',
        scheduledAt: '2026-06-15T10:00:00Z',
        bookingLink: 'https://calendly.com/mock-sales-rep',
        calendarEventId: 'evt-123',
        timezone: 'America/New_York',
        metadata: {}
      };

      const meeting = await bookingService.processWebhookEvent(TENANT_A_ID, 'invitee.created', payload);
      expect(meeting).toBeDefined();

      // Lead status updated
      const hasLeadUpdate = mockClient.query.mock.calls.some(call => 
        call[0].toUpperCase().includes('UPDATE LEADS SET STATUS') && call[0].includes('meeting_scheduled')
      );
      expect(hasLeadUpdate).toBe(true);

      // Followups cancelled
      expect(schedulerService.cancelFollowUps).toHaveBeenCalledWith(LEAD_A_ID);

      // Sent email logged
      const hasEmailLogged = mockClient.query.mock.calls.some(call => 
        call[0].toUpperCase().includes('INSERT INTO MESSAGES') && call[1].includes('Meeting Confirmed: AI Sales Discussion')
      );
      expect(hasEmailLogged).toBe(true);
    });

    it('processWebhookEvent (invitee.created) — reschedules meeting by updating old meeting status', async () => {
      const payload = {
        email: 'alice.smith@acme.com',
        scheduledAt: '2026-06-15T10:00:00Z',
        bookingLink: 'https://calendly.com/mock-sales-rep',
        calendarEventId: 'evt-456',
        oldCalendarEventId: 'evt-123',
        timezone: 'America/New_York',
        rescheduled: true
      };

      await bookingService.processWebhookEvent(TENANT_A_ID, 'invitee.created', payload);

      const hasOldMeetingUpdate = mockClient.query.mock.calls.some(call => 
        call[0].toUpperCase().includes("UPDATE MEETINGS SET STATUS = 'RESCHEDULED'") && call[1].includes('evt-123')
      );
      expect(hasOldMeetingUpdate).toBe(true);
    });

    it('processWebhookEvent (invitee.canceled) — updates meeting status and resets lead status to replied', async () => {
      const payload = {
        email: 'alice.smith@acme.com',
        calendarEventId: 'evt-123'
      };

      await bookingService.processWebhookEvent(TENANT_A_ID, 'invitee.canceled', payload);

      const hasMeetingCancel = mockClient.query.mock.calls.some(call => 
        call[0].toUpperCase().includes("UPDATE MEETINGS SET STATUS = 'CANCELED'") && call[1].includes('evt-123')
      );
      expect(hasMeetingCancel).toBe(true);

      const hasLeadReset = mockClient.query.mock.calls.some(call => 
        call[0].toUpperCase().includes("UPDATE LEADS SET STATUS = 'REPLIED'") && call[1].includes(LEAD_A_ID)
      );
      expect(hasLeadReset).toBe(true);
    });

    it('processWebhookEvent (no_show) — updates meeting status to no_show', async () => {
      const payload = {
        email: 'alice.smith@acme.com',
        calendarEventId: 'evt-123'
      };

      await bookingService.processWebhookEvent(TENANT_A_ID, 'no_show', payload);

      const hasNoShowUpdate = mockClient.query.mock.calls.some(call => 
        call[0].toUpperCase().includes("UPDATE MEETINGS SET STATUS = 'NO_SHOW'") && call[1].includes('evt-123')
      );
      expect(hasNoShowUpdate).toBe(true);
    });
  });

  describe('API Routing Integrations', () => {
    it('GET /api/integrations/oauth/connect — generates OAuth URL', async () => {
      const token = generateToken(TENANT_A_ID);
      const res = await request(app)
        .get('/api/integrations/oauth/connect?provider=calendly')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.url).toContain('https://auth.calendly.com/oauth/authorize');
    });

    it('GET /api/integrations/oauth/callback — processes code and links account', async () => {
      const state = JSON.stringify({ tenantId: TENANT_A_ID, userId: USER_A_ID, provider: 'calendly' });
      const res = await request(app)
        .get(`/api/integrations/oauth/callback?code=mock_code&state=${encodeURIComponent(state)}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('successfully');
      expect(res.body.link).toBe('https://calendly.com/mock-sales-rep');
    });

    it('POST /api/meetings/webhook — receives webhook and dispatches to bookingService', async () => {
      const payload = {
        email: 'alice.smith@acme.com',
        scheduledAt: '2026-06-15T10:00:00Z',
        bookingLink: 'https://calendly.com/mock-sales-rep',
        calendarEventId: 'evt-123',
        timezone: 'UTC'
      };

      const res = await request(app)
        .post('/api/meetings/webhook')
        .send({
          tenantId: TENANT_A_ID,
          eventType: 'invitee.created',
          payload
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.meeting).toBeDefined();
    });

    it('POST /api/simulator/no-show — simulates client no show', async () => {
      const res = await request(app)
        .post('/api/simulator/no-show')
        .send({
          tenantId: TENANT_A_ID,
          calendarEventId: 'evt-123'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      
      const hasNoShowUpdate = mockClient.query.mock.calls.some(call => 
        call[0].toUpperCase().includes("UPDATE MEETINGS SET STATUS = 'NO_SHOW'") && call[1].includes('evt-123')
      );
      expect(hasNoShowUpdate).toBe(true);
    });

    it('POST /api/simulator/reschedule — simulates rescheduled booking', async () => {
      const res = await request(app)
        .post('/api/simulator/reschedule')
        .send({
          tenantId: TENANT_A_ID,
          email: 'alice.smith@acme.com',
          scheduledAt: '2026-06-15T11:00:00Z',
          bookingLink: 'https://calendly.com/mock-sales-rep',
          calendarEventId: 'evt-789',
          oldCalendarEventId: 'evt-123',
          timezone: 'America/New_York'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const hasOldMeetingUpdate = mockClient.query.mock.calls.some(call => 
        call[0].toUpperCase().includes("UPDATE MEETINGS SET STATUS = 'RESCHEDULED'") && call[1].includes('evt-123')
      );
      expect(hasOldMeetingUpdate).toBe(true);
    });
  });
});
