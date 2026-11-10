-- Adiciona campo de título obrigatório nas despesas
ALTER TABLE expenses ADD COLUMN title TEXT NOT NULL DEFAULT '';

