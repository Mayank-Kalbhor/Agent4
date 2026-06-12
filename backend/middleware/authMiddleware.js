const { pool, query } = require('../db/db');

// In-Memory store for sliding window rate limiting
const rateLimitMap = new Map();

/**
 * CORS Origin Whitelist Middleware
 */
const corsWhitelist = (process.env.CORS_WHITELIST || 'http://localhost:3000,http://localhost:5000').split(',');
const corsMiddleware = (req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || corsWhitelist.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-CSRF-Token');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  } else {
    res.status(403).json({ error: 'CORS policy violation: origin not allowed.' });
  }
};

/**
 * CSRF Double-Submit Cookie Verification Middleware
 */
const csrfMiddleware = (req, res, next) => {
  // Skip CSRF validation for safe GET, HEAD, OPTIONS methods
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  // Bypass CSRF in tests unless custom header x-test-csrf is sent
  if (process.env.NODE_ENV === 'test' && !req.headers['x-test-csrf']) {
    return next();
  }

  // Bypass CSRF for requests using Bearer authorization header, unless testing CSRF
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ') && !req.headers['x-test-csrf']) {
    return next();
  }

  // Bypass CSRF for public authentication endpoints & external webhooks
  const path = req.path.toLowerCase();
  if (
    path.startsWith('/api/auth/login') ||
    path.startsWith('/api/auth/register') ||
    path.startsWith('/api/auth/sso') ||
    path.startsWith('/api/meetings/webhook') ||
    path.startsWith('/api/simulator')
  ) {
    return next();
  }

  const csrfTokenHeader = req.headers['x-csrf-token'] || req.headers['x-xsrf-token'];
  const csrfTokenCookie = req.cookies?.['XSRF-TOKEN'] || req.cookies?.['xsrf-token'];

  if (!csrfTokenHeader || !csrfTokenCookie || csrfTokenHeader !== csrfTokenCookie) {
    return res.status(403).json({ error: 'CSRF token mismatch or missing.' });
  }

  next();
};

/**
 * Sliding Window Auth Rate Limiter (Max 10 requests / 1 minute per IP)
 */
const authRateLimiter = (req, res, next) => {
  // Bypass rate limiting in tests unless custom header x-test-rate-limit is sent
  if (process.env.NODE_ENV === 'test' && !req.headers['x-test-rate-limit']) {
    return next();
  }

  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, []);
  }

  const timestamps = rateLimitMap.get(ip);
  const recentTimestamps = timestamps.filter(t => now - t < 60000);

  if (recentTimestamps.length >= 10) {
    return res.status(429).json({ error: 'Too many requests. Rate limit of 10 requests per minute exceeded.' });
  }

  recentTimestamps.push(now);
  rateLimitMap.set(ip, recentTimestamps);
  next();
};

/**
 * Role-Based Access Control (RBAC) Middleware.
 * Enforces role clearance and scopes rep access to their assigned leads only.
 */
function rbacMiddleware(allowedRoles = []) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthenticated. Session token missing.' });
    }

    const { role, userId } = req.user;

    // Check basic role clearance
    if (allowedRoles.length > 0 && !allowedRoles.includes(role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient privileges for this operation.' });
    }

    // Admins bypass lead assignment checks
    if (role === 'admin') {
      return next();
    }

    // Reps are restricted to assigned leads/resources
    if (role === 'rep') {
      const allParams = { ...req.params, ...req.query, ...req.body };
      
      let leadId = allParams.leadId || allParams.lead_id;

      // Extract from path ID if route is related to leads
      if (allParams.id) {
        const fullPath = (req.baseUrl + req.path).toLowerCase();
        if (fullPath.includes('/leads')) {
          leadId = allParams.id;
        }
      }

      // If a lead is being accessed, verify it is assigned to this rep
      if (leadId) {
        try {
          const result = await pool.query('SELECT assigned_to FROM leads WHERE id = $1', [leadId]);
          if (result.rows && result.rows.length > 0) {
            const lead = result.rows[0];
            if (lead.assigned_to && lead.assigned_to !== userId) {
              return res.status(403).json({ error: 'Forbidden: Rep does not own this lead.' });
            }
          }
        } catch (err) {
          console.error(`[RBAC Validation Error] Failed to verify ownership of lead ${leadId}:`, err.message);
          return res.status(500).json({ error: 'RBAC verification failure.' });
        }
      }

      // If a message is being accessed, verify it belongs to a lead assigned to this rep
      if (allParams.messageId || (allParams.id && (req.baseUrl + req.path).includes('/messages'))) {
        const messageId = allParams.messageId || allParams.id;
        try {
          const result = await pool.query(
            'SELECT l.assigned_to FROM messages m JOIN leads l ON m.lead_id = l.id WHERE m.id = $1',
            [messageId]
          );
          if (result.rows && result.rows.length > 0) {
            const message = result.rows[0];
            if (message.assigned_to && message.assigned_to !== userId) {
              return res.status(403).json({ error: 'Forbidden: Rep does not own the lead associated with this message.' });
            }
          }
        } catch (err) {
          console.error(`[RBAC Validation Error] Failed to verify ownership of message ${messageId}:`, err.message);
          return res.status(500).json({ error: 'RBAC verification failure.' });
        }
      }

      // If a meeting is being accessed, verify it belongs to a lead assigned to this rep
      if (allParams.meetingId || (allParams.id && (req.baseUrl + req.path).includes('/meetings'))) {
        const meetingId = allParams.meetingId || allParams.id;
        try {
          const result = await pool.query(
            'SELECT l.assigned_to FROM meetings m JOIN leads l ON m.lead_id = l.id WHERE m.id = $1',
            [meetingId]
          );
          if (result.rows && result.rows.length > 0) {
            const meeting = result.rows[0];
            if (meeting.assigned_to && meeting.assigned_to !== userId) {
              return res.status(403).json({ error: 'Forbidden: Rep does not own the lead associated with this meeting.' });
            }
          }
        } catch (err) {
          console.error(`[RBAC Validation Error] Failed to verify ownership of meeting ${meetingId}:`, err.message);
          return res.status(500).json({ error: 'RBAC verification failure.' });
        }
      }
    }

    next();
  };
}

module.exports = {
  corsMiddleware,
  csrfMiddleware,
  authRateLimiter,
  rbacMiddleware
};
