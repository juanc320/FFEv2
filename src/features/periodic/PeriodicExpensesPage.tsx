import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useAuth } from '@/features/auth/AuthContext'
import { Plus, RefreshCw, Trash2, AlertTriangle } from 'lucide-react'
import type { Category, Concept } from '@/shared/types/database'
import { formatCOP } from '@/shared/utils/calculations'
import { CurrencyInput } from '@/shared/components/CurrencyInput'
import clsx from 'clsx'

const PERIODICITY_LABELS = {
  quarterly: 'Trimestral (cada 3 meses)',
  semi_annual: 'Semestral (cada 6 meses)',
  annual: 'Anual (cada 12 meses)',
}

const PERIODICITY_BADGE = {
  quarterly: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  semi_annual: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  annual: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
}

const CRITICALITY_LABELS = { critical: 'Crítico', necessary: 'Necesario', desirable: 'Deseable', optional: 'Opcional' }

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const now = new Date()

const EMPTY_FORM = {
  label: '',
  category_id: '',
  concept_id: '',
  amount: 0,
  periodicity: 'annual' as 'quarterly' | 'semi_annual' | 'annual',
  start_month: now.getMonth() + 1,
  start_year: now.getFullYear(),
  criticality: 'necessary' as 'critical' | 'necessary' | 'desirable' | 'optional',
  due_day: '' as number | '',
}

/** Calcula los próximos meses en los que vence este gasto periódico */
function getNextDueDates(startMonth: number, startYear: number, periodicity: string, count = 3): string[] {
  const intervalMonths = periodicity === 'quarterly' ? 3 : periodicity === 'semi_annual' ? 6 : 12
  const result: string[] = []
  let m = startMonth
  let y = startYear
  const todayYear = now.getFullYear()
  const todayMonth = now.getMonth() + 1

  // Avanzar hasta llegar al futuro
  while (y < todayYear || (y === todayYear && m < todayMonth)) {
    m += intervalMonths
    if (m > 12) { y += Math.floor((m - 1) / 12); m = ((m - 1) % 12) + 1 }
  }

  for (let i = 0; i < count; i++) {
    result.push(`${MONTH_NAMES[m - 1]} ${y}`)
    m += intervalMonths
    if (m > 12) { y += Math.floor((m - 1) / 12); m = ((m - 1) % 12) + 1 }
  }
  return result
}

