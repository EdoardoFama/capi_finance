-- ============================================================================
-- 0011_security_hardening.sql
-- Camada de Segurança: Rate Limiting distribuído, Auditoria e Proteção de OTP
-- ============================================================================

-- 1. Tabela de Rate Limiting e Bloqueio contra Força Bruta / DDoS
CREATE TABLE IF NOT EXISTS rate_limits (
  key           TEXT PRIMARY KEY,
  points        INTEGER NOT NULL DEFAULT 0,
  window_start  INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);

-- 2. Tabela de Logs de Auditoria de Segurança
CREATE TABLE IF NOT EXISTS security_audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  event_type TEXT NOT NULL,
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  details    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_security_audit_created ON security_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_user ON security_audit_logs(user_id);

-- 3. Contador de tentativas de OTP (proteção contra força bruta em códigos de 6 dígitos)
ALTER TABLE verification_codes ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;

-- 4. Metadados de rastreamento de sessão (IP, User-Agent e data de criação)
ALTER TABLE sessions ADD COLUMN ip_address TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN user_agent TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
