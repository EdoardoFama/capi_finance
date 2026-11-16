-- Suporte a marcação de categorias quitadas mês a mês
CREATE TABLE IF NOT EXISTS category_month_checks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month       TEXT NOT NULL,            -- 'YYYY-MM'
  is_checked  INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, category_id, month)
);
CREATE INDEX IF NOT EXISTS idx_cat_checks_user_month ON category_month_checks(user_id, month);
