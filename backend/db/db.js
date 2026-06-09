const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');

const tenantStorage = new AsyncLocalStorage();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/sales_agent',
});

// Programmatic schema self-healing: add similarity column if not exists
pool.query('ALTER TABLE leads ADD COLUMN IF NOT EXISTS similarity NUMERIC DEFAULT 0.0')
  .then(() => console.log('🛡️ Database self-healing: Leads similarity column verified.'))
  .catch(err => console.error('⚠️ Database self-healing error:', err.message));

pool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS subject VARCHAR(255)')
  .then(() => console.log('🛡️ Database self-healing: Messages subject column verified.'))
  .catch(err => console.error('⚠️ Database self-healing error:', err.message));

pool.query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb")
  .then(() => console.log('🛡️ Database self-healing: Messages metadata column verified.'))
  .catch(err => console.error('⚠️ Database self-healing error:', err.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS knowledge_base (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      source VARCHAR(255) NOT NULL,
      type VARCHAR(50) NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );
  ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation_policy ON knowledge_base;
  CREATE POLICY tenant_isolation_policy ON knowledge_base
      FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
`)
  .then(() => console.log('🛡️ Database self-healing: knowledge_base table and RLS verified.'))
  .catch(err => console.error('⚠️ Database self-healing error:', err.message));

/**
 * Automatically appends 'tenant_id = $N' to SELECT, UPDATE, and DELETE SQL queries.
 * Accounts for existing WHERE clauses and boundary clauses (ORDER BY, LIMIT, etc.).
 */
function appendTenantCondition(sql, paramIndex) {
  const sqlTrimmed = sql.trim();
  const sqlUpper = sqlTrimmed.toUpperCase();

  // Enforce filter only on SELECT, UPDATE, and DELETE queries
  if (!sqlUpper.startsWith('SELECT') && !sqlUpper.startsWith('UPDATE') && !sqlUpper.startsWith('DELETE')) {
    return sqlTrimmed;
  }

  // Keywords that mark the end of the main table/where clause in PostgreSQL
  const boundaryKeywords = [
    /\bGROUP\s+BY\b/i,
    /\bORDER\s+BY\b/i,
    /\bLIMIT\b/i,
    /\bOFFSET\b/i,
    /\bUNION\b/i,
    /\bHAVING\b/i,
    /\bFOR\s+UPDATE\b/i,
    /\bFOR\s+SHARE\b/i
  ];

  let splitIndex = sqlTrimmed.length;
  for (const regex of boundaryKeywords) {
    const match = regex.exec(sqlTrimmed);
    if (match && match.index < splitIndex) {
      splitIndex = match.index;
    }
  }

  const beforePart = sqlTrimmed.substring(0, splitIndex).trim();
  const afterPart = sqlTrimmed.substring(splitIndex).trim();
  const suffix = afterPart ? ` ${afterPart}` : '';

  // Check if there is an outer WHERE clause (ignoring nested parenthesis like subqueries)
  let hasOuterWhere = false;
  let parenCount = 0;
  for (let i = 0; i < beforePart.length; i++) {
    if (beforePart[i] === '(') {
      parenCount++;
    } else if (beforePart[i] === ')') {
      parenCount--;
    } else if (parenCount === 0 && beforePart.substring(i, i + 6).toUpperCase() === 'WHERE ') {
      hasOuterWhere = true;
      break;
    }
  }

  if (hasOuterWhere) {
    return `${beforePart} AND tenant_id = $${paramIndex}${suffix}`;
  } else {
    return `${beforePart} WHERE tenant_id = $${paramIndex}${suffix}`;
  }
}

// Intercept pool.connect to set session level RLS parameter for Row-Level Security
const originalConnect = pool.connect.bind(pool);
pool.connect = async function (...args) {
  const client = await originalConnect(...args);
  const store = tenantStorage.getStore();
  const activeTenantId = store ? store.tenantId : null;

  if (activeTenantId) {
    try {
      // Set the session setting for current client checkout
      await client.query(`SET app.current_tenant_id = ${client.escapeLiteral(activeTenantId)}`);
    } catch (err) {
      try {
        client.release();
      } catch (e) {}
      throw err;
    }
  }

  // Intercept release to reset the tenant context session variable
  const originalRelease = client.release.bind(client);
  client.release = function (destroy) {
    // Attempt to reset session variable before returning to the pool to prevent leakage
    try {
      const q = client.query('RESET app.current_tenant_id');
      if (q && typeof q.catch === 'function') {
        q.catch(() => {});
      }
    } catch (e) {}
    try {
      return originalRelease(destroy);
    } catch (e) {}
  };

  return client;
};

// Reusable db.query helper
async function query(sql, params = [], tenantId = null) {
  const store = tenantStorage.getStore();
  // If tenantId is explicitly false, bypass isolation. Otherwise, retrieve from parameter or context.
  const activeTenantId = tenantId === false ? null : (tenantId || (store ? store.tenantId : null));

  let querySql = sql;
  let queryParams = [...params];

  if (activeTenantId) {
    const paramIndex = queryParams.length + 1;
    const modifiedSql = appendTenantCondition(sql, paramIndex);
    if (modifiedSql !== sql) {
      querySql = modifiedSql;
      queryParams.push(activeTenantId);
    }
  }

  const client = await pool.connect();
  try {
    if (activeTenantId) {
      // Ensure RLS session variable is set inside this client's active transaction/connection
      await client.query(`SET app.current_tenant_id = ${client.escapeLiteral(activeTenantId)}`);
    }
    const result = await client.query(querySql, queryParams);
    return result || { rows: [] };
  } finally {
    try {
      client.release();
    } catch (e) {}
  }
}

module.exports = {
  pool,
  tenantStorage,
  query,
  appendTenantCondition,
};
