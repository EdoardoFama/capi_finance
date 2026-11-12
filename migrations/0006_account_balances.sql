-- Adiciona conta de pagamento (Nubank, Pluxe Alimentação, Pluxe Refeição, Alelo) nas despesas
ALTER TABLE expenses ADD COLUMN account_id TEXT NOT NULL DEFAULT 'nubank';
CREATE INDEX IF NOT EXISTS idx_expenses_account ON expenses(user_id, account_id);

-- Saldos definidos para cada conta no mês
CREATE TABLE IF NOT EXISTS account_balances (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month         TEXT NOT NULL,            -- YYYY-MM
  account_id    TEXT NOT NULL,            -- 'nubank', 'pluxe_alimentacao', 'pluxe_refeicao', 'alelo'
  initial_cents INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, month, account_id)
);
CREATE INDEX IF NOT EXISTS idx_account_balances_user_month ON account_balances(user_id, month);

