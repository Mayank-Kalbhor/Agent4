jest.resetModules();
require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// 1. Mock otplib to prevent Jest ESM parser errors on @scure/base
jest.mock('otplib', () => {
  return {
    generateSecret: jest.fn(() => 'MOCKSECRET1234567890'),
    generateURI: jest.fn(({ secret, label, issuer }) => `otpauth://totp/${issuer}:${label}?secret=${secret}`),
    verifySync: jest.fn(({ token, secret }) => {
      return { valid: token === '123456' };
    }),
    verify: jest.fn(async ({ token, secret }) => {
      return { valid: token === '123456' };
    }),
  };
});

// 2. Mock PG database client with in-memory database simulation
const dbState = {
  tenants: [],
  users: [],
  refresh_tokens: [],
  audit_logs: [],
  leads: [],
  messages: [],
  meetings: []
};

function resetDb() {
  dbState.tenants = [];
  dbState.users = [];
  dbState.refresh_tokens = [];
  dbState.audit_logs = [];
  dbState.leads = [];
  dbState.messages = [];
  dbState.meetings = [];
}

const mockClient = {
  query: jest.fn().mockImplementation(async (sql, params) => {
    const s = (sql || '').trim().replace(/\s+/g, ' ');
    const sUpper = s.toUpperCase();

    // RLS config
    if (sUpper.includes('SET APP.CURRENT_TENANT_ID') || sUpper.includes('RESET APP.CURRENT_TENANT_ID')) {
      return { rows: [] };
    }

    // SELECT FROM users BY email
    if (sUpper.includes('FROM USERS WHERE EMAIL = $1')) {
      const email = params[0];
      const match = dbState.users.filter(u => u.email === email);
      return { rows: match };
    }

    // SELECT FROM users BY id
    if (sUpper.includes('FROM USERS WHERE ID = $1')) {
      const id = params[0];
      const match = dbState.users.filter(u => u.id === id);
      return { rows: match };
    }

    // SELECT two_factor_secret FROM users WHERE id = $1
    if (sUpper.includes('SELECT TWO_FACTOR_SECRET FROM USERS WHERE ID = $1')) {
      const id = params[0];
      const match = dbState.users.filter(u => u.id === id).map(u => ({ two_factor_secret: u.two_factor_secret }));
      return { rows: match };
    }

    // INSERT INTO tenants
    if (sUpper.includes('INSERT INTO TENANTS')) {
      const name = params[0] || 'SSO Tenant';
      const id = require('crypto').randomUUID();
      const newTenant = { id, name, settings: {} };
      dbState.tenants.push(newTenant);
      return { rows: [{ id }] };
    }

    // SELECT name FROM tenants
    if (sUpper.includes('FROM TENANTS WHERE ID = $1')) {
      const id = params[0];
      const match = dbState.tenants.filter(t => t.id === id);
      return { rows: match };
    }

    // INSERT INTO users
    if (sUpper.includes('INSERT INTO USERS')) {
      const tenant_id = params[0];
      const email = params[1];
      
      let role = 'rep';
      let hashed_password = '';
      let sso_provider = null;

      if (sUpper.includes('SSO_PROVIDER')) {
        // format: VALUES ($1, $2, 'rep', $3, 'google') or similar
        // params: [tenantId, email, hashedPassword]
        hashed_password = params[2];
        sso_provider = sUpper.includes('GOOGLE') ? 'google' : 'saml';
      } else {
        // format: VALUES ($1, $2, $3, $4)
        // params: [tenantId, email, role, hashedPassword]
        role = params[2] || 'rep';
        hashed_password = params[3];
      }

      const id = require('crypto').randomUUID();
      const newUser = { id, tenant_id, email, role, hashed_password, sso_provider, two_factor_enabled: false, two_factor_secret: null };
      dbState.users.push(newUser);
      return { rows: [newUser] };
    }

    // UPDATE users set secret
    if (sUpper.includes('UPDATE USERS SET TWO_FACTOR_SECRET = $1 WHERE ID = $2')) {
      const secret = params[0];
      const id = params[1];
      const user = dbState.users.find(u => u.id === id);
      if (user) {
        user.two_factor_secret = secret;
      }
      return { rows: [] };
    }

    // UPDATE users enable 2FA
    if (sUpper.includes('UPDATE USERS SET TWO_FACTOR_ENABLED = TRUE WHERE ID = $1')) {
      const id = params[0];
      const user = dbState.users.find(u => u.id === id);
      if (user) {
        user.two_factor_enabled = true;
      }
      return { rows: [] };
    }

    // INSERT INTO audit_logs
    if (sUpper.includes('INSERT INTO AUDIT_LOGS')) {
      const tenant_id = params[0];
      const user_id = params[1];
      const action = params[2];
      const entity_type = params[3];
      const entity_id = params[4];
      const metadata = params[5] ? JSON.parse(params[5]) : {};
      const newLog = { id: require('crypto').randomUUID(), tenant_id, user_id, action, entity_type, entity_id, metadata, created_at: new Date() };
      dbState.audit_logs.push(newLog);
      return { rows: [newLog] };
    }

    // INSERT INTO refresh_tokens
    if (sUpper.includes('INSERT INTO REFRESH_TOKENS')) {
      const token = params[0];
      const user_id = params[1];
      const tenant_id = params[2];
      const expires_at = params[3];
      const id = require('crypto').randomUUID();
      const newRToken = { id, token, user_id, tenant_id, expires_at, revoked: false, created_at: new Date() };
      dbState.refresh_tokens.push(newRToken);
      return { rows: [newRToken] };
    }

    // SELECT FROM refresh_tokens
    if (sUpper.includes('FROM REFRESH_TOKENS WHERE TOKEN = $1')) {
      const token = params[0];
      const match = dbState.refresh_tokens.filter(r => r.token === token);
      return { rows: match };
    }

    // UPDATE refresh_tokens (revoke user tokens)
    if (sUpper.includes('UPDATE REFRESH_TOKENS SET REVOKED = TRUE WHERE USER_ID = $1')) {
      const user_id = params[0];
      dbState.refresh_tokens.forEach(r => {
        if (r.user_id === user_id) {
          r.revoked = true;
        }
      });
      return { rows: [] };
    }

    // UPDATE refresh_tokens (revoke specific token)
    if (sUpper.includes('UPDATE REFRESH_TOKENS SET REVOKED = TRUE WHERE ID = $1')) {
      const id = params[0];
      const token = dbState.refresh_tokens.find(r => r.id === id);
      if (token) {
        token.revoked = true;
      }
      return { rows: [] };
    }

    // UPDATE refresh_tokens (revoke by token string)
    if (sUpper.includes('UPDATE REFRESH_TOKENS SET REVOKED = TRUE WHERE TOKEN = $1')) {
      const tokenStr = params[0];
      const token = dbState.refresh_tokens.find(r => r.token === tokenStr);
      if (token) {
        token.revoked = true;
      }
      return { rows: [] };
    }

    // SELECT from leads
    if (sUpper.includes('SELECT ASSIGNED_TO FROM LEADS WHERE ID = $1')) {
      const id = params[0];
      const match = dbState.leads.filter(l => l.id === id);
      return { rows: match };
    }

    if (sUpper.includes('FROM LEADS')) {
      if (sUpper.includes('ASSIGNED_TO = $1')) {
        const assigned_to = params[0];
        const match = dbState.leads.filter(l => l.assigned_to === assigned_to);
        return { rows: match };
      }
      return { rows: dbState.leads };
    }

    // INSERT INTO leads
    if (sUpper.includes('INSERT INTO LEADS')) {
      const tenant_id = params[0];
      const name = params[1];
      const email = params[2];
      const phone = params[3];
      const company = params[4];
      const title = params[5];
      const notes = params[6];
      const score = params[7];
      const similarity = params[8];
      const status = params[9];
      const enrichment_data = params[10] ? JSON.parse(params[10]) : {};
      const assigned_to = params[11] || null;
      const id = require('crypto').randomUUID();
      const newLead = { id, tenant_id, name, email, phone, company, title, notes, score, similarity, status, enrichment_data, assigned_to, created_at: new Date() };
      dbState.leads.push(newLead);
      return { rows: [newLead] };
    }

    // SELECT message lead ownership
    if (sUpper.includes('MESSAGES M JOIN LEADS L') && sUpper.includes('WHERE M.ID = $1')) {
      const messageId = params[0];
      const message = dbState.messages.find(m => m.id === messageId);
      if (message) {
        const lead = dbState.leads.find(l => l.id === message.lead_id);
        return { rows: [{ assigned_to: lead ? lead.assigned_to : null }] };
      }
      return { rows: [] };
    }

    // SELECT messages
    if (sUpper.includes('MESSAGES M JOIN LEADS L')) {
      let rows = dbState.messages.map(m => {
        const lead = dbState.leads.find(l => l.id === m.lead_id);
        return { ...m, lead_name: lead ? lead.name : 'Unknown' };
      });
      if (sUpper.includes('L.ASSIGNED_TO = $1')) {
        const userId = params[0];
        rows = rows.filter(m => {
          const lead = dbState.leads.find(l => l.id === m.lead_id);
          return lead && lead.assigned_to === userId;
        });
      }
      return { rows };
    }

    // SELECT meeting lead ownership
    if (sUpper.includes('MEETINGS M JOIN LEADS L') && sUpper.includes('WHERE M.ID = $1')) {
      const meetingId = params[0];
      const meeting = dbState.meetings.find(m => m.id === meetingId);
      if (meeting) {
        const lead = dbState.leads.find(l => l.id === meeting.lead_id);
        return { rows: [{ assigned_to: lead ? lead.assigned_to : null }] };
      }
      return { rows: [] };
    }

    // SELECT meetings
    if (sUpper.includes('MEETINGS M JOIN LEADS L')) {
      let rows = dbState.meetings.map(m => {
        const lead = dbState.leads.find(l => l.id === m.lead_id);
        return { ...m, lead_name: lead ? lead.name : 'Unknown', lead_company: lead ? lead.company : 'Unknown' };
      });
      if (sUpper.includes('L.ASSIGNED_TO = $1')) {
        const userId = params[0];
        rows = rows.filter(m => {
          const lead = dbState.leads.find(l => l.id === m.lead_id);
          return lead && lead.assigned_to === userId;
        });
      }
      return { rows };
    }

    // UPDATE leads sequence_paused
    if (sUpper.includes('UPDATE LEADS')) {
      const id = params[0];
      const lead = dbState.leads.find(l => l.id === id);
      if (lead) {
        if (sUpper.includes('SEQUENCE_PAUSED = TRUE')) {
          lead.sequence_paused = true;
        } else if (sUpper.includes('SEQUENCE_PAUSED = FALSE')) {
          lead.sequence_paused = false;
        }
      }
      return { rows: lead ? [lead] : [] };
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
  return { Pool: jest.fn(() => mockPool) };
});

// 3. Import app and services AFTER mocking pg and otplib
const app = require('../server');
const authService = require('../services/authService');

const JWT_SECRET = process.env.JWT_SECRET || 'sales_agent_super_secret_token';

describe('SaaS Authentication & Authorization Service Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDb();
  });

  describe('1. Registration and Password Security', () => {
    it('should register a user under a new tenant and hash the password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'admin@acme.com',
          password: 'securePassword123',
          role: 'admin',
          tenantName: 'Acme Corp'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.requires2fa).toBe(true); // admin requires 2FA
      expect(res.body.mfaToken).toBeDefined();

      // Check user was stored in DB
      const user = dbState.users.find(u => u.email === 'admin@acme.com');
      expect(user).toBeDefined();
      expect(user.role).toBe('admin');
      
      // Password must be hashed (not plain text)
      expect(user.hashed_password).not.toBe('securePassword123');
      const isMatch = await bcrypt.compare('securePassword123', user.hashed_password);
      expect(isMatch).toBe(true);
      
      // Tenant must be created
      expect(dbState.tenants.length).toBe(1);
      expect(dbState.tenants[0].id).toBe(user.tenant_id);

      // Audit log must contain registration success
      const logs = dbState.audit_logs.filter(l => l.action === 'REGISTER_SUCCESS');
      expect(logs.length).toBe(1);
    });

    it('should reject registration if email is already taken', async () => {
      // Seed db with existing user
      const hashed = await bcrypt.hash('pwd123', 10);
      dbState.users.push({
        id: 'user-0',
        tenant_id: 'tenant-0',
        email: 'taken@gmail.com',
        role: 'rep',
        hashed_password: hashed
      });

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'taken@gmail.com',
          password: 'pwd456',
          role: 'rep',
          tenantName: 'New Tenant'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('already registered');
    });
  });

  describe('2. Login and 2FA Verification Flow', () => {
    let adminUser, repUser;

    beforeEach(async () => {
      const hashed = await bcrypt.hash('pwd123', 10);
      // Seed an admin user
      adminUser = {
        id: 'admin-1',
        tenant_id: 'tenant-1',
        email: 'admin@test.com',
        role: 'admin',
        hashed_password: hashed,
        two_factor_enabled: false,
        two_factor_secret: null
      };
      dbState.users.push(adminUser);

      // Seed a rep user
      repUser = {
        id: 'rep-1',
        tenant_id: 'tenant-1',
        email: 'rep@test.com',
        role: 'rep',
        hashed_password: hashed,
        two_factor_enabled: false,
        two_factor_secret: null
      };
      dbState.users.push(repUser);
    });

    it('should let a rep login immediately without 2FA', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'rep@test.com', password: 'pwd123' });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.csrfToken).toBeDefined();
      expect(res.body.user.role).toBe('rep');
      expect(res.body.requires2fa).toBeUndefined();

      // Check cookie headers
      expect(res.headers['set-cookie']).toBeDefined();
      const cookies = res.headers['set-cookie'].join(';');
      expect(cookies).toContain('refresh_token');
      expect(cookies).toContain('XSRF-TOKEN');

      // Success audit log
      expect(dbState.audit_logs.some(l => l.action === 'LOGIN_SUCCESS')).toBe(true);
    });

    it('should force an admin to go through 2FA verification during login', async () => {
      // Enforce 2FA for admin
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'admin@test.com', password: 'pwd123' });

      expect(res.status).toBe(200);
      expect(res.body.requires2fa).toBe(true);
      expect(res.body.mfaToken).toBeDefined();

      const decodedMfa = jwt.verify(res.body.mfaToken, JWT_SECRET);
      expect(decodedMfa.userId).toBe(adminUser.id);
      expect(decodedMfa.partial).toBe(true);
    });

    it('should setup, verify, and complete 2FA login for an admin', async () => {
      // 1. Get MFA Token from initial login
      let res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'admin@test.com', password: 'pwd123' });
      const mfaToken = res.body.mfaToken;

      // 2. Setup 2FA secret and uri using the partial token
      res = await request(app)
        .post('/api/auth/2fa/setup')
        .set('Authorization', `Bearer ${mfaToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.secret).toBe('MOCKSECRET1234567890');
      expect(res.body.otpauth).toContain('AI-Sales-Agent-SaaS');

      // 3. Verify setup code to enable 2FA in DB
      res = await request(app)
        .post('/api/auth/2fa/verify')
        .set('Authorization', `Bearer ${mfaToken}`)
        .send({ code: '123456' }); // 123456 is mock valid code

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(adminUser.two_factor_enabled).toBe(true);

      // 4. Complete login using 2FA login route
      res = await request(app)
        .post('/api/auth/2fa/login')
        .send({ mfaToken, code: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.user.email).toBe('admin@test.com');

      // Verify audit log has LOGIN_SUCCESS
      expect(dbState.audit_logs.some(l => l.action === 'LOGIN_SUCCESS' && l.user_id === adminUser.id)).toBe(true);
    });

    it('should reject 2FA login with incorrect code and log failure', async () => {
      let res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'admin@test.com', password: 'pwd123' });
      const mfaToken = res.body.mfaToken;

      // Enable 2FA secret first
      adminUser.two_factor_secret = 'MOCKSECRET1234567890';
      adminUser.two_factor_enabled = true;

      res = await request(app)
        .post('/api/auth/2fa/login')
        .send({ mfaToken, code: '999999' }); // incorrect code

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Invalid 2FA code');

      // Failure audit log
      expect(dbState.audit_logs.some(l => l.action === '2FA_VERIFICATION_FAILED')).toBe(true);
    });
  });

  describe('3. Token Rotation & Replay Attack Defense', () => {
    let user;

    beforeEach(async () => {
      const hashed = await bcrypt.hash('pwd123', 10);
      user = {
        id: 'user-rot',
        tenant_id: 'tenant-rot',
        email: 'rot@test.com',
        role: 'rep',
        hashed_password: hashed
      };
      dbState.users.push(user);
    });

    it('should rotate access and refresh tokens on refresh requests', async () => {
      // Login to get tokens
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'rot@test.com', password: 'pwd123' });
      
      const originalCookie = loginRes.headers['set-cookie'].find(c => c.startsWith('refresh_token='));
      const originalTokenStr = originalCookie.split(';')[0].split('=')[1];

      expect(dbState.refresh_tokens.length).toBe(1);
      expect(dbState.refresh_tokens[0].token).toBe(originalTokenStr);

      // Perform refresh rotation
      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', `refresh_token=${originalTokenStr}`);

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.accessToken).toBeDefined();

      // Old refresh token must be revoked
      const oldToken = dbState.refresh_tokens.find(r => r.token === originalTokenStr);
      expect(oldToken.revoked).toBe(true);

      // New refresh token must be issued in cookies
      const newCookie = refreshRes.headers['set-cookie'].find(c => c.startsWith('refresh_token='));
      const newTokenStr = newCookie.split(';')[0].split('=')[1];
      expect(newTokenStr).not.toBe(originalTokenStr);
      expect(dbState.refresh_tokens.length).toBe(2);
      expect(dbState.refresh_tokens.find(r => r.token === newTokenStr).revoked).toBe(false);
    });

    it('should detect reuse (replay attack) of a revoked refresh token and invalidate all active sessions', async () => {
      // Generate two tokens
      const tokens1 = await authService.generateTokens(user);
      const tokens2 = await authService.generateTokens(user);

      expect(dbState.refresh_tokens.length).toBe(2);

      // Revoke the first one
      dbState.refresh_tokens[0].revoked = true;

      // Attempt rotation using the already-revoked token
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', `refresh_token=${tokens1.refreshToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('compromised');

      // Replay attack defense should revoke ALL refresh tokens for this user
      dbState.refresh_tokens.forEach(r => {
        expect(r.revoked).toBe(true);
      });
    });
  });

  describe('4. Google & SAML SSO Mock Mode', () => {
    it('should authenticate/provision via Google SSO Mock Mode redirect flow', async () => {
      const res = await request(app)
        .get('/api/auth/sso/google?email=new_google_user@gmail.com&json=true');

      // Google SSO route redirects to callback, which handles and returns JSON (since json=true query parameter is present)
      expect(res.status).toBe(302); // Redirect to callback
      const redirectUrl = res.headers['location'];
      expect(redirectUrl).toContain('/api/auth/sso/google/callback');

      // Now hit the callback directly requesting JSON
      const callbackRes = await request(app)
        .get(redirectUrl + '&json=true');

      expect(callbackRes.status).toBe(200);
      expect(callbackRes.body.accessToken).toBeDefined();
      expect(callbackRes.body.csrfToken).toBeDefined();
      expect(callbackRes.body.user.email).toBe('new_google_user@gmail.com');
      expect(callbackRes.body.user.role).toBe('rep');

      // User and tenant must be provisioned
      const user = dbState.users.find(u => u.email === 'new_google_user@gmail.com');
      expect(user).toBeDefined();
      expect(user.sso_provider).toBe('google');
      expect(dbState.tenants.some(t => t.id === user.tenant_id)).toBe(true);
    });

    it('should authenticate/provision via SAML SSO Mock Mode callback flow', async () => {
      const callbackRes = await request(app)
        .post('/api/auth/sso/saml/callback?json=true')
        .send({
          email: 'saml_corp@enterprise.com'
        });

      expect(callbackRes.status).toBe(200);
      expect(callbackRes.body.accessToken).toBeDefined();
      expect(callbackRes.body.csrfToken).toBeDefined();
      expect(callbackRes.body.user.email).toBe('saml_corp@enterprise.com');

      const user = dbState.users.find(u => u.email === 'saml_corp@enterprise.com');
      expect(user).toBeDefined();
      expect(user.sso_provider).toBe('saml');
    });
  });

  describe('5. Role-Based Access Control (RBAC) Scoping', () => {
    let adminToken, rep1Token, rep2Token;
    let lead1, lead2;

    beforeEach(async () => {
      const tenantId = 'tenant-rbac';

      // Register admin, rep1, rep2
      const admin = { id: 'admin-u', tenant_id: tenantId, email: 'admin@saas.com', role: 'admin' };
      const rep1 = { id: 'rep-u1', tenant_id: tenantId, email: 'rep1@saas.com', role: 'rep' };
      const rep2 = { id: 'rep-u2', tenant_id: tenantId, email: 'rep2@saas.com', role: 'rep' };
      dbState.users.push(admin, rep1, rep2);

      // Generate tokens
      adminToken = jwt.sign({ userId: admin.id, tenantId, role: 'admin', email: admin.email }, JWT_SECRET);
      rep1Token = jwt.sign({ userId: rep1.id, tenantId, role: 'rep', email: rep1.email }, JWT_SECRET);
      rep2Token = jwt.sign({ userId: rep2.id, tenantId, role: 'rep', email: rep2.email }, JWT_SECRET);

      // Seed leads (one assigned to rep1, one to rep2)
      lead1 = { id: 'lead-1', tenant_id: tenantId, name: 'Lead One', email: 'one@test.com', assigned_to: rep1.id };
      lead2 = { id: 'lead-2', tenant_id: tenantId, name: 'Lead Two', email: 'two@test.com', assigned_to: rep2.id };
      dbState.leads.push(lead1, lead2);
    });

    it('should allow reps to view only their own assigned leads', async () => {
      // Rep 1 views leads list
      const res = await request(app)
        .get('/api/leads')
        .set('Authorization', `Bearer ${rep1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe('lead-1');
    });

    it('should allow admins to view all tenant leads', async () => {
      // Admin views leads list
      const res = await request(app)
        .get('/api/leads')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
    });

    it('should block reps from accessing/pausing other reps leads', async () => {
      // Rep 1 attempts to pause Lead 2 (assigned to Rep 2)
      const res = await request(app)
        .post('/api/leads/lead-2/pause')
        .set('Authorization', `Bearer ${rep1Token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden: Rep does not own this lead');
    });

    it('should allow reps to pause their own leads', async () => {
      const res = await request(app)
        .post('/api/leads/lead-1/pause')
        .set('Authorization', `Bearer ${rep1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(lead1.sequence_paused).toBe(true);
    });
  });

  describe('6. Security & Protections (CSRF & Rate Limiting)', () => {
    let token;

    beforeEach(() => {
      token = jwt.sign({ userId: 'u-1', tenantId: 't-1', role: 'admin', email: 'a@a.com' }, JWT_SECRET);
    });

    it('should block state-changing requests if CSRF header is missing and x-test-csrf is sent', async () => {
      const res = await request(app)
        .post('/api/leads')
        .set('Authorization', `Bearer ${token}`)
        .set('x-test-csrf', 'true') // instruct middleware to enforce CSRF validation in tests
        .set('Cookie', 'XSRF-TOKEN=secret-csrf')
        .send({ name: 'CSRF Attempt', email: 'csrf@test.com' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('CSRF token mismatch');
    });

    it('should pass state-changing requests if matching CSRF header and cookie are sent', async () => {
      const res = await request(app)
        .post('/api/leads')
        .set('Authorization', `Bearer ${token}`)
        .set('x-test-csrf', 'true')
        .set('Cookie', 'XSRF-TOKEN=secret-csrf')
        .set('x-csrf-token', 'secret-csrf')
        .send({ name: 'CSRF Approved', email: 'csrf-ok@test.com' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('CSRF Approved');
    });

    it('should rate-limit authentication routes after 10 requests', async () => {
      // Fire 10 fast login requests (IP rate limiter maxes out at 10 requests / 1 minute)
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/api/auth/login')
          .set('x-test-rate-limit', 'true')
          .send({ email: 'rate@test.com', password: 'pwd' });
      }

      // The 11th request must get blocked with 429 Too Many Requests
      const blockRes = await request(app)
        .post('/api/auth/login')
        .set('x-test-rate-limit', 'true')
        .send({ email: 'rate@test.com', password: 'pwd' });

      expect(blockRes.status).toBe(429);
      expect(blockRes.body.error).toContain('Too many requests');
    });
  });
});
