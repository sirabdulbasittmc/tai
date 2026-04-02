-- Rollback: Phase 4 envelope encryption
ALTER TABLE users DROP COLUMN IF EXISTS encrypted_dek;
