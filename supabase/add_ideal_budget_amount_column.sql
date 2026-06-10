-- Migration: Agregar columna ideal_budget_amount a la tabla monthly_expense_items
-- Ejecuta este script en el editor SQL de tu Supabase Dashboard para soportar montos simulados.

ALTER TABLE public.monthly_expense_items 
  ADD COLUMN IF NOT EXISTS ideal_budget_amount numeric(12,2) DEFAULT NULL;
