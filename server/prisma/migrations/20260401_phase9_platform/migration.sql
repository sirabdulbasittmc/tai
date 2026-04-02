-- Phase 9: Platform & Marketplace

-- API key management
CREATE TABLE IF NOT EXISTS api_keys (
  id              SERIAL PRIMARY KEY,
  client_number   VARCHAR(20) NOT NULL,
  user_id         INTEGER NOT NULL,
  label           VARCHAR(100) NOT NULL,
  key_hash        VARCHAR(64) NOT NULL UNIQUE,   -- SHA-256 of raw key
  key_prefix      VARCHAR(20) NOT NULL,           -- tmcai_XXXXXX shown in UI
  rate_limit_rpm  INTEGER NOT NULL DEFAULT 100,
  scopes          JSONB NOT NULL DEFAULT '["query"]',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(client_number, is_active);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- API key usage log (for billing/analytics)
CREATE TABLE IF NOT EXISTS api_key_usage (
  id              SERIAL PRIMARY KEY,
  key_id          INTEGER NOT NULL,
  client_number   VARCHAR(20) NOT NULL,
  endpoint        VARCHAR(200),
  status_code     INTEGER,
  latency_ms      INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_key ON api_key_usage(key_id, created_at);

-- Marketplace: connector packages
CREATE TABLE IF NOT EXISTS marketplace_connectors (
  id              SERIAL PRIMARY KEY,
  slug            VARCHAR(100) NOT NULL UNIQUE,
  name            VARCHAR(100) NOT NULL,
  description     TEXT NOT NULL,
  author          VARCHAR(100) NOT NULL,
  version         VARCHAR(20) NOT NULL,
  npm_package     VARCHAR(200),
  icon_url        VARCHAR(500),
  category        VARCHAR(50) NOT NULL DEFAULT 'connector',
  revenue_share   NUMERIC(4,2) NOT NULL DEFAULT 0.30,  -- 30% to platform
  price_usd       NUMERIC(8,2) NOT NULL DEFAULT 0.00,
  is_published    BOOLEAN NOT NULL DEFAULT FALSE,
  downloads       INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Marketplace: tenant installations
CREATE TABLE IF NOT EXISTS marketplace_installations (
  id              SERIAL PRIMARY KEY,
  client_number   VARCHAR(20) NOT NULL,
  connector_id    INTEGER NOT NULL REFERENCES marketplace_connectors(id),
  installed_by    INTEGER NOT NULL,
  installed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  config          JSONB NOT NULL DEFAULT '{}',
  UNIQUE(client_number, connector_id)
);

-- Agent templates (pre-built)
CREATE TABLE IF NOT EXISTS agent_templates (
  id              SERIAL PRIMARY KEY,
  slug            VARCHAR(100) NOT NULL UNIQUE,
  name            VARCHAR(100) NOT NULL,
  description     TEXT NOT NULL,
  instructions    TEXT NOT NULL,
  data_sources    TEXT[] NOT NULL DEFAULT '{}',
  actions         TEXT[] NOT NULL DEFAULT '{}',
  category        VARCHAR(50) NOT NULL DEFAULT 'general',
  is_published    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed pre-built agent templates
INSERT INTO agent_templates (slug, name, description, instructions, data_sources, actions, category) VALUES
  ('project-risk-monitor', 'Project Risk Monitor',
   'Monitors active projects for schedule, budget, and scope risks. Alerts you when thresholds are breached.',
   'Scan all active projects daily. Flag any project where: completion % is >10% behind schedule, costs exceed budget by >5%, or no updates in 7+ days. Summarize risks and recommended actions.',
   ARRAY['org'], ARRAY['notify_email'], 'projects'),

  ('morning-brief', 'Morning Brief',
   'Delivers a personalized daily briefing at 8 AM: pending tasks, calendar highlights, key metrics.',
   'Every morning at 8 AM: summarize my pending action items, today''s meetings, and any anomalies in our key business metrics from yesterday.',
   ARRAY['org', 'personal'], ARRAY['notify_email', 'notify_whatsapp'], 'productivity'),

  ('opportunity-scout', 'Opportunity Scout',
   'Tracks tender portals, partner updates, and news for business opportunities matching your criteria.',
   'Weekly: scan organization data for new project opportunities, expiring contracts that could be renewed, and any leads that have not been followed up in 14+ days.',
   ARRAY['org'], ARRAY['notify_email'], 'sales'),

  ('invoice-reminder', 'Invoice Reminder',
   'Monitors overdue invoices and sends reminders at configurable intervals.',
   'Daily: check for invoices overdue by 7, 14, and 30+ days. Draft a professional reminder email for each. Do not send without approval.',
   ARRAY['org'], ARRAY['send_email'], 'finance'),

  ('competitive-intelligence', 'Competitive Intelligence',
   'Weekly digest of competitor activity and market developments relevant to your industry.',
   'Weekly: compile a summary of any competitor mentions, industry news, or regulatory changes found in our knowledge base or uploaded documents. Highlight strategic implications.',
   ARRAY['org', 'uploads'], ARRAY['notify_email'], 'strategy')

ON CONFLICT (slug) DO NOTHING;
