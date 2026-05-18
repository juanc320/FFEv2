-- Tabla de Gastos Periódicos (trimestrales, semestrales, anuales)
create table public.periodic_expenses (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  concept_id uuid references public.concepts(id) on delete set null,
  label text not null,
  amount numeric(12,2) not null default 0,
  -- 'quarterly' = cada 3 meses, 'semi_annual' = cada 6 meses, 'annual' = cada 12 meses
  periodicity text not null check (periodicity in ('quarterly', 'semi_annual', 'annual')),
  -- Mes y año de inicio (primer pago)
  start_month integer not null check (start_month between 1 and 12),
  start_year integer not null,
  criticality text not null default 'necessary' check (criticality in ('critical', 'necessary', 'desirable', 'optional')),
  due_day integer check (due_day between 1 and 31),
  active boolean not null default true,
  created_at timestamptz default now()
);

-- RLS
alter table public.periodic_expenses enable row level security;

create policy "family_periodic_expenses" on public.periodic_expenses
  for all using (
    family_id in (
      select family_id from public.profiles where id = auth.uid()
    )
  );
