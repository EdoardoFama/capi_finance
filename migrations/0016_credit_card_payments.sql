-- Histórico individual de pagamentos de fatura do cartão de crédito (totais ou parciais)
CREATE TABLE IF NOT EXISTS credit_card_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invoice_month TEXT NOT NULL,
  account_id TEXT NOT NULL DEFAULT 'nubank',
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  is_partial INTEGER NOT NULL DEFAULT 0,
  paid_on TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cc_payments_user_date ON credit_card_payments(user_id, paid_on);
CREATE INDEX IF NOT EXISTS idx_cc_payments_user_month ON credit_card_payments(user_id, invoice_month);

-- Backfill das faturas já pagas (total ou parcialmente) em credit_card_invoices
INSERT INTO credit_card_payments (user_id, invoice_month, account_id, amount_cents, is_partial, paid_on, created_at)
SELECT
  user_id,
  month,
  'nubank',
  paid_amount_cents,
  CASE WHEN is_paid = 1 THEN 0 ELSE 1 END,
  substr(COALESCE(paid_at, created_at), 1, 10),
  COALESCE(paid_at, created_at)
FROM credit_card_invoices
WHERE paid_amount_cents > 0;
