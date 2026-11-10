-- Tabela de contas/ativos de investimentos (ex: NUBANK, INTER, SANTANDER)
CREATE TABLE IF NOT EXISTS investment_accounts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#10b981',
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, name)
);

-- Registros mensais de cada investimento
CREATE TABLE IF NOT EXISTS investment_snapshots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id   INTEGER NOT NULL REFERENCES investment_accounts(id) ON DELETE CASCADE,
  month        TEXT NOT NULL,              -- YYYY-MM
  balance_cents INTEGER NOT NULL DEFAULT 0, -- Saldo total ao final do mês
  delta_cents   INTEGER NOT NULL DEFAULT 0, -- Movimentação: rendeu (+) ou sacou (-)
  UNIQUE (user_id, account_id, month)
);

CREATE INDEX IF NOT EXISTS idx_inv_snapshots_user_month ON investment_snapshots(user_id, month);
