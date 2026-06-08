-- Migration: Agregar columna in_ideal_budget a la tabla monthly_expense_items
-- Ejecuta este script en el editor SQL de tu Supabase Dashboard.

ALTER TABLE public.monthly_expense_items 
  ADD COLUMN IF NOT EXISTS in_ideal_budget boolean DEFAULT true;
