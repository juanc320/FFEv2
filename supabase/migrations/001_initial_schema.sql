-- ============================================================
-- FFE v2 — Migración inicial completa
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- 1. FAMILIES
CREATE TABLE IF NOT EXISTS families (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  currency   text NOT NULL DEFAULT 'COP',
  created_at timestamptz DEFAULT now()
);

-- 2. PROFILES (extiende auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        text,
  display_name text,
  family_id    uuid REFERENCES families(id),
  role         text DEFAULT 'member' CHECK (role IN ('admin','member','observer')),
  created_at   timestamptz DEFAULT now()
);

-- 3. FAMILY MEMBERS
CREATE TABLE IF NOT EXISTS family_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id  uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name       text NOT NULL,
  user_id    uuid REFERENCES profiles(id),
  active     boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 4. ACCOUNTS
CREATE TABLE IF NOT EXISTS accounts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id              uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  type                   text NOT NULL CHECK (type IN ('bank','cash','pocket','external','pending_income')),
  is_internal            boolean DEFAULT true,
  opening_balance        numeric(15,2) DEFAULT 0,
  current_balance_cached numeric(15,2) DEFAULT 0,
  applies_4x1000         boolean DEFAULT false,
  is_4x1000_exempt       boolean DEFAULT false,
  active                 boolean DEFAULT true,
  created_at             timestamptz DEFAULT now()
);

-- 5. CATEGORIES
CREATE TABLE IF NOT EXISTS categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id  uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name       text NOT NULL,
  type       text DEFAULT 'expense' CHECK (type IN ('expense','income')),
  active     boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 6. CONCEPTS
CREATE TABLE IF NOT EXISTS concepts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id),
  name        text NOT NULL,
  active      boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

-- 7. BUDGET MONTHS
CREATE TABLE IF NOT EXISTS budget_months (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id            uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  year                 int NOT NULL,
  month                int NOT NULL CHECK (month BETWEEN 1 AND 12),
  status               text DEFAULT 'active' CHECK (status IN ('active','closed')),
  currency             text DEFAULT 'COP',
  copied_from_month_id uuid REFERENCES budget_months(id),
  created_at           timestamptz DEFAULT now(),
  closed_at            timestamptz,
  UNIQUE (family_id, year, month)
);

-- 8. MONTHLY INCOME ITEMS
CREATE TABLE IF NOT EXISTS monthly_income_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month_id         uuid NOT NULL REFERENCES budget_months(id) ON DELETE CASCADE,
  family_id        uuid NOT NULL REFERENCES families(id),
  member_id        uuid REFERENCES family_members(id),
  concept_id       uuid REFERENCES concepts(id),
  label            text NOT NULL,
  gross_amount     numeric(15,2) NOT NULL DEFAULT 0,
  deduction_type   text DEFAULT 'none' CHECK (deduction_type IN ('none','percent','fixed','both')),
  deduction_rate   numeric(5,4) DEFAULT 0,
  deduction_amount numeric(15,2) DEFAULT 0,
  net_expected     numeric(15,2) GENERATED ALWAYS AS (
    CASE deduction_type
      WHEN 'percent' THEN ROUND(gross_amount * (1 - deduction_rate), 2)
      WHEN 'fixed'   THEN gross_amount - deduction_amount
      WHEN 'both'    THEN ROUND(gross_amount * (1 - deduction_rate), 2) - deduction_amount
      ELSE gross_amount
    END
  ) STORED,
  expected_date    date,
  received_amount  numeric(15,2) DEFAULT 0,
  status           text DEFAULT 'pending' CHECK (status IN ('pending','partial','received')),
  is_recurring     boolean DEFAULT false,
  created_at       timestamptz DEFAULT now()
);

-- 9. MONTHLY EXPENSE ITEMS (sobres)
CREATE TABLE IF NOT EXISTS monthly_expense_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month_id              uuid NOT NULL REFERENCES budget_months(id) ON DELETE CASCADE,
  family_id             uuid NOT NULL REFERENCES families(id),
  category_id           uuid NOT NULL REFERENCES categories(id),
  concept_id            uuid NOT NULL REFERENCES concepts(id),
  expense_type          text NOT NULL CHECK (expense_type IN ('fixed','variable','sporadic')),
  criticality           text DEFAULT 'necessary' CHECK (criticality IN ('critical','necessary','desirable','optional')),
  due_mode              text DEFAULT 'once' CHECK (due_mode IN ('once','multiple','anytime')),
  due_date              date,
  budget_amount         numeric(15,2) NOT NULL DEFAULT 0,
  arrears_amount        numeric(15,2) DEFAULT 0,
  executed_amount_cached numeric(15,2) DEFAULT 0,
  deferred_amount       numeric(15,2) DEFAULT 0,
  status                text DEFAULT 'pending' CHECK (status IN ('pending','partial','paid','deferred')),
  active_in_month       boolean DEFAULT true,
  created_at            timestamptz DEFAULT now()
);

