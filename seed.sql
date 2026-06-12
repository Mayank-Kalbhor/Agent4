-- Seed Script: Multi-Tenant AI Sales Agent SaaS Mock Data
-- Target Database: PostgreSQL
-- Installs seed data for two separate tenants to verify RLS and isolation boundaries.

-- Clean existing data (Optional, safely disabled for fresh migrations)
-- TRUNCATE tenants, users, leads, campaigns, messages, meetings, audit_logs CASCADE;

-- Temporarily bypass RLS during seeding (since RLS applies to application connections)
-- Typically, the superuser or table owner automatically bypasses RLS in PG, 
-- but setting the session context makes it explicitly safe.

-- ==========================================
-- 1. SEED TENANTS
-- ==========================================

INSERT INTO tenants (id, name, plan, settings) VALUES
('a0000000-0000-0000-0000-000000000001', 'Acme Enterprise', 'premium', '{
  "timezone": "America/New_York",
  "ai_email_generation_prompt": "You are a polite sales executive. Draft short, personalized, value-driven outreach.",
  "crm_sync_enabled": true,
  "crm_provider": "hubspot"
}'::jsonb),
('b0000000-0000-0000-0000-000000000002', 'Beta Innovators', 'free', '{
  "timezone": "Europe/London",
  "ai_email_generation_prompt": "You are a casual technical founder. Emphasize developer efficiency and cost savings.",
  "crm_sync_enabled": false
}'::jsonb);

-- ==========================================
-- 2. SEED USERS (Hashed password: 'password123')
-- ==========================================

