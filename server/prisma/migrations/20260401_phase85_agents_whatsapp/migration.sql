-- Phase 8.5: Personal Agent Framework + WhatsApp

CREATE TABLE IF NOT EXISTS agents (
  id                SERIAL PRIMARY KEY,
  client_number     VARCHAR(20) NOT NULL,
  user_id           INTEGER NOT NULL,
  name              VARCHAR(100) NOT NULL,
  instructions      TEXT NOT NULL,
  data_sources      TEXT[] NOT NULL DEFAULT '{}',
  schedule          VARCHAR(50),
  actions           TEXT[] NOT NULL DEFAULT '{}',
  notify_email      BOOLEAN NOT NULL DEFAULT TRUE,
  notify_whatsapp   BOOLEAN NOT NULL DEFAULT FALSE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at       TIMESTAMPTZ,
  last_result       TEXT,
  last_error        TEXT,
  next_run_at       TIMESTAMPTZ,
  memory_context    JSONB NOT NULL DEFAULT '{}',
  run_count         INTEGER NOT NULL DEFAULT 0,
  error_count       INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_user ON agents(user_id);
CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents(client_number, is_active);

-- WhatsApp tables
CREATE TABLE IF NOT EXISTS whatsapp_connections (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  phone_number  VARCHAR(30) NOT NULL,
  wa_id         VARCHAR(50),
  status        VARCHAR(20) NOT NULL DEFAULT 'active',
  provider      VARCHAR(20) NOT NULL DEFAULT 'meta',
  connected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  direction   VARCHAR(10) NOT NULL,
  content     TEXT NOT NULL,
  message_id  VARCHAR(100),
  status      VARCHAR(20) NOT NULL DEFAULT 'sent',
  agent_id    INTEGER,
  session_id  INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_messages_user ON whatsapp_messages(user_id);

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL,
  conversation_history  JSONB NOT NULL DEFAULT '[]',
  agent_id              INTEGER,
  last_message_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_sessions_user ON whatsapp_sessions(user_id);