-- 10. TRANSACTIONS (fuente de verdad)
CREATE TABLE IF NOT EXISTS transactions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id              uuid NOT NULL REFERENCES families(id),
  month_id               uuid NOT NULL REFERENCES budget_months(id),
  type                   text NOT NULL CHECK (type IN (
    'expense','income','transfer_internal',
    'transfer_external_in','transfer_external_out',
    'adjustment','tax_4x1000','reallocation'
  )),
  amount                 numeric(15,2) NOT NULL CHECK (amount >= 0),
  tax_amount             numeric(15,2) DEFAULT 0,
  source_account_id      uuid REFERENCES accounts(id),
  destination_account_id uuid REFERENCES accounts(id),
  external_party_label   text,
  category_id            uuid REFERENCES categories(id),
  concept_id             uuid REFERENCES concepts(id),
  expense_item_id        uuid REFERENCES monthly_expense_items(id),
  income_item_id         uuid REFERENCES monthly_income_items(id),
  is_automatic           boolean DEFAULT false,
  parent_transaction_id  uuid REFERENCES transactions(id),
  date                   date NOT NULL DEFAULT CURRENT_DATE,
  note                   text,
  created_by             uuid REFERENCES profiles(id),
  created_at             timestamptz DEFAULT now()
);

-- 11. BUDGET REALLOCATIONS
CREATE TABLE IF NOT EXISTS budget_reallocations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month_id             uuid NOT NULL REFERENCES budget_months(id),
  from_expense_item_id uuid NOT NULL REFERENCES monthly_expense_items(id),
  to_expense_item_id   uuid NOT NULL REFERENCES monthly_expense_items(id),
  amount               numeric(15,2) NOT NULL CHECK (amount > 0),
  reason               text,
  created_by           uuid REFERENCES profiles(id),
  created_at           timestamptz DEFAULT now()
);

-- 12. TAX RULES (parametrizable para futuro)
CREATE TABLE IF NOT EXISTS tax_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id        uuid REFERENCES families(id),
  name             text NOT NULL DEFAULT '4x1000',
  rate             numeric(8,6) NOT NULL DEFAULT 0.004,
  applies_to       text DEFAULT 'bank_account_exit',
  mode             text DEFAULT 'per_transaction' CHECK (mode IN ('per_transaction','cumulative_threshold')),
  threshold_amount numeric(15,2),
  threshold_period text,
  active_from      date DEFAULT CURRENT_DATE,
  active_until     date,
  active           boolean DEFAULT true,
  created_at       timestamptz DEFAULT now()
);

-- 13. MONTH COPY DECISIONS
CREATE TABLE IF NOT EXISTS month_copy_decisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_month_id  uuid NOT NULL REFERENCES budget_months(id),
  target_month_id  uuid NOT NULL REFERENCES budget_months(id),
  item_type        text NOT NULL,
  item_id          uuid NOT NULL,
  decision         text NOT NULL CHECK (decision IN ('copied','skipped','modified')),
  copied_amount    numeric(15,2),
  created_at       timestamptz DEFAULT now()
);

-- 14. IMPORT BATCHES
CREATE TABLE IF NOT EXISTS import_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   uuid NOT NULL REFERENCES families(id),
  month_id    uuid REFERENCES budget_months(id),
  file_name   text,
  status      text DEFAULT 'pending' CHECK (status IN ('pending','validated','imported','error')),
  total_rows  int DEFAULT 0,
  error_rows  int DEFAULT 0,
  error_log   jsonb,
  created_by  uuid REFERENCES profiles(id),
  created_at  timestamptz DEFAULT now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE families           ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories         ENABLE ROW LEVEL SECURITY;
ALTER TABLE concepts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_months      ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_income_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_expense_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_reallocations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_rules          ENABLE ROW LEVEL SECURITY;
ALTER TABLE month_copy_decisions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches     ENABLE ROW LEVEL SECURITY;

-- Helper function: obtener family_id del usuario actual
CREATE OR REPLACE FUNCTION current_family_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT family_id FROM profiles WHERE id = auth.uid()
$$;

