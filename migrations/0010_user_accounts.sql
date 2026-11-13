-- Tabela de contas e carteiras personalizadas por usuário
CREATE TABLE IF NOT EXISTS user_accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#10b981',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_user_accounts_user ON user_accounts(user_id);

-- Para o usuário admin inicial (user_id = 1, 'edoardofama'), cadastra as 4 contas prévias para não perder dados:
INSERT OR IGNORE INTO user_accounts (user_id, slug, name, color, sort_order)
SELECT 1, 'nubank', 'NUBANK', '#820ad1', 1
WHERE EXISTS (SELECT 1 FROM users WHERE id = 1);

INSERT OR IGNORE INTO user_accounts (user_id, slug, name, color, sort_order)
SELECT 1, 'pluxe_alimentacao', 'PLUXE - ALIMENTAÇÃO', '#10b981', 2
WHERE EXISTS (SELECT 1 FROM users WHERE id = 1);

INSERT OR IGNORE INTO user_accounts (user_id, slug, name, color, sort_order)
SELECT 1, 'pluxe_refeicao', 'PLUXE - REFEIÇÃO', '#06b6d4', 3
WHERE EXISTS (SELECT 1 FROM users WHERE id = 1);

INSERT OR IGNORE INTO user_accounts (user_id, slug, name, color, sort_order)
SELECT 1, 'alelo', 'ALELO', '#f97316', 4
WHERE EXISTS (SELECT 1 FROM users WHERE id = 1);

