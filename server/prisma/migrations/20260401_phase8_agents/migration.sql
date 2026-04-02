-- Phase 8: Agentic capabilities — agent_actions table

CREATE TABLE IF NOT EXISTS agent_actions (
  id                 SERIAL PRIMARY KEY,
  client_number      VARCHAR(20) NOT NULL,
  user_id            INTEGER NOT NULL,
  action_type        VARCHAR(50) NOT NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'pending',
  input              JSONB NOT NULL DEFAULT '{}',
  output             JSONB,
  requires_approval  BOOLEAN NOT NULL DEFAULT TRUE,
  approved_by        INTEGER,
  approved_at        TIMESTAMPTZ,
  error              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_actions_tenant ON agent_actions(client_number, user_id);
CREATE INDEX IF NOT EXISTS idx_agent_actions_status ON agent_actions(status);
