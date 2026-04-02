-- Phase 6: Domain Expert Knowledge Base

CREATE TABLE IF NOT EXISTS domain_knowledge (
  id          SERIAL PRIMARY KEY,
  region      VARCHAR(20) NOT NULL DEFAULT 'global',
  vertical    VARCHAR(30) NOT NULL DEFAULT 'general',
  category    VARCHAR(30) NOT NULL DEFAULT 'regulatory',
  title       VARCHAR(255) NOT NULL,
  content     TEXT NOT NULL,
  parent_id   INTEGER REFERENCES domain_knowledge(id) ON DELETE SET NULL,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  source      VARCHAR(100),
  source_ref  VARCHAR(255),
  embedding   JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domain_knowledge_region ON domain_knowledge(region, vertical);
CREATE INDEX IF NOT EXISTS idx_domain_knowledge_category ON domain_knowledge(category);
