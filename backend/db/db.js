const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');

const tenantStorage = new AsyncLocalStorage();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/ai_sales_agent',
});

if (process.env.NODE_ENV !== 'test') {
  // Programmatic schema self-healing: add similarity column if not exists
  pool.query('ALTER TABLE leads ADD COLUMN IF NOT EXISTS similarity NUMERIC DEFAULT 0.0')
    .then(() => console.log('🛡️ Database self-healing: Leads similarity column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) NOT NULL DEFAULT 'trialing'")
    .then(() => console.log('🛡️ Database self-healing: Tenants subscription_status column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255) UNIQUE")
    .then(() => console.log('🛡️ Database self-healing: Tenants stripe_customer_id column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255)")
    .then(() => console.log('🛡️ Database self-healing: Tenants stripe_subscription_id column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_start TIMESTAMP WITH TIME ZONE")
    .then(() => console.log('🛡️ Database self-healing: Tenants trial_start column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_end TIMESTAMP WITH TIME ZONE")
    .then(() => console.log('🛡️ Database self-healing: Tenants trial_end column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMP WITH TIME ZONE")
    .then(() => console.log('🛡️ Database self-healing: Tenants current_period_start column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMP WITH TIME ZONE")
    .then(() => console.log('🛡️ Database self-healing: Tenants current_period_end column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS emails_sent_count INTEGER NOT NULL DEFAULT 0")
    .then(() => console.log('🛡️ Database self-healing: Tenants emails_sent_count column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS leads_imported_count INTEGER NOT NULL DEFAULT 0")
    .then(() => console.log('🛡️ Database self-healing: Tenants leads_imported_count column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS failed_payment_attempts INTEGER NOT NULL DEFAULT 0")
    .then(() => console.log('🛡️ Database self-healing: Tenants failed_payment_attempts column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));


  pool.query('ALTER TABLE leads ADD COLUMN IF NOT EXISTS sequence_paused BOOLEAN DEFAULT FALSE')
    .then(() => console.log('🛡️ Database self-healing: Leads sequence_paused column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS subject VARCHAR(255)')
    .then(() => console.log('🛡️ Database self-healing: Messages subject column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb")
    .then(() => console.log('🛡️ Database self-healing: Messages metadata column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS intent VARCHAR(50)')
    .then(() => console.log('🛡️ Database self-healing: Messages intent column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS needs_human_review BOOLEAN DEFAULT FALSE')
    .then(() => console.log('🛡️ Database self-healing: Messages needs_human_review column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_link VARCHAR(511)')
    .then(() => console.log('🛡️ Database self-healing: Users calendar_link column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS integration_settings JSONB DEFAULT '{}'::jsonb")
    .then(() => console.log('🛡️ Database self-healing: Users integration_settings column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query('ALTER TABLE meetings ADD COLUMN IF NOT EXISTS timezone VARCHAR(100)')
    .then(() => console.log('🛡️ Database self-healing: Meetings timezone column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query("ALTER TABLE meetings ADD COLUMN IF NOT EXISTS meeting_metadata JSONB DEFAULT '{}'::jsonb")
    .then(() => console.log('🛡️ Database self-healing: Meetings meeting_metadata column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret VARCHAR(127)')
    .then(() => console.log('🛡️ Database self-healing: Users two_factor_secret column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE')
    .then(() => console.log('🛡️ Database self-healing: Users two_factor_enabled column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query('ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id) ON DELETE SET NULL')
    .then(() => console.log('🛡️ Database self-healing: Leads assigned_to column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        token VARCHAR(511) NOT NULL UNIQUE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        revoked BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation_policy ON refresh_tokens;
    CREATE POLICY tenant_isolation_policy ON refresh_tokens
        FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  `)
    .then(() => console.log('🛡️ Database self-healing: refresh_tokens table and RLS verified.'))
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

  pool.query('ALTER TABLE leads ADD COLUMN IF NOT EXISTS consent_given BOOLEAN DEFAULT FALSE')
    .then(() => console.log('🛡️ Database self-healing: Leads consent_given column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query('ALTER TABLE leads ADD COLUMN IF NOT EXISTS consent_source VARCHAR(255)')
    .then(() => console.log('🛡️ Database self-healing: Leads consent_source column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS data_residency VARCHAR(10) DEFAULT 'US'")
    .then(() => console.log('🛡️ Database self-healing: Tenants data_residency column verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));

  pool.query(`
    CREATE TABLE IF NOT EXISTS suppression_list (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        reason VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, email)
    );
    ALTER TABLE suppression_list ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation_policy ON suppression_list;
    CREATE POLICY tenant_isolation_policy ON suppression_list
        FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  `)
    .then(() => console.log('🛡️ Database self-healing: suppression_list table and RLS verified.'))
    .catch(err => console.error('⚠️ Database self-healing error:', err.message));
}


/**
 * Helper to extract the primary table name or alias from a query beforePart.
 */
function getTablePrefix(sql) {
  const sqlTrimmed = sql.trim();
  let match = /\bFROM\s+([a-zA-Z0-9_.]+)(?:\s+(?:AS\s+)?([a-zA-Z0-9_]+))?/i.exec(sqlTrimmed);
  if (!match) {
    match = /\bUPDATE\s+([a-zA-Z0-9_.]+)(?:\s+(?:AS\s+)?([a-zA-Z0-9_]+))?/i.exec(sqlTrimmed);
  }
  if (!match) {
    match = /\bDELETE\s+FROM\s+([a-zA-Z0-9_.]+)(?:\s+(?:AS\s+)?([a-zA-Z0-9_]+))?/i.exec(sqlTrimmed);
  }

  if (match) {
    const tableName = match[1];
    let alias = match[2];

    const reservedKeywords = [
      'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'NATURAL', 'ON', 'USING',
      'WHERE', 'ORDER', 'GROUP', 'LIMIT', 'OFFSET', 'UNION', 'HAVING', 'AS', 'SET'
    ];
    if (alias && reservedKeywords.includes(alias.toUpperCase())) {
      alias = null;
    }

    return alias ? alias : tableName;
  }
  return null;
}

/**
 * Automatically appends 'tenant_id = $N' to SELECT, UPDATE, and DELETE SQL queries.
 * Accounts for existing WHERE clauses and boundary clauses (ORDER BY, LIMIT, etc.).
 */
function appendTenantCondition(sql, paramIndex) {
  const sqlTrimmed = sql.trim();
  const sqlUpper = sqlTrimmed.toUpperCase();

  // Enforce filter only on SELECT, UPDATE, and DELETE queries
  if (!sqlUpper.startsWith('SELECT') && !sqlUpper.startsWith('UPDATE') && !sqlUpper.startsWith('DELETE')) {
    return sql;
  }

  // Skip complex queries with JOINs or multiple table queries to prevent ambiguous column reference errors
  if (/\bJOIN\b/i.test(sql) || sql.includes(',')) {
    return sql;
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

  // Use table prefix if query contains JOIN to avoid ambiguous column error
  let columnRef = 'tenant_id';
  if (sqlUpper.includes('JOIN')) {
    const prefix = getTablePrefix(beforePart);
    if (prefix) {
      columnRef = `${prefix}.tenant_id`;
    }
  }

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
    return `${beforePart} AND ${columnRef} = $${paramIndex}${suffix}`;
  } else {
    return `${beforePart} WHERE ${columnRef} = $${paramIndex}${suffix}`;
  }
}

// Intercept pool.connect to set session level RLS parameter for Row-Level Security
const originalConnect = pool.connect.bind(pool);
pool.connect = function (...args) {
  const callback = typeof args[0] === 'function' ? args[0] : null;
  const store = tenantStorage.getStore();
  const activeTenantId = store ? store.tenantId : null;

  if (callback) {
    return originalConnect((err, client, release) => {
      if (err) return callback(err);

      // Intercept release to reset the tenant context session variable
      const originalRelease = client.release.bind(client);
      client.release = function (destroy) {
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

      if (activeTenantId) {
        client.query(`SET app.current_tenant_id = ${client.escapeLiteral(activeTenantId)}`)
          .then(() => {
            callback(null, client, client.release);
          })
          .catch((queryErr) => {
            try {
              client.release();
            } catch (e) {}
            callback(queryErr);
          });
      } else {
        callback(null, client, client.release);
      }
    });
  }

  return originalConnect().then(async (client) => {
    if (activeTenantId) {
      try {
        await client.query(`SET app.current_tenant_id = ${client.escapeLiteral(activeTenantId)}`);
      } catch (err) {
        try {
          client.release();
        } catch (e) {}
        throw err;
      }
    }

    const originalRelease = client.release.bind(client);
    client.release = function (destroy) {
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
  });
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
    if (modifiedSql !== sql.trim()) {
      querySql = modifiedSql;
      queryParams.push(activeTenantId);
    }
  }

  const client = await pool.connect();
  try {
    if (activeTenantId) {
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
