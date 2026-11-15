-- Migração para suporte a tokens de integração externa (MacroDroid / Webhooks)
ALTER TABLE users ADD COLUMN webhook_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_webhook_token ON users(webhook_token) WHERE webhook_token IS NOT NULL;
