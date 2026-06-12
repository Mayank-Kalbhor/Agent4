-- Migration Script: GDPR Compliance Module
-- Target Database: PostgreSQL

-- 1. Add GDPR-related columns to existing tables
ALTER TABLE leads ADD COLUMN IF NOT EXISTS consent_given BOOLEAN DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS consent_source VARCHAR(255);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS data_residency VARCHAR(10) DEFAULT 'US';

-- 2. Create Suppression List Table
CREATE TABLE IF NOT EXISTS suppression_list (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    reason VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, email)
);

-- 3. Configure Row-Level Security for Suppression List
ALTER TABLE suppression_list ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON suppression_list;
CREATE POLICY tenant_isolation_policy ON suppression_list
    FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 4. Create Indexes
CREATE INDEX IF NOT EXISTS idx_suppression_list_tenant_email ON suppression_list (tenant_id, email);
