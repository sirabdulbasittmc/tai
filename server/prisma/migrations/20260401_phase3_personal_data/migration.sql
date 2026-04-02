-- Phase 3: Personal Data (GDrive + File Upload)
-- Adds personal_drive_folder_id/last_sync to users,
-- and creates personal_documents + personal_chunks tables.

-- User: personal GDrive fields
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS personal_drive_folder_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS personal_drive_last_sync TIMESTAMPTZ;

-- Personal documents table (GDrive files + uploaded files)
CREATE TABLE IF NOT EXISTS personal_documents (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source          VARCHAR(20) NOT NULL,          -- 'gdrive' | 'upload'
  external_id     VARCHAR(255),                  -- GDrive file ID (NULL for uploads)
  folder_id       VARCHAR(255),                  -- GDrive folder ID (NULL for uploads)
  file_name       VARCHAR(255) NOT NULL,
  mime_type       VARCHAR(100) NOT NULL,
  size_bytes      INTEGER,
  content_hash    VARCHAR(64),                   -- SHA-256 for dedup
  storage_path    VARCHAR(500),                  -- GCS path for uploaded files
  parse_status    VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|processing|done|error
  parse_error     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personal_documents_user ON personal_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_personal_documents_user_source ON personal_documents(user_id, source);
CREATE INDEX IF NOT EXISTS idx_personal_documents_user_ext ON personal_documents(user_id, external_id);

-- Personal chunks table (embeddings of personal document content)
CREATE TABLE IF NOT EXISTS personal_chunks (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL,
  document_id   INTEGER NOT NULL REFERENCES personal_documents(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  embedding     JSONB NOT NULL DEFAULT '[]',
  chunk_index   INTEGER NOT NULL,
  content_hash  VARCHAR(64) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personal_chunks_user ON personal_chunks(user_id);
CREATE INDEX IF NOT EXISTS idx_personal_chunks_document ON personal_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_personal_chunks_hash ON personal_chunks(content_hash);
