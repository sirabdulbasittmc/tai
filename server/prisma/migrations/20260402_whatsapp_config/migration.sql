-- Phase 8.5 Enhancement: WhatsApp Config + Updated Message/Connection schema
-- Supports multi-provider (webjs, meta, twilio) with per-tenant config

-- WhatsApp tenant configuration (one per tenant)
CREATE TABLE IF NOT EXISTS whatsapp_config (
  id                    SERIAL PRIMARY KEY,
  client_number         VARCHAR(20) NOT NULL UNIQUE,
  provider              VARCHAR(20) NOT NULL DEFAULT 'webjs',  -- webjs | meta | twilio

  -- Meta Cloud API credentials (encrypted)
  meta_phone_number_id  VARCHAR(100),
  meta_access_token     TEXT,          -- AES-256-GCM encrypted
  meta_business_id      VARCHAR(100),
  meta_webhook_secret   TEXT,          -- AES-256-GCM encrypted

  -- Connection state
  status                VARCHAR(20) NOT NULL DEFAULT 'disconnected',
  connected_number      VARCHAR(30),
  connected_at          TIMESTAMPTZ,
  last_message_at       TIMESTAMPTZ,
  last_error_at         TIMESTAMPTZ,
  last_error            TEXT,
  qr_code               TEXT,          -- base64 QR image (webjs only)
  qr_expires_at         TIMESTAMPTZ,

  -- Rate limits
  daily_limit           INTEGER NOT NULL DEFAULT 100,
  monthly_limit         INTEGER NOT NULL DEFAULT 2000,
  messages_today        INTEGER NOT NULL DEFAULT 0,
  messages_this_month   INTEGER NOT NULL DEFAULT 0,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Update whatsapp_connections: add client_number, display_name, opt_in
ALTER TABLE whatsapp_connections
  ADD COLUMN IF NOT EXISTS client_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS opt_in BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS opt_in_at TIMESTAMPTZ;

-- Update whatsapp_messages: add client_number, from_number, to_number, message_type, requires_approval
ALTER TABLE whatsapp_messages
  ADD COLUMN IF NOT EXISTS client_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS from_number VARCHAR(30),
  ADD COLUMN IF NOT EXISTS to_number VARCHAR(30),
  ADD COLUMN IF NOT EXISTS message_type VARCHAR(20) DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS approved_by INTEGER,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Rename 'message_id' to 'wa_message_id' if needed (add new column, keep old for compat)
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS wa_message_id VARCHAR(100);

-- Update whatsapp_sessions: add client_number, phone_number
ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS client_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS phone_number VARCHAR(30);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wa_config_tenant ON whatsapp_config(client_number);
CREATE INDEX IF NOT EXISTS idx_wa_conn_phone ON whatsapp_connections(phone_number, client_number);
CREATE INDEX IF NOT EXISTS idx_wa_msg_tenant ON whatsapp_messages(client_number, created_at);
CREATE INDEX IF NOT EXISTS idx_wa_msg_status ON whatsapp_messages(status);
CREATE INDEX IF NOT EXISTS idx_wa_session_tenant ON whatsapp_sessions(client_number, closed_at);
