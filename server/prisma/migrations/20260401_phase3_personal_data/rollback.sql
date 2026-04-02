-- Rollback: Phase 3 personal data tables
DROP TABLE IF EXISTS personal_chunks CASCADE;
DROP TABLE IF EXISTS personal_documents CASCADE;
ALTER TABLE users
  DROP COLUMN IF EXISTS personal_drive_folder_id,
  DROP COLUMN IF EXISTS personal_drive_last_sync;
