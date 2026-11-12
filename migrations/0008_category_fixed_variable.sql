-- Adiciona indicador de Categoria Fixa (1) ou Variável (0)
ALTER TABLE categories ADD COLUMN is_fixed INTEGER NOT NULL DEFAULT 1;

-- Categorias com orçamento zerado passam a ser variáveis por padrão
UPDATE categories SET is_fixed = 0 WHERE budget_cents = 0;

-- Categorias com orçamento definido são fixas
UPDATE categories SET is_fixed = 1 WHERE budget_cents > 0;

