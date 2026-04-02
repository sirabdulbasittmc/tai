-- Rollback: 20260328145354_no_roles_table
-- Reverses the initial schema creation by dropping all tables, indexes, and foreign keys.

-- Drop foreign keys first (reverse order of creation)
ALTER TABLE "scheduled_tasks" DROP CONSTRAINT IF EXISTS "scheduled_tasks_user_id_fkey";
ALTER TABLE "scheduled_tasks" DROP CONSTRAINT IF EXISTS "scheduled_tasks_client_number_fkey";
ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_user_id_fkey";
ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_client_number_fkey";
ALTER TABLE "user_memory" DROP CONSTRAINT IF EXISTS "user_memory_user_id_fkey";
ALTER TABLE "user_memory" DROP CONSTRAINT IF EXISTS "user_memory_client_number_fkey";
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_conversation_id_fkey";
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_client_number_fkey";
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_user_id_fkey";
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_client_number_fkey";
ALTER TABLE "chunks" DROP CONSTRAINT IF EXISTS "chunks_document_id_fkey";
ALTER TABLE "chunks" DROP CONSTRAINT IF EXISTS "chunks_client_number_fkey";
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_client_number_fkey";
ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_user_id_fkey";
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_client_number_fkey";
ALTER TABLE "system_config" DROP CONSTRAINT IF EXISTS "system_config_client_number_fkey";
ALTER TABLE "client_licenses" DROP CONSTRAINT IF EXISTS "client_licenses_client_number_fkey";

-- Drop tables (reverse order of creation)
DROP TABLE IF EXISTS "scheduled_tasks";
DROP TABLE IF EXISTS "audit_log";
DROP TABLE IF EXISTS "user_memory";
DROP TABLE IF EXISTS "messages";
DROP TABLE IF EXISTS "conversations";
DROP TABLE IF EXISTS "chunks";
DROP TABLE IF EXISTS "documents";
DROP TABLE IF EXISTS "sessions";
DROP TABLE IF EXISTS "users";
DROP TABLE IF EXISTS "system_config";
DROP TABLE IF EXISTS "client_licenses";
DROP TABLE IF EXISTS "licenses";
DROP TABLE IF EXISTS "tenants";

-- Remove from Prisma migration history
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260328145354_no_roles_table';
