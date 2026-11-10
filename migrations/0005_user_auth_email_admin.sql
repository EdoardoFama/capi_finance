-- Adiciona campos de email, status e role na tabela users
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;

-- Define o usuário edoardofama como admin e vincula o email inicial se desejar
UPDATE users SET is_admin = 1 WHERE username = 'edoardofama';

-- Tabela para guardar códigos OTP temporários de verificação
CREATE TABLE IF NOT EXISTS verification_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  code       TEXT NOT NULL,
  type       TEXT NOT NULL, -- 'signup' ou 'reset_password'
  payload    TEXT NOT NULL DEFAULT '', -- guarda dados temporários se necessário (ex: username, password_hash)
  expires_at INTEGER NOT NULL, -- epoch ms
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_verification_email ON verification_codes(email, code);

