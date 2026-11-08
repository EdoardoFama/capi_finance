-- Usuários e sessões
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,          -- SHA-256 do token do cookie
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL           -- epoch ms
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Orçamento: ganhos previstos
CREATE TABLE incomes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, name)
);

-- Orçamento: categorias de gasto (o valor é o teto mensal)
CREATE TABLE categories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  budget_cents INTEGER NOT NULL DEFAULT 0,
  note         TEXT NOT NULL DEFAULT '',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, name)
);

-- Lançamentos de gastos
CREATE TABLE expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id  INTEGER NOT NULL REFERENCES categories(id),
  amount_cents INTEGER NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  spent_on     TEXT NOT NULL,             -- YYYY-MM-DD
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_expenses_user_date ON expenses(user_id, spent_on);
CREATE INDEX idx_expenses_category ON expenses(category_id);

