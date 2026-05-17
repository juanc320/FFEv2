import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useAuth } from '@/features/auth/AuthContext'
import { useActiveMonth } from '@/features/months/MonthsPage'
import type { MonthlyExpenseItem, Category, Concept } from '@/shared/types/database'
import { formatCOP, calcEnvelopeAvailable } from '@/shared/utils/calculations'
import { Plus, AlertTriangle, CheckCircle, Clock, ChevronDown, Edit2, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { CurrencyInput } from '@/shared/components/CurrencyInput'

const CRITICALITY_COLORS = {
  critical: 'text-red-400 bg-red-500/15 border-red-500/30',
  necessary: 'text-amber-400 bg-amber-500/15 border-amber-500/30',
  desirable: 'text-blue-400 bg-blue-500/15 border-blue-500/30',
  optional: 'text-slate-400 bg-slate-700/30 border-slate-700/30',
}
const CRITICALITY_LABELS = { critical: 'Crítico', necessary: 'Necesario', desirable: 'Deseable', optional: 'Opcional' }
const TYPE_LABELS = { fixed: 'Fijo', variable: 'Variable', sporadic: 'Esporádico' }

function getStatusTag(item: MonthlyExpenseItem, available: number) {
  if (item.expense_type === 'variable' || item.expense_type === 'sporadic') {
    if (available < 0) return { label: 'Sobregirado', color: 'text-red-400 border-red-500/30 bg-red-500/10' }
    if (available === 0) return { label: 'Agotado', color: 'text-amber-400 border-amber-500/30 bg-amber-500/10' }
    return { label: 'Disponible', color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' }
  } else {
    // Fixed obligations
    if (item.executed_amount_cached > 0) return { label: 'Pagado', color: 'text-violet-400 border-violet-500/30 bg-violet-500/10' }
    if (item.budget_amount > 0) return { label: 'Listo para pagar', color: 'text-blue-400 border-blue-500/30 bg-blue-500/10' }
    return { label: 'Pendiente por fondear', color: 'text-slate-400 border-slate-500/30 bg-slate-500/10' }
  }
}

function useExpenseItems() {
  const { profile } = useAuth()
  const { data: activeMonth } = useActiveMonth()
  return useQuery({
    queryKey: ['expense_items', activeMonth?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('monthly_expense_items')
        .select('*')
        .eq('month_id', activeMonth!.id)
        .eq('active_in_month', true)
        .order('criticality')
      return (data ?? []) as MonthlyExpenseItem[]
    },
    enabled: !!activeMonth?.id && !!profile?.family_id,
  })
}

const EMPTY: {
  category_id: string;
  concept_id: string;
  expense_type: 'fixed' | 'variable' | 'sporadic';
  criticality: 'critical' | 'necessary' | 'desirable' | 'optional';
  due_mode: 'once' | 'recurring';
  due_date: string;
  budget_amount: number;
} = {
  category_id: '',
  concept_id: '',
  expense_type: 'fixed',
  criticality: 'necessary',
  due_mode: 'once',
  due_date: '',
  budget_amount: 0,
}

export default function ExpensesPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const qc = useQueryClient()
  const { data: activeMonth } = useActiveMonth()
  const { data: items = [], isLoading } = useExpenseItems()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [viewBy, setViewBy] = useState<'category' | 'type' | 'date'>(() => {
    return (localStorage.getItem('ffev2_expenses_view') as 'category' | 'type' | 'date') || 'category'
  })

  useEffect(() => {
    localStorage.setItem('ffev2_expenses_view', viewBy)
  }, [viewBy])

  // Categories + Concepts
  const { data: categories = [] } = useQuery({
    queryKey: ['categories', profile?.family_id],
    queryFn: async () => { const { data } = await supabase.from('categories').select('*').eq('family_id', profile!.family_id!).eq('type', 'expense').eq('active', true); return (data ?? []) as Category[] },
    enabled: !!profile?.family_id,
  })
  const { data: concepts = [] } = useQuery({
    queryKey: ['concepts', profile?.family_id],
    queryFn: async () => { const { data } = await supabase.from('concepts').select('*').eq('family_id', profile!.family_id!).eq('active', true); return (data ?? []) as Concept[] },
    enabled: !!profile?.family_id,
  })

  const filteredConcepts = concepts.filter(c => c.category_id === form.category_id)

  const createItem = useMutation({
    mutationFn: async () => {
      await db.from('monthly_expense_items').insert({
        month_id: activeMonth!.id,
        family_id: profile!.family_id!,
        category_id: form.category_id,
        concept_id: form.concept_id,
        expense_type: form.expense_type,
        criticality: form.criticality,
        due_mode: form.due_mode,
        due_date: form.due_date || null,
        budget_amount: form.budget_amount,
        arrears_amount: 0,
        deferred_amount: 0,
        status: 'pending',
        active_in_month: true,
      })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expense_items'] }); setShowForm(false); setForm(EMPTY) },
  })

  const deactivateItem = useMutation({
    mutationFn: async (id: string) => {
      await db.from('monthly_expense_items').update({ active_in_month: false }).eq('id', id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expense_items'] }),
  })

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      await db.from('monthly_expense_items').delete().eq('id', id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expense_items'] }),
  })

  const updateBudget = useMutation({
    mutationFn: async ({ id, newBudget }: { id: string; newBudget: number }) => {
      await db.from('monthly_expense_items').update({ budget_amount: newBudget }).eq('id', id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expense_items'] }),
  })

  const updateDate = useMutation({
    mutationFn: async ({ id, newDate }: { id: string; newDate: string | null }) => {
      await db.from('monthly_expense_items').update({ due_date: newDate || null }).eq('id', id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expense_items'] }),
  })

  const deferExpense = useMutation({
    mutationFn: async ({ id, newDeferred }: { id: string; newDeferred: number }) => {
      await db.from('monthly_expense_items').update({ deferred_amount: newDeferred }).eq('id', id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expense_items'] }),
  })

  const totalBudget = items.reduce((s, i) => s + i.budget_amount + i.arrears_amount, 0)
  const totalExecuted = items.reduce((s, i) => s + i.executed_amount_cached, 0)

  const groups = useMemo(() => {
    // Función para ordenar por fecha (los que no tienen fecha van al final)
    const sortByDate = (a: MonthlyExpenseItem, b: MonthlyExpenseItem) => {
      if (!a.due_date && !b.due_date) return 0
      if (!a.due_date) return 1
      if (!b.due_date) return -1
      return a.due_date.localeCompare(b.due_date)
    }

    if (viewBy === 'category') {
      return categories.map(cat => ({
        id: cat.id,
        label: cat.name,
        items: items.filter(i => i.category_id === cat.id).sort(sortByDate)
      })).filter(g => g.items.length > 0)
    }
    if (viewBy === 'type') {
      return ['fixed', 'variable', 'sporadic'].map(t => ({
        id: t,
        label: TYPE_LABELS[t as keyof typeof TYPE_LABELS],
        items: items.filter(i => i.expense_type === t).sort(sortByDate)
      })).filter(g => g.items.length > 0)
    }
    if (viewBy === 'date') {
      const dates = Array.from(new Set(items.map(i => i.due_date || 'Sin fecha'))).sort()
      return dates.map(d => ({
        id: d,
        label: d === 'Sin fecha' ? 'Sin fecha límite' : `Fecha de pago: ${d}`,
        items: items.filter(i => (i.due_date || 'Sin fecha') === d)
      })).filter(g => g.items.length > 0)
    }
    return []
  }, [items, categories, viewBy])

  if (!activeMonth) {
    return (
      <div className="max-w-2xl mx-auto mt-16 card text-center space-y-3">
        <AlertTriangle className="text-amber-400 mx-auto" size={32} />
        <p className="text-white font-semibold">No hay un mes activo</p>
        <p className="text-slate-400 text-sm">Ve a <a href="/months" className="text-indigo-400 underline">Mes presupuestal</a> y crea el mes primero.</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Sobres presupuestados</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Ejecutado: <span className="text-white font-medium">{formatCOP(totalExecuted)}</span>
            {' '}/ Presupuesto: <span className="text-indigo-400 font-medium">{formatCOP(totalBudget)}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button className="btn-primary flex items-center gap-2" onClick={() => setShowForm(true)}>
            <Plus size={16} /> Nuevo sobre
          </button>
          <select className="input px-2 py-1 text-xs bg-slate-800 border-slate-700 text-slate-300 rounded" value={viewBy} onChange={e => setViewBy(e.target.value as any)}>
            <option value="category">Por categoría</option>
            <option value="type">Por tipo</option>
            <option value="date">Por fecha de pago</option>
          </select>
        </div>
      </div>

      {/* Formulario */}
      {showForm && (
        <div className="card border-indigo-500/30 space-y-4">
          <h2 className="text-white font-semibold">Nuevo sobre presupuestado</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Categoría</label>
              <select className="input w-full" value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value, concept_id: '' }))}>
                <option value="">Seleccionar...</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Concepto</label>
              <select className="input w-full" value={form.concept_id} onChange={e => setForm(f => ({ ...f, concept_id: e.target.value }))} disabled={!form.category_id}>
                <option value="">Seleccionar...</option>
                {filteredConcepts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Tipo</label>
              <select className="input w-full" value={form.expense_type} onChange={e => setForm(f => ({ ...f, expense_type: e.target.value as 'fixed' | 'variable' | 'sporadic' }))}>
                <option value="fixed">Fijo</option>
                <option value="variable">Variable</option>
                <option value="sporadic">Esporádico</option>
              </select>
            </div>
            <div>
              <label className="label">Criticidad</label>
              <select className="input w-full" value={form.criticality} onChange={e => setForm(f => ({ ...f, criticality: e.target.value as typeof form.criticality }))}>
                <option value="critical">Crítico</option>
                <option value="necessary">Necesario</option>
                <option value="desirable">Deseable</option>
                <option value="optional">Opcional</option>
              </select>
            </div>
            <div>
              <label className="label">Presupuesto</label>
              <CurrencyInput className="input w-full" value={form.budget_amount} onChange={val => setForm(f => ({ ...f, budget_amount: val }))} />
            </div>
            <div>
              <label className="label">Fecha límite (opcional)</label>
              <input type="date" className="input w-full" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancelar</button>
            <button className="btn-primary" disabled={!form.category_id || !form.concept_id || createItem.isPending} onClick={() => createItem.mutate()}>
              {createItem.isPending ? 'Guardando...' : 'Agregar sobre'}
            </button>
          </div>
        </div>
      )}

      {/* Lista */}
      {isLoading && <div className="card text-center text-slate-500 py-8">Cargando...</div>}
      {!isLoading && items.length === 0 && (
        <div className="card text-center text-slate-500 py-10">
          <p className="font-medium text-slate-400 mb-1">Sin sobres presupuestados</p>
          <p className="text-sm">Agrega los sobres del mes con el botón de arriba.</p>
        </div>
      )}

      {groups.map(group => {
        return (
          <div key={group.id} className="space-y-3 mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-widest px-1 text-slate-400 border-b border-slate-800 pb-1">
              {group.label}
            </h3>
            {group.items.map(item => {
              const conName = concepts.find(c => c.id === item.concept_id)?.name ?? ''
              const available = calcEnvelopeAvailable(item.budget_amount, item.arrears_amount, 0, 0, item.executed_amount_cached, item.deferred_amount)
              const pct = item.budget_amount > 0 ? Math.min((item.executed_amount_cached / item.budget_amount) * 100, 100) : 0
              const isExpanded = expandedId === item.id
              return (
                <div key={item.id} className="card p-0 overflow-hidden">
                  <div
                    className="flex items-center gap-4 px-4 py-3.5 cursor-pointer hover:bg-slate-800/30 transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                  >
                    {item.status === 'paid'
                      ? <CheckCircle size={16} className="text-emerald-400 flex-shrink-0" />
                      : item.arrears_amount > 0
                        ? <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
                        : <Clock size={16} className="text-amber-400 flex-shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-slate-200 text-sm font-medium">{conName}</p>
                        {isExpanded && (
                          <span className={clsx('text-xs px-1.5 py-0.5 rounded border', CRITICALITY_COLORS[item.criticality as keyof typeof CRITICALITY_COLORS])}>
                            {CRITICALITY_LABELS[item.criticality as keyof typeof CRITICALITY_LABELS]}
                          </span>
                        )}
                        {isExpanded && (
                          <span className="text-xs px-1.5 py-0.5 rounded border border-slate-700 text-slate-400">
                            {TYPE_LABELS[item.expense_type as keyof typeof TYPE_LABELS]}
                          </span>
                        )}
                        {(() => {
                          const tag = getStatusTag(item, available)
                          return (
                            <span className={clsx('text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wider', tag.color)}>
                              {tag.label}
                            </span>
                          )
                        })()}
                        {!isExpanded && item.due_date && (() => {
                          const todayStr = new Date().toISOString().split('T')[0]
                          const isOverdue = item.executed_amount_cached === 0 && item.due_date < todayStr
                          return (
                            <span className={clsx("text-[11px] font-medium tracking-wide flex items-center gap-1 ml-1", isOverdue ? "text-red-400" : "text-slate-500")}>
                              <Clock size={11} className="opacity-70" />
                              {item.due_date.split('-').reverse().slice(0, 2).join('/')}
                              {isOverdue && <span className="text-[9px] uppercase px-1 rounded bg-red-500/20 text-red-300">Vencido</span>}
                            </span>
                          )
                        })()}
                      </div>
                      {/* Progress bar */}
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="flex-1 bg-slate-800 rounded-full h-1 overflow-hidden">
                          <div className={clsx('h-full rounded-full', pct >= 100 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-indigo-500')} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-slate-500 text-xs">{Math.round(pct)}%</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-white text-sm font-semibold">{formatCOP(item.executed_amount_cached)}</p>
                      <p className="text-slate-500 text-xs">/ {formatCOP(item.budget_amount)}</p>
                    </div>
                    <ChevronDown size={15} className={clsx('text-slate-500 transition-transform', isExpanded && 'rotate-180')} />
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-800 px-4 py-3 bg-slate-900/50 space-y-3">
                      <div className="grid grid-cols-4 gap-4 text-center">
                        <div>
                          <p className="text-slate-500 text-xs">Presupuesto</p>
                          <p className="text-slate-200 text-sm font-semibold">{formatCOP(item.budget_amount)}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-xs">Mora</p>
                          <p className={clsx('text-sm font-semibold', item.arrears_amount > 0 ? 'text-red-400' : 'text-slate-200')}>{formatCOP(item.arrears_amount)}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-xs" title="No generará mora">Diferido</p>
                          <p className={clsx('text-sm font-semibold', item.deferred_amount > 0 ? 'text-amber-400' : 'text-slate-200')}>{formatCOP(item.deferred_amount)}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-xs">Disponible</p>
                          <p className={clsx('text-sm font-semibold', available <= 0 ? 'text-red-400' : 'text-emerald-400')}>{formatCOP(available)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <label className="text-slate-500 text-xs">Fecha límite:</label>
                        <input 
                          type="date" 
                          className="input px-2 py-1 text-xs h-7 bg-slate-800 border-slate-700 text-slate-300 w-auto" 
                          value={item.due_date || ''} 
                          onChange={(e) => updateDate.mutate({ id: item.id, newDate: e.target.value })}
                        />
                      </div>
                      <div className="flex justify-end gap-4 mt-2">
                        <button className="text-xs flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition-colors" onClick={() => {
                          navigate('/transactions', { 
                            state: { 
                              prefillExpenseId: item.id, 
                              prefillCategoryId: item.category_id, 
                              prefillConceptId: item.concept_id 
                            } 
                          })
                        }}>
                          <Plus size={14} /> Registrar pago
                        </button>
                        <button className="text-xs flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors" onClick={() => {
                          const amt = window.prompt(`Nuevo presupuesto para este gasto:`, String(item.budget_amount))
                          if (amt !== null && !isNaN(Number(amt.replace(/\D/g, '')))) {
                             updateBudget.mutate({ id: item.id, newBudget: Number(amt.replace(/\D/g, '')) })
                          }
                        }}>
                          <Edit2 size={14} /> Editar
                        </button>
                        <button className="text-xs flex items-center gap-1 text-amber-400 hover:text-amber-300 transition-colors" onClick={() => {
                          const amt = window.prompt(`Monto a diferir (actual: ${item.deferred_amount}).\nEsto reduce el monto a pagar este mes sin generar mora en el siguiente.`, String(item.deferred_amount))
                          if (amt !== null && !isNaN(Number(amt.replace(/\D/g, '')))) deferExpense.mutate({ id: item.id, newDeferred: Number(amt.replace(/\D/g, '')) })
                        }}>
                          <Clock size={14} /> Diferir
                        </button>
                        <button className="text-xs flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors" onClick={() => {
                          if (window.confirm('¿Seguro que deseas eliminar este gasto del mes?')) {
                            deleteItem.mutate(item.id)
                          }
                        }}>
                          <Trash2 size={14} /> Eliminar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
