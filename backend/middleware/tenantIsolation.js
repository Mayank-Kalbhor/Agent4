const jwt = require('jsonwebtoken');
const { tenantStorage, query, pool } = require('../db/db');

const JWT_SECRET = process.env.JWT_SECRET || 'sales_agent_super_secret_token';

// Mapping parameters to database tables for ownership lookup
const tableMap = {
  leadId: 'leads',
  campaignId: 'campaigns',
  meetingId: 'meetings',
  messageId: 'messages',
  userId: 'users',
};

/**
 * Validates that the resource being accessed belongs to the authenticated tenant.
 * Compares explicit parameters and queries resource tables for path parameters.
 */
async function checkResourceOwnership(req, authenticatedTenantId) {
  // 1. Validate explicit tenant_id / tenantId parameter in request
  const reqTenantId = req.body?.tenant_id || req.body?.tenantId ||
                      req.query?.tenant_id || req.query?.tenantId ||
                      req.params?.tenant_id || req.params?.tenantId;

  if (reqTenantId && reqTenantId !== authenticatedTenantId) {
    return false;
  }

  // 2. Validate path parameter and request payload resource IDs
  const allParams = { ...req.params, ...req.query, ...req.body };
  for (const [paramName, paramValue] of Object.entries(allParams)) {
    if (!paramValue) continue;

    let table = tableMap[paramName];

    // Infer table name if the parameter is a generic 'id' based on the API route path
    if (paramName === 'id') {
      const fullPath = (req.baseUrl + req.path).toLowerCase();
      if (fullPath.includes('/leads')) {
        table = 'leads';
      } else if (fullPath.includes('/campaigns')) {
        table = 'campaigns';
      } else if (fullPath.includes('/meetings')) {
        table = 'meetings';
      } else if (fullPath.includes('/messages')) {
        table = 'messages';
      } else if (fullPath.includes('/users')) {
        table = 'users';
      }
    }

    if (table) {
      try {
        // Query the database globally (bypassing RLS checkout since storage context is not yet active)
        const checkSql = `SELECT tenant_id FROM ${table} WHERE id = $1`;
        const result = await pool.query(checkSql, [paramValue]) ?? { rows: [] };

        if (result.rows && result.rows.length > 0) {
          const resourceTenantId = result.rows[0].tenant_id;
          if (resourceTenantId !== authenticatedTenantId) {
            return false;
          }
        }
      } catch (err) {
        // Log query errors (e.g. invalid UUID structure) and block request access to be secure
        console.error(`Error checking resource ownership for ${table} with id ${paramValue}:`, err);
        return false;
      }
    }
  }

  return true;
}

/**
 * Express middleware to authenticate the JWT, extract tenant_id,
 * verify tenant resource ownership, and run request inside AsyncLocalStorage context.
 */
const tenantIsolationMiddleware = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required. Please log in.' });
  }

  jwt.verify(token, JWT_SECRET, async (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired session token.' });
    }

    const tenantId = user.tenantId || user.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ error: 'Forbidden: Tenant ID is missing from session.' });
    }

    req.user = user;
    req.tenantId = tenantId;

    // Verify ownership of the resources being accessed
    try {
      const isAuthorized = await checkResourceOwnership(req, tenantId);
      if (!isAuthorized) {
        return res.status(403).json({ error: 'Forbidden: Access to another tenant\'s data is not allowed.' });
      }
    } catch (ownerErr) {
      console.error('Error during resource ownership validation:', ownerErr);
      return res.status(500).json({ error: 'Internal validation failure.' });
    }

    // Run subsequent request handlers in the current tenant's AsyncLocalStorage context
    tenantStorage.run({ tenantId }, () => {
      next();
    });
  });
};

module.exports = {
  tenantIsolationMiddleware,
  checkResourceOwnership,
};



