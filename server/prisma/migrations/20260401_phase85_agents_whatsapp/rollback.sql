-- Rollback: Phase 8.5 agents + WhatsApp
DROP TABLE IF EXISTS whatsapp_sessions CASCADE;
DROP TABLE IF EXISTS whatsapp_messages CASCADE;
DROP TABLE IF EXISTS whatsapp_connections CASCADE;
DROP TABLE IF EXISTS agents CASCADE;
