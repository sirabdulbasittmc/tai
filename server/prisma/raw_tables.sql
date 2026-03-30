-- ============================================================
-- TMC AI — Raw SQL Tables (NOT managed by Prisma)
-- Run AFTER prisma migrate deploy
-- ============================================================

-- 1. User Profile Memory (AI memory per user)
CREATE TABLE IF NOT EXISTS user_profile_memory (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  client_number VARCHAR(50),
  ai_instructions TEXT DEFAULT '',
  user_personal TEXT DEFAULT '',
  active_concerns TEXT DEFAULT '',
  updated_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. User Learning (behavioral patterns)
CREATE TABLE IF NOT EXISTS user_learning (
  id SERIAL PRIMARY KEY,
  client_number VARCHAR(50),
  user_id INT NOT NULL,
  category VARCHAR(50),
  key VARCHAR(100),
  value VARCHAR(100),
  score NUMERIC(10, 2) DEFAULT 0,
  occurrences INT DEFAULT 1,
  last_seen_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, category, key)
);

-- 3. Feedback (thumbs up/down)
CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  client_number VARCHAR(50),
  user_id INT,
  rating VARCHAR(10),
  query VARCHAR(500),
  response_preview VARCHAR(500),
  conversation_id VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 4. General Artifacts (template library)
CREATE TABLE IF NOT EXISTS general_artifacts (
  id SERIAL PRIMARY KEY,
  artifact_key VARCHAR(100) UNIQUE NOT NULL,
  title VARCHAR(255),
  description TEXT,
  match_intents VARCHAR(500),
  html_template TEXT,
  data_schema TEXT,
  version INT DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 5. User Artifacts (personalized dashboards)
CREATE TABLE IF NOT EXISTS user_artifacts (
  id SERIAL PRIMARY KEY,
  client_number VARCHAR(50),
  user_id INT NOT NULL,
  artifact_key VARCHAR(100),
  source_general_id INT,
  title VARCHAR(255),
  html_content TEXT,
  data_json TEXT,
  data_hash VARCHAR(32),
  customizations TEXT,
  use_count INT DEFAULT 1,
  last_feedback TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, artifact_key),
  FOREIGN KEY(source_general_id) REFERENCES general_artifacts(id)
);

-- 6. System Logs (errors, warnings, AI suggestions)
CREATE TABLE IF NOT EXISTS system_logs (
  id SERIAL PRIMARY KEY,
  client_number VARCHAR(50),
  user_id INT,
  level VARCHAR(20),
  category VARCHAR(50),
  source VARCHAR(50),
  message VARCHAR(255),
  details TEXT,
  suggestion TEXT,
  status VARCHAR(20) DEFAULT 'open',
  recurrence_count INT DEFAULT 1,
  first_seen_at TIMESTAMP DEFAULT NOW(),
  last_seen_at TIMESTAMP DEFAULT NOW(),
  resolved_by INT,
  resolved_at TIMESTAMP,
  resolution_note VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 7. Token Usage (daily aggregates per user/provider)
CREATE TABLE IF NOT EXISTS token_usage (
  id SERIAL PRIMARY KEY,
  client_number VARCHAR(50),
  user_id INT,
  date DATE,
  provider VARCHAR(50),
  input_tokens INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  total_tokens INT DEFAULT 0,
  request_count INT DEFAULT 1,
  estimated_cost_usd NUMERIC(12, 6) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(client_number, user_id, date, provider)
);

-- 8. Token Query Log (individual query log)
CREATE TABLE IF NOT EXISTS token_query_log (
  id SERIAL PRIMARY KEY,
  client_number VARCHAR(50),
  user_id INT,
  provider VARCHAR(50),
  query VARCHAR(500),
  intent_type VARCHAR(50),
  input_tokens INT,
  output_tokens INT,
  total_tokens INT,
  estimated_cost_usd NUMERIC(12, 6),
  response_time_ms INT,
  reason VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 9. User Tiers (configurable user types)
CREATE TABLE IF NOT EXISTS user_tiers (
  id SERIAL PRIMARY KEY,
  client_number VARCHAR(50),
  tier_code VARCHAR(50),
  tier_name VARCHAR(100),
  description VARCHAR(500),
  price_per_seat NUMERIC(10, 2) DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'USD',
  response_style VARCHAR(50) DEFAULT 'moderate',
  max_response_words INT DEFAULT 500,
  allow_widgets BOOLEAN DEFAULT true,
  allow_charts BOOLEAN DEFAULT true,
  allow_tables BOOLEAN DEFAULT true,
  allow_export BOOLEAN DEFAULT false,
  export_formats VARCHAR(100) DEFAULT 'csv',
  max_output_tokens INT DEFAULT 2048,
  allowed_providers VARCHAR(200) DEFAULT 'gemini-flash',
  allow_email_read BOOLEAN DEFAULT true,
  allow_email_write BOOLEAN DEFAULT false,
  allow_calendar_read BOOLEAN DEFAULT true,
  allow_calendar_write BOOLEAN DEFAULT false,
  max_queries_per_day INT DEFAULT 100,
  max_scheduled_tasks INT DEFAULT 0,
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(client_number, tier_code)
);

-- ============================================================
-- Indexes for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_system_logs_status ON system_logs(status);
CREATE INDEX IF NOT EXISTS idx_system_logs_category ON system_logs(category);
CREATE INDEX IF NOT EXISTS idx_token_usage_date ON token_usage(date);
CREATE INDEX IF NOT EXISTS idx_token_usage_client ON token_usage(client_number);
CREATE INDEX IF NOT EXISTS idx_token_query_log_user ON token_query_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_user_learning_user ON user_learning(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_client ON feedback(client_number);