-- Política base: aislamiento por familia
CREATE POLICY "family_isolation" ON families          FOR ALL USING (id = current_family_id());
CREATE POLICY "family_insert" ON families             FOR INSERT WITH CHECK (true);
CREATE POLICY "family_isolation" ON family_members    FOR ALL USING (family_id = current_family_id());
CREATE POLICY "family_isolation" ON accounts          FOR ALL USING (family_id = current_family_id());
CREATE POLICY "family_isolation" ON categories        FOR ALL USING (family_id = current_family_id());
CREATE POLICY "family_isolation" ON concepts          FOR ALL USING (family_id = current_family_id());
CREATE POLICY "family_isolation" ON budget_months     FOR ALL USING (family_id = current_family_id());
CREATE POLICY "family_isolation" ON monthly_income_items  FOR ALL USING (family_id = current_family_id());
CREATE POLICY "family_isolation" ON monthly_expense_items FOR ALL USING (family_id = current_family_id());
CREATE POLICY "family_isolation" ON transactions      FOR ALL USING (family_id = current_family_id());
CREATE POLICY "family_isolation" ON budget_reallocations FOR ALL USING (month_id IN (SELECT id FROM budget_months WHERE family_id = current_family_id()));
CREATE POLICY "family_isolation" ON tax_rules         FOR ALL USING (family_id IS NULL OR family_id = current_family_id());
CREATE POLICY "family_isolation" ON month_copy_decisions FOR ALL USING (source_month_id IN (SELECT id FROM budget_months WHERE family_id = current_family_id()));
CREATE POLICY "family_isolation" ON import_batches    FOR ALL USING (family_id = current_family_id());

-- Profiles: cada usuario solo ve/edita su propio perfil
CREATE POLICY "own_profile" ON profiles
  FOR ALL USING (id = auth.uid());

-- ============================================================
-- FUNCIONES SQL — Cálculos reutilizables
-- ============================================================

-- Recalcular saldo de cuenta desde transacciones
CREATE OR REPLACE FUNCTION recalculate_account_balance(p_account_id uuid)
RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE
  v_opening  numeric;
  v_inflows  numeric;
  v_outflows numeric;
BEGIN
  SELECT opening_balance INTO v_opening FROM accounts WHERE id = p_account_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_inflows
  FROM transactions
  WHERE destination_account_id = p_account_id
    AND type IN ('income','transfer_internal','transfer_external_in','adjustment');

  SELECT COALESCE(SUM(amount + tax_amount), 0) INTO v_outflows
  FROM transactions
  WHERE source_account_id = p_account_id
    AND type IN ('expense','transfer_internal','transfer_external_out','adjustment','tax_4x1000');

  RETURN COALESCE(v_opening, 0) + v_inflows - v_outflows;
END;
$$;

-- Disponible de un sobre
CREATE OR REPLACE FUNCTION envelope_available(p_item_id uuid)
RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE
  v_budget    numeric;
  v_arrears   numeric;
  v_executed  numeric;
  v_deferred  numeric;
  v_realloc_in  numeric;
  v_realloc_out numeric;
BEGIN
  SELECT budget_amount, arrears_amount, executed_amount_cached, deferred_amount
  INTO v_budget, v_arrears, v_executed, v_deferred
  FROM monthly_expense_items WHERE id = p_item_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_realloc_in
  FROM budget_reallocations WHERE to_expense_item_id = p_item_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_realloc_out
  FROM budget_reallocations WHERE from_expense_item_id = p_item_id;

  RETURN COALESCE(v_budget,0) + COALESCE(v_arrears,0)
    + v_realloc_in - v_realloc_out
    - COALESCE(v_executed,0) - COALESCE(v_deferred,0);
END;
$$;
-- ============================================================
-- AUTO-CREACIÓN DE FAMILIA
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_family(p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_family_id uuid;
BEGIN
  -- 1. Insertar la familia
  INSERT INTO public.families (name, currency)
  VALUES (p_name, 'COP')
  RETURNING id INTO v_family_id;

  -- 2. Actualizar el perfil del usuario activo
  UPDATE public.profiles
  SET family_id = v_family_id, role = 'admin'
  WHERE id = auth.uid();

  -- 3. Crear el miembro de la familia
  INSERT INTO public.family_members (family_id, name, user_id)
  SELECT v_family_id, display_name, id
  FROM public.profiles
  WHERE id = auth.uid();

  RETURN v_family_id;
END;
$$;

-- Auto-crear perfil al registrar usuario
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_family_id uuid;
  v_display_name text;
BEGIN
  v_display_name := COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1));
  
  -- Crear un espacio/familia personal por defecto
  INSERT INTO public.families (name, currency)
  VALUES ('Finanzas de ' || v_display_name, 'COP')
  RETURNING id INTO v_family_id;

  -- Crear el perfil del usuario asignándolo a esa familia
  INSERT INTO public.profiles (id, email, display_name, family_id, role)
  VALUES (
    NEW.id,
    NEW.email,
    v_display_name,
    v_family_id,
    'admin'
  )
  ON CONFLICT (id) DO NOTHING;

  -- Añadir al usuario como el primer integrante
  INSERT INTO public.family_members (family_id, name, user_id)
  VALUES (v_family_id, v_display_name, NEW.id);

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- DATOS INICIALES — Regla 4x1000 global
-- ============================================================
INSERT INTO tax_rules (name, rate, applies_to, mode, active_from, active)
VALUES ('4x1000 Colombia', 0.004, 'bank_account_exit', 'per_transaction', CURRENT_DATE, true)
ON CONFLICT DO NOTHING;
