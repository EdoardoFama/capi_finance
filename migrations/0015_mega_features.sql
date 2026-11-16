-- ============================================================================
-- 0015_mega_features.sql
-- Webhooks Logs + Idempotência, Cofres/Metas de Reserva, Tags, Ícones, Cadeado e PIN
-- ============================================================================

-- 1. Logs de Webhook com Chave de Idempotência e Reprocessamento (Itens 05 e 07)
CREATE TABLE IF NOT EXISTS webhook_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL DEFAULT '',
  body           TEXT NOT NULL DEFAULT '',
  dedup_hash     TEXT NOT NULL DEFAULT '',
  parsed_type    TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'processed',
  result_summary TEXT NOT NULL DEFAULT '',
  expense_id     INTEGER,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_user ON webhook_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_dedup ON webhook_logs(user_id, dedup_hash, created_at);

-- 2. Cofres e Metas de Reserva / Sonhos (Itens 22 e 23)
CREATE TABLE IF NOT EXISTS savings_goals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  icon          TEXT NOT NULL DEFAULT '🎯',
  target_cents  INTEGER NOT NULL DEFAULT 0,
  current_cents INTEGER NOT NULL DEFAULT 0,
  color         TEXT NOT NULL DEFAULT '#10b981',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_savings_goals_user ON savings_goals(user_id);

-- 3. Tags opcionais nos lançamentos (Item 44)
ALTER TABLE expenses ADD COLUMN tags TEXT NOT NULL DEFAULT '';

-- 4. Ícone personalizado nas categorias (Item 28)
ALTER TABLE categories ADD COLUMN icon TEXT NOT NULL DEFAULT '';

-- 5. Controle de desbloqueio manual do cadeado de teto estourado (Item 29)
ALTER TABLE category_month_checks ADD COLUMN is_unlocked INTEGER NOT NULL DEFAULT 0;

-- 6. PIN de bloqueio rápido do aplicativo — padrão '1201' (Item 81)
ALTER TABLE users ADD COLUMN pin_code TEXT NOT NULL DEFAULT '1201';