export default function PeriodicExpensesPage() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['periodic_expenses', profile?.family_id],
    queryFn: async () => {
      const { data } = await supabase.from('periodic_expenses').select('*').eq('family_id', profile!.family_id!).eq('active', true).order('amount', { ascending: false })
      return data ?? []
    },
    enabled: !!profile?.family_id,
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', profile?.family_id],
    queryFn: async () => { const { data } = await supabase.from('categories').select('*').eq('family_id', profile!.family_id!).order('name'); return (data ?? []) as Category[] },
    enabled: !!profile?.family_id,
  })

  const { data: concepts = [] } = useQuery({
    queryKey: ['concepts', profile?.family_id],
    queryFn: async () => { const { data } = await supabase.from('concepts').select('*').eq('family_id', profile!.family_id!).order('name'); return (data ?? []) as Concept[] },
    enabled: !!profile?.family_id,
  })

  const filteredConcepts = concepts.filter(c => c.category_id === form.category_id)

  const createItem = useMutation({
    mutationFn: async () => {
      await db.from('periodic_expenses').insert({
        family_id: profile!.family_id!,
        label: form.label.trim(),
        category_id: form.category_id || null,
        concept_id: form.concept_id || null,
        amount: form.amount,
        periodicity: form.periodicity,
        start_month: form.start_month,
        start_year: form.start_year,
        criticality: form.criticality,
        due_day: form.due_day || null,
        active: true,
      })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['periodic_expenses'] }); setShowForm(false); setForm(EMPTY_FORM) },
  })

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      await db.from('periodic_expenses').update({ active: false }).eq('id', id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['periodic_expenses'] }),
  })

  const totalAnnual = items.reduce((s: number, i: any) => {
    const mult = i.periodicity === 'quarterly' ? 4 : i.periodicity === 'semi_annual' ? 2 : 1
    return s + i.amount * mult
  }, 0)

  const totalMonthlyAvg = Math.round(totalAnnual / 12)

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Gastos periódicos</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Trimestrales, semestrales y anuales ·{' '}
            <span className="text-indigo-400 font-medium">~{formatCOP(totalMonthlyAvg)}/mes promedio</span>
          </p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => setShowForm(true)}>
          <Plus size={16} /> Nuevo periódico
        </button>
      </div>

      {/* Formulario */}
      {showForm && (
        <div className="card border-violet-500/30 space-y-4">
          <h2 className="text-white font-semibold">Nuevo gasto periódico</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="label">Nombre del gasto</label>
              <input className="input w-full" placeholder="Ej: Mantenimiento del carro" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
            </div>
            <div>
              <label className="label">Categoría (opcional)</label>
              <select className="input w-full" value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value, concept_id: '' }))}>
                <option value="">Sin categoría</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Concepto (opcional)</label>
              <select className="input w-full" value={form.concept_id} onChange={e => setForm(f => ({ ...f, concept_id: e.target.value }))} disabled={!form.category_id}>
                <option value="">Sin concepto</option>
                {filteredConcepts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Monto estimado</label>
              <CurrencyInput className="input w-full" value={form.amount} onChange={val => setForm(f => ({ ...f, amount: val }))} />
            </div>
            <div>
              <label className="label">Periodicidad</label>
              <select className="input w-full" value={form.periodicity} onChange={e => setForm(f => ({ ...f, periodicity: e.target.value as any }))}>
                <option value="quarterly">Trimestral (cada 3 meses)</option>
                <option value="semi_annual">Semestral (cada 6 meses)</option>
                <option value="annual">Anual (cada 12 meses)</option>
              </select>
            </div>
            <div>
              <label className="label">Mes de inicio</label>
              <div className="grid grid-cols-2 gap-2">
                <select className="input w-full" value={form.start_month} onChange={e => setForm(f => ({ ...f, start_month: Number(e.target.value) }))}>
                  {MONTH_NAMES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                </select>
                <select className="input w-full" value={form.start_year} onChange={e => setForm(f => ({ ...f, start_year: Number(e.target.value) }))}>
                  {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label">Criticidad</label>
              <select className="input w-full" value={form.criticality} onChange={e => setForm(f => ({ ...f, criticality: e.target.value as any }))}>
                {Object.entries(CRITICALITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Día del mes (opcional)</label>
              <input type="number" min={1} max={31} className="input w-full" placeholder="Ej: 15" value={form.due_day} onChange={e => setForm(f => ({ ...f, due_day: e.target.value ? Number(e.target.value) : '' }))} />
            </div>
          </div>

          {/* Preview de próximas fechas */}
          {form.amount > 0 && (
            <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl px-4 py-3 space-y-1">
              <p className="text-violet-300 text-xs font-medium uppercase tracking-wide">Próximas fechas de pago estimadas</p>
              <div className="flex gap-3 flex-wrap mt-1">
                {getNextDueDates(form.start_month, form.start_year, form.periodicity).map(d => (
                  <span key={d} className="text-xs px-2 py-1 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">{d} · {formatCOP(form.amount)}</span>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancelar</button>
            <button className="btn-primary" disabled={!form.label.trim() || form.amount <= 0 || createItem.isPending} onClick={() => createItem.mutate()}>
              {createItem.isPending ? 'Guardando...' : 'Agregar gasto periódico'}
            </button>
          </div>
        </div>
      )}

      {/* Info de inyección automática */}
      <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-4 py-3 flex gap-3">
        <RefreshCw size={16} className="text-indigo-400 flex-shrink-0 mt-0.5" />
        <p className="text-indigo-300 text-sm">
          <span className="font-medium">Inyección automática:</span> Cuando crees un nuevo mes, el sistema detectará automáticamente qué gastos periódicos corresponden a ese mes y los agregará a tu Plan de gastos como tipo <span className="font-medium">Esporádico</span>.
        </p>
      </div>

      {/* Lista */}
      {isLoading && <div className="card text-center text-slate-500 py-8">Cargando...</div>}
      {!isLoading && items.length === 0 && (
        <div className="card text-center py-10 space-y-2">
          <RefreshCw className="text-slate-600 mx-auto" size={36} />
          <p className="text-slate-400 font-medium">Sin gastos periódicos</p>
          <p className="text-slate-500 text-sm">Agrega los gastos que no son mensuales: mantenimiento del carro, seguros anuales, etc.</p>
        </div>
      )}
      <div className="space-y-3">
        {items.map((item: any) => {
          const nextDates = getNextDueDates(item.start_month, item.start_year, item.periodicity, 2)
          const mult = item.periodicity === 'quarterly' ? 4 : item.periodicity === 'semi_annual' ? 2 : 1
          const annualCost = item.amount * mult
          return (
            <div key={item.id} className="card p-0 overflow-hidden">
              <div className="flex items-center gap-4 px-4 py-3">
                <div className={clsx('flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center border', PERIODICITY_BADGE[item.periodicity as keyof typeof PERIODICITY_BADGE])}>
                  <RefreshCw size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-slate-200 text-sm font-medium">{item.label}</p>
                    <span className={clsx('text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wider', PERIODICITY_BADGE[item.periodicity as keyof typeof PERIODICITY_BADGE])}>
                      {item.periodicity === 'quarterly' ? 'Trimestral' : item.periodicity === 'semi_annual' ? 'Semestral' : 'Anual'}
                    </span>
                  </div>
                  <p className="text-slate-500 text-xs mt-0.5">
                    Próx: {nextDates[0]} · {formatCOP(annualCost)}/año
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-white font-semibold text-sm">{formatCOP(item.amount)}</p>
                  <p className="text-slate-500 text-xs">por pago</p>
                </div>
                <button
                  className="icon-btn text-slate-500 hover:text-red-400 hover:bg-red-400/10"
                  onClick={() => { if (confirm(`¿Eliminar "${item.label}"?`)) deleteItem.mutate(item.id) }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {items.length > 0 && (
        <div className="card bg-slate-800/30 border-slate-700/30 flex items-center justify-between">
          <div>
            <p className="text-slate-400 text-sm">Costo anual proyectado</p>
            <p className="text-white font-bold text-lg">{formatCOP(totalAnnual)}</p>
          </div>
          <div className="text-right">
            <p className="text-slate-400 text-sm">Promedio mensual</p>
            <p className="text-indigo-400 font-semibold">{formatCOP(totalMonthlyAvg)}</p>
          </div>
        </div>
      )}
    </div>
  )
}
