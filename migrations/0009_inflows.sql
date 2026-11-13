-- Entradas / Inflows de dinheiro nas carteiras/contas (ex: Salário, Vale, Pix recebido, Resgate de investimento)
CREATE TABLE IF NOT EXISTS inflows (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id    TEXT NOT NULL,            -- 'nubank', 'pluxe_alimentacao', 'pluxe_refeicao', 'alelo'
  amount_cents  INTEGER NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  received_on   TEXT NOT NULL,            -- YYYY-MM-DD
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inflows_user_date ON inflows(user_id, received_on);
CREATE INDEX IF NOT EXISTS idx_inflows_account ON inflows(user_id, account_id);

