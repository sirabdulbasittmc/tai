-- Rollback: WhatsApp Config enhancement
DROP TABLE IF EXISTS whatsapp_config CASCADE;
ALTER TABLE whatsapp_connections DROP COLUMN IF EXISTS client_number, DROP COLUMN IF EXISTS display_name, DROP COLUMN IF EXISTS opt_in, DROP COLUMN IF EXISTS opt_in_at;
ALTER TABLE whatsapp_messages DROP COLUMN IF EXISTS client_number, DROP COLUMN IF EXISTS from_number, DROP COLUMN IF EXISTS to_number, DROP COLUMN IF EXISTS message_type, DROP COLUMN IF EXISTS requires_approval, DROP COLUMN IF EXISTS approved_by, DROP COLUMN IF EXISTS approved_at, DROP COLUMN IF EXISTS error_message, DROP COLUMN IF EXISTS updated_at, DROP COLUMN IF EXISTS wa_message_id;
ALTER TABLE whatsapp_sessions DROP COLUMN IF EXISTS client_number, DROP COLUMN IF EXISTS phone_number;
