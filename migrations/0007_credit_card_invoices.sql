-- Rastreamento de faturas pagas do Cartão de Crédito
CREATE TABLE IF NOT EXISTS credit_card_invoices (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month             TEXT NOT NULL,            -- YYYY-MM
  is_paid           INTEGER NOT NULL DEFAULT 0,
  paid_at           TEXT,
  paid_amount_cents INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_credit_invoices_user_month ON credit_card_invoices(user_id, month);

