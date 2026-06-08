-- 1. Agregar columna de tipo a la tabla de ingresos mensuales
ALTER TABLE public.monthly_income_items 
  ADD COLUMN IF NOT EXISTS income_type text DEFAULT 'fixed' CHECK (income_type IN ('fixed', 'sporadic'));

-- 2. Crear tabla de Ingresos Periódicos (trimestrales, semestrales, anuales)
CREATE TABLE IF NOT EXISTS public.periodic_incomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
  concept_id uuid REFERENCES public.concepts(id) ON DELETE SET NULL,
  label text NOT NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  -- 'quarterly' = cada 3 meses, 'semi_annual' = cada 6 meses, 'annual' = cada 12 meses
  periodicity text NOT NULL CHECK (periodicity IN ('quarterly', 'semi_annual', 'annual')),
  -- Mes y año de inicio (primer ingreso)
  start_month integer NOT NULL CHECK (start_month BETWEEN 1 AND 12),
  start_year integer NOT NULL,
  due_day integer CHECK (due_day BETWEEN 1 AND 31),
  active boolean NOT NULL DEFAULT true,
  deduction_type text DEFAULT 'none' CHECK (deduction_type IN ('none', 'percent', 'fixed', 'both')),
  deduction_rate numeric(12,4) DEFAULT 0,
  deduction_amount numeric(12,2) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 3. Habilitar Seguridad de Nivel de Fila (RLS)
ALTER TABLE public.periodic_incomes ENABLE ROW LEVEL SECURITY;

-- 4. Crear política para acceso familiar
CREATE POLICY "family_periodic_incomes" ON public.periodic_incomes
  FOR ALL USING (
    family_id IN (
      SELECT family_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- 5. Agregar columnas si la tabla ya existe
ALTER TABLE public.periodic_incomes
  ADD COLUMN IF NOT EXISTS deduction_type text DEFAULT 'none' CHECK (deduction_type IN ('none', 'percent', 'fixed', 'both')),
  ADD COLUMN IF NOT EXISTS deduction_rate numeric(12,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deduction_amount numeric(12,2) DEFAULT 0;
