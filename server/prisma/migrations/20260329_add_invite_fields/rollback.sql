-- Rollback: 20260329_add_invite_fields
-- Reverses the invite fields addition on the users table.

ALTER TABLE "users" DROP COLUMN IF EXISTS "invite_token";
ALTER TABLE "users" DROP COLUMN IF EXISTS "invite_expires_at";
ALTER TABLE "users" DROP COLUMN IF EXISTS "invite_sent_at";
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_set";

-- Remove from Prisma migration history
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260329_add_invite_fields';
