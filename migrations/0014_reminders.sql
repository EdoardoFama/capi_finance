-- Tabela de Lembretes e Vencimentos para o Calendário Financeiro
CREATE TABLE IF NOT EXISTS reminders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  date         TEXT NOT NULL, -- YYYY-MM-DD
  time         TEXT,          -- HH:MM (ex: "09:00")
  amount_cents INTEGER,       -- Valor previsto em centavos (opcional)
  category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  is_completed INTEGER NOT NULL DEFAULT 0,
  notify       INTEGER NOT NULL DEFAULT 1,
  recurrence   TEXT NOT NULL DEFAULT 'none', -- 'none' | 'monthly'
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reminders_user_date ON reminders(user_id, date);
