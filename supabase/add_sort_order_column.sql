-- Migration: Agregar columna sort_order a la tabla monthly_expense_items
ALTER TABLE public.monthly_expense_items 
ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;
