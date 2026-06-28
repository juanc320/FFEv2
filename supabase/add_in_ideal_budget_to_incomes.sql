-- Migration: Agregar columna in_ideal_budget a la tabla monthly_income_items
ALTER TABLE monthly_income_items
  ADD COLUMN IF NOT EXISTS in_ideal_budget boolean DEFAULT true;
