-- Phase 4: Envelope encryption — add encrypted_dek column to users.
-- DEK = per-user 256-bit key, encrypted by MEK (from GCP Secret Manager).
-- Personal chunk content will be encrypted with the user's DEK in a future phase.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS encrypted_dek TEXT;  -- AES-256-GCM: base64(iv):base64(authTag):base64(ciphertext)
