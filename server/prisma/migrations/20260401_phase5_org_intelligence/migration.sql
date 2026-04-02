-- Phase 5: Organizational Intelligence
-- Event-driven indexing queue, proactive alerts, knowledge base

CREATE TABLE IF NOT EXISTS index_events (
  id             SERIAL PRIMARY KEY,
  client_number  VARCHAR(20) NOT NULL,
  event_type     VARCHAR(50) NOT NULL,
  source         VARCHAR(50),
  source_id      VARCHAR(255),
  status         VARCHAR(20) NOT NULL DEFAULT 'pending',
  priority       INTEGER NOT NULL DEFAULT 5,
  payload        JSONB NOT NULL DEFAULT '{}',
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_index_events_tenant_status ON index_events(client_number, status);
CREATE INDEX IF NOT EXISTS idx_index_events_queue ON index_events(status, priority, created_at);

CREATE TABLE IF NOT EXISTS proactive_alerts (
  id             SERIAL PRIMARY KEY,
  client_number  VARCHAR(20) NOT NULL,
  alert_type     VARCHAR(50) NOT NULL,
  title          VARCHAR(255) NOT NULL,
  content        TEXT NOT NULL,
  severity       VARCHAR(20) NOT NULL DEFAULT 'info',
  is_read        BOOLEAN NOT NULL DEFAULT FALSE,
  notified_at    TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proactive_alerts_tenant ON proactive_alerts(client_number, is_read);

CREATE TABLE IF NOT EXISTS knowledge_items (
  id             SERIAL PRIMARY KEY,
  client_number  VARCHAR(20) NOT NULL,
  category       VARCHAR(50) NOT NULL,
  title          VARCHAR(255) NOT NULL,
  content        TEXT NOT NULL,
  tags           TEXT[] NOT NULL DEFAULT '{}',
  source         VARCHAR(50),
  source_id      VARCHAR(255),
  embedding      JSONB NOT NULL DEFAULT '[]',
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_tenant ON knowledge_items(client_number);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_category ON knowledge_items(client_number, category);