INSERT INTO users (id, tenant_id, email, role, hashed_password, sso_provider) VALUES
-- Tenant 1: Acme Enterprise
('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'admin@acme.com', 'admin', '$2a$10$sEiRQBi2y4Vyd0BE1wm2IOwOod29gSMza2nFYKx86zsGr9melkPiS', NULL),
('a1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'sarah.rep@acme.com', 'rep', '$2a$10$sEiRQBi2y4Vyd0BE1wm2IOwOod29gSMza2nFYKx86zsGr9melkPiS', 'google'),

-- Tenant 2: Beta Innovators
('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'admin@betainnovators.com', 'admin', '$2a$10$sEiRQBi2y4Vyd0BE1wm2IOwOod29gSMza2nFYKx86zsGr9melkPiS', NULL);

-- ==========================================
-- 3. SEED LEADS
-- ==========================================

INSERT INTO leads (id, tenant_id, name, email, phone, company, title, notes, score, status, enrichment_data) VALUES
-- Tenant 1: Acme Enterprise Leads
('a2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'John Doe', 'john.doe@stripe.com', '+1-555-0199', 'Stripe', 'VP of Engineering', 'Met at TechCrunch Disrupt. Highly interested in AI automation pipelines.', 'high', 'meeting_scheduled', '{
  "linkedin_url": "https://linkedin.com/in/johndoe-stripe",
  "employee_count": 8000,
  "technologies_used": ["React", "Node.js", "PostgreSQL", "AWS"],
  "annual_revenue_est": "$1B+"
}'::jsonb),

('a2000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Alice Smith', 'alice.smith@netflix.com', '+1-555-0188', 'Netflix', 'Director of DevOps', 'Expressed minor interest during a webinar. Needs warming up.', 'medium', 'contacted', '{
  "linkedin_url": "https://linkedin.com/in/alicesmith-netflix",
  "employee_count": 12000,
  "technologies_used": ["React", "Python", "Cassandra", "AWS"],
  "annual_revenue_est": "$10B+"
}'::jsonb),

('a2000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Bob Johnson', 'bob@localshop.com', '+1-555-0177', 'LocalShop LLC', 'Owner', 'Small retail shop. Low budget, probably not a good fit.', 'low', 'new', '{
  "linkedin_url": "",
  "employee_count": 5,
  "technologies_used": ["Shopify"],
  "annual_revenue_est": "$200K"
}'::jsonb),

('a2000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Emily Davis', 'emily@fastgrowth.io', '+1-555-0166', 'FastGrowth', 'Head of Sales', 'Lead captured via contact form. Automated scoring rated high due to funding status.', 'high', 'replied', '{
  "linkedin_url": "https://linkedin.com/in/emily-davis-fastgrowth",
  "employee_count": 45,
  "technologies_used": ["HubSpot", "Zapier"],
  "annual_revenue_est": "$5M",
  "recent_funding": "Series A ($8M)"
}'::jsonb),

-- Tenant 2: Beta Innovators Leads
('b2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'Charlie Brown', 'charlie@innovatelabs.co', '+44-20-7946-0192', 'Innovate Labs', 'CTO', 'Inbound inquiry regarding custom model integration options.', 'high', 'new', '{
  "linkedin_url": "https://linkedin.com/in/charlie-cto",
  "employee_count": 25,
  "technologies_used": ["Next.js", "FastAPI", "MongoDB"],
  "annual_revenue_est": "$2M"
}'::jsonb);

-- ==========================================
-- 4. SEED CAMPAIGNS
-- ==========================================

INSERT INTO campaigns (id, tenant_id, name, channel, cadence, created_by) VALUES
-- Tenant 1: Acme Enterprise Campaigns
('a3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Q2 Enterprise Email Outreach', 'email', '{
  "steps": [
    {"day": 1, "template_id": "email_v1_intro", "subject": "Simplifying your engineering workflow"},
    {"day": 3, "template_id": "email_v1_followup", "subject": "Quick question regarding Stripe"},
    {"day": 7, "template_id": "email_v1_case_study", "subject": "How we helped FastGrowth scale 3x"}
  ]
}'::jsonb, 'a1000000-0000-0000-0000-000000000001'),

('a3000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'High-Priority SMS Warmup', 'sms', '{
  "steps": [
    {"day": 1, "body": "Hi {{name}}, great connecting at TechCrunch. Are you open for a quick 10-min chat next Tuesday?"}
  ]
}'::jsonb, 'a1000000-0000-0000-0000-000000000002'),

-- Tenant 2: Beta Innovators Campaigns
('b3000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'UK Tech Founder Outreach', 'email', '{
  "steps": [
    {"day": 1, "template_id": "uk_founder_intro", "subject": "Scale Dev Ops on a Budget"}
  ]
}'::jsonb, 'b1000000-0000-0000-0000-000000000001');

-- ==========================================
-- 5. SEED MESSAGES
-- ==========================================

INSERT INTO messages (id, tenant_id, lead_id, campaign_id, channel, direction, content, sent_at, opened_at, replied_at, status) VALUES
-- Tenant 1: Acme Enterprise Messages
('a4000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'email', 'outbound', 
'Hi John, noticed Stripe recently expanded its engineering teams. I would love to share how our AI Sales Agent SaaS can streamline your pipeline. Let me know if you have 10 minutes next week.', 
NOW() - INTERVAL '3 days', NOW() - INTERVAL '2 days' - INTERVAL '23 hours', NOW() - INTERVAL '2 days', 'replied'),

('a4000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'email', 'inbound', 
'Thanks for reaching out. Yes, we are actively looking into AI workflows. I can do Wednesday afternoon.', 
NOW() - INTERVAL '2 days', NULL, NULL, 'delivered'),

('a4000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000001', 'email', 'outbound', 
'Hi Alice, enjoyed your insights during the Kubernetes panel. Our tool helps DevOps teams manage integrations with single-click dashboards. Open to an intro?', 
NOW() - INTERVAL '1 day', NOW() - INTERVAL '8 hours', NULL, 'opened'),

-- Tenant 2: Beta Innovators Messages
('b4000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001', 'email', 'outbound', 
'Hi Charlie, running CTO tasks leaves little time for sales pipelines. Our model handles cold outreach entirely in the background. Are you free to take a look?', 
NOW() - INTERVAL '4 hours', NULL, NULL, 'sent');

-- ==========================================
-- 6. SEED MEETINGS
-- ==========================================

INSERT INTO meetings (id, tenant_id, lead_id, scheduled_at, calendar_event_id, booking_link, status) VALUES
-- Tenant 1: Acme Enterprise Meetings
('a5000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 
NOW() + INTERVAL '3 days', 'evt_stripe_acme_101', 'https://calendly.com/acme-sales/john-stripe', 'scheduled');

-- ==========================================
-- 7. SEED AUDIT LOGS
-- ==========================================

INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, metadata, created_at) VALUES
-- Tenant 1: Acme Enterprise Audit Logs
('a6000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'CREATE_LEAD', 'leads', 'a2000000-0000-0000-0000-000000000001', '{
  "method": "CSV_IMPORT",
  "imported_filename": "techcrunch_leads.csv"
}'::jsonb, NOW() - INTERVAL '3 days'),

('a6000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'CREATE_CAMPAIGN', 'campaigns', 'a3000000-0000-0000-0000-000000000002', '{
  "ui_module": "campaign_builder"
}'::jsonb, NOW() - INTERVAL '1 day'),

-- Tenant 2: Beta Innovators Audit Logs
('b6000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'CREATE_LEAD', 'leads', 'b2000000-0000-0000-0000-000000000001', '{
  "method": "API_WEBFORM"
}'::jsonb, NOW() - INTERVAL '4 hours');
