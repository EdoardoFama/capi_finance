-- Adiciona suporte a forma de pagamento e parcelamento
ALTER TABLE expenses ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'debit';
ALTER TABLE expenses ADD COLUMN installment_current INTEGER NOT NULL DEFAULT 1;
ALTER TABLE expenses ADD COLUMN installment_total INTEGER NOT NULL DEFAULT 1;
ALTER TABLE expenses ADD COLUMN installment_group_id TEXT;

CREATE INDEX IF NOT EXISTS idx_expenses_payment ON expenses(user_id, payment_method);
CREATE INDEX IF NOT EXISTS idx_expenses_group ON expenses(installment_group_id);
