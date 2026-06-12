-- Migration Script: Multi-Tenant AI Sales Agent SaaS Database Schema
-- Target Database: PostgreSQL

-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 1. ENUMS DEFINITION
-- ==========================================

CREATE TYPE user_role_enum AS ENUM ('admin', 'rep');

CREATE TYPE lead_score_enum AS ENUM ('high', 'medium', 'low');

CREATE TYPE lead_status_enum AS ENUM ('new', 'contacted', 'replied', 'meeting_scheduled', 'closed', 'opted_out');

CREATE TYPE campaign_channel_enum AS ENUM ('email', 'sms', 'whatsapp');

CREATE TYPE message_direction_enum AS ENUM ('outbound', 'inbound');

-- ==========================================
-- 2. TABLES DEFINITION
-- ==========================================

-- Tenants Table
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    plan VARCHAR(50) NOT NULL DEFAULT 'free',
    subscription_status VARCHAR(50) NOT NULL DEFAULT 'trialing',
    stripe_customer_id VARCHAR(255) UNIQUE,
    stripe_subscription_id VARCHAR(255),
    trial_start TIMESTAMP WITH TIME ZONE,
    trial_end TIMESTAMP WITH TIME ZONE,
    current_period_start TIMESTAMP WITH TIME ZONE,
    current_period_end TIMESTAMP WITH TIME ZONE,
    emails_sent_count INTEGER NOT NULL DEFAULT 0,
    leads_imported_count INTEGER NOT NULL DEFAULT 0,
    failed_payment_attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Users Table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL UNIQUE,
    role user_role_enum NOT NULL DEFAULT 'rep',
    hashed_password VARCHAR(255) NOT NULL,
    sso_provider VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Leads Table
CREATE TABLE leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    company VARCHAR(255),
    title VARCHAR(100),
    notes TEXT,
    score lead_score_enum,
    status lead_status_enum NOT NULL DEFAULT 'new',
    sequence_paused BOOLEAN NOT NULL DEFAULT FALSE,
    enrichment_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Campaigns Table
CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    channel campaign_channel_enum NOT NULL,
    cadence JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Messages Table
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    channel campaign_channel_enum NOT NULL,
    direction message_direction_enum NOT NULL,
    content TEXT NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    opened_at TIMESTAMP WITH TIME ZONE,
    replied_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) NOT NULL DEFAULT 'sent',
    intent VARCHAR(50),
    needs_human_review BOOLEAN NOT NULL DEFAULT FALSE
);

-- Meetings Table
CREATE TABLE meetings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    calendar_event_id VARCHAR(255),
    booking_link VARCHAR(511),
    status VARCHAR(50) NOT NULL DEFAULT 'scheduled'
);

-- Audit Logs Table
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 3. INDEXES DEFINITION
-- ==========================================

-- (tenant_id, status) Indexes
CREATE INDEX idx_leads_tenant_status ON leads (tenant_id, status);
CREATE INDEX idx_messages_tenant_status ON messages (tenant_id, status);
CREATE INDEX idx_meetings_tenant_status ON meetings (tenant_id, status);

-- (tenant_id, lead_id) Indexes
CREATE INDEX idx_messages_tenant_lead ON messages (tenant_id, lead_id);
CREATE INDEX idx_meetings_tenant_lead ON meetings (tenant_id, lead_id);

-- (tenant_id, created_at) Indexes
CREATE INDEX idx_leads_tenant_created ON leads (tenant_id, created_at);
CREATE INDEX idx_campaigns_tenant_created ON campaigns (tenant_id, created_at);
CREATE INDEX idx_audit_logs_tenant_created ON audit_logs (tenant_id, created_at);

-- Generic helper indexes for tenant isolation optimization
CREATE INDEX idx_users_tenant ON users (tenant_id);
CREATE INDEX idx_messages_tenant ON messages (tenant_id);
CREATE INDEX idx_meetings_tenant ON meetings (tenant_id);

-- ==========================================
-- 4. ROW-LEVEL SECURITY (RLS) POLICIES
-- ==========================================

-- Enable Row-Level Security on all multi-tenant tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Tenants Policy (A tenant can only access its own record)
CREATE POLICY tenant_isolation_policy ON tenants
    FOR ALL
    USING (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Users Policy
CREATE POLICY tenant_isolation_policy ON users
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Leads Policy
CREATE POLICY tenant_isolation_policy ON leads
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Campaigns Policy
CREATE POLICY tenant_isolation_policy ON campaigns
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Messages Policy
CREATE POLICY tenant_isolation_policy ON messages
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Meetings Policy
CREATE POLICY tenant_isolation_policy ON meetings
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Audit Logs Policy
CREATE POLICY tenant_isolation_policy ON audit_logs
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- ==========================================
-- 5. TRIGGERS DEFINITION FOR mutable TABLES
-- ==========================================

-- Reusable Trigger Function for updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to leads table
CREATE TRIGGER trigger_update_leads_timestamp
    BEFORE UPDATE ON leads
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
