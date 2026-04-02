-- Rollback: Phase 9 Platform & Marketplace
DROP TABLE IF EXISTS marketplace_installations CASCADE;
DROP TABLE IF EXISTS marketplace_connectors CASCADE;
DROP TABLE IF EXISTS agent_templates CASCADE;
DROP TABLE IF EXISTS api_key_usage CASCADE;
DROP TABLE IF EXISTS api_keys CASCADE;
