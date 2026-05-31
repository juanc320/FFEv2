import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useAuth } from '@/features/auth/AuthContext'
import { useActiveMonth } from '@/features/months/MonthsPage'
import type { MonthlyExpenseItem, Category, Concept } from '@/shared/types/database'
import { formatCOP, calcEnvelopeAvailable } from '@/shared/utils/calculations'
import { Plus, AlertTriangle, CheckCircle, Clock, ChevronDown, Edit2, Trash2, Tag, Calendar, Shield, PiggyBank } from 'lucide-react'
import clsx from 'clsx'
import { CurrencyInput } from '@/shared/components/CurrencyInput'

const CRITICALITY_COLORS = {
  critical: 'text-red-400 bg-red-500/15 border-red-500/30',
  necessary: 'text-amber-400 bg-amber-500/15 border-amber-500/30',
  desirable: 'text-blue-400 bg-blue-500/15 border-blue-500/30',
  optional: 'text-slate-400 bg-slate-700/30 border-slate-700/30',
}

const CRITICALITY_LABELS = { 
  critical: 'Crítico', 
  necessary: 'Necesario', 
  desirable: 'Deseable', 
  optional: 'Opcional' 
}

const TYPE_LABELS = { 
  fixed: 'Obligación', 
  sporadic: 'Obligación', 
  variable: 'Bolsillo (Sobre)' 
}

function getStatusTag(item: MonthlyExpenseItem) {
  const totalDue = item.budget_amount + item.arrears_amount
  const executed = item.executed_amount_cached

  if (item.expense_type === 'variable') {
    const available = totalDue - executed - item.deferred_amount
    if (available < 0) return { label: 'Sobregirado', color: 'text-red-400 border-red-500/30 bg-red-500/10' }
    if (available === 0 && totalDue === 0) return { label: 'Sin asignar', color: 'text-slate-400 border-slate-700/50 bg-slate-800/40' }
    if (available === 0) return { label: 'Agotado', color: 'text-amber-400 border-amber-500/30 bg-amber-500/10' }
    return { label: 'Disponible', color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' }
  } else {
    // Obligations (fixed and sporadic): pure binary paid/pending/postponed/no_apply
    if (totalDue === 0) return { label: 'No aplica', color: 'text-slate-400 border-slate-700/50 bg-slate-800/40' }
    if (item.postponed) return { label: 'Pospuesto', color: 'text-slate-400 border-slate-700/50 bg-slate-800/60' }
    if (executed >= totalDue) return { label: 'Pagado', color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' }
    return { label: 'Pendiente', color: 'text-orange-400 border-orange-500/30 bg-orange-500/10' }
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

const EMPTY = {
  category_id: '',
  concept_id: '',
  expense_type: 'fixed' as 'fixed' | 'variable' | 'sporadic',
  criticality: 'necessary' as 'critical' | 'necessary' | 'desirable' | 'optional',
  due_mode: 'once' as 'once' | 'multiple' | 'anytime',
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
  const [showZeroItems, setShowZeroItems] = useState(false)
  
  // Tab state: 'obligations' (fixed & sporadic) or 'envelopes' (variable)
  const [activeTab, setActiveTab] = useState<'obligations' | 'envelopes'>(() => {
    return (localStorage.getItem('ffev2_expenses_tab') as 'obligations' | 'envelopes') || 'obligations'
  })

  useEffect(() => {
    setShowZeroItems(false)
  }, [activeTab])

  // States for inline editing
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{
    expense_type: 'fixed' | 'variable' | 'sporadic';
    budget_amount: number;
    criticality: 'critical' | 'necessary' | 'desirable' | 'optional';
    due_date: string;
  } | null>(null)

  useEffect(() => {
    localStorage.setItem('ffev2_expenses_tab', activeTab)
  }, [activeTab])

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

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      await db.from('monthly_expense_items').delete().eq('id', id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expense_items'] }),
  })

  const updateItem = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<MonthlyExpenseItem> }) => {
      await db.from('monthly_expense_items').update(data).eq('id', id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense_items'] })
      setEditingId(null)
      setEditForm(null)
    },
  })

  const postponeItem = useMutation({
    mutationFn: async (item: MonthlyExpenseItem) => {
      const pending = Math.max(0, (item.budget_amount + item.arrears_amount) - item.executed_amount_cached)
      await db.from('monthly_expense_items').update({ 
        postponed: true,
        deferred_amount: pending  
      }).eq('id', item.id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expense_items'] }),
  })

  const unpostponeItem = useMutation({
    mutationFn: async (item: MonthlyExpenseItem) => {
      await db.from('monthly_expense_items').update({ 
        postponed: false,
        deferred_amount: 0  
      }).eq('id', item.id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expense_items'] }),
  })

  // Separate lists of items
  const obligationsItems = useMemo(() => {
    return items.filter(i => i.expense_type === 'fixed' || i.expense_type === 'sporadic')
  }, [items])

  const envelopesItems = useMemo(() => {
    return items.filter(i => i.expense_type === 'variable')
  }, [items])

  // KPIs for Obligations
  const obligationsStats = useMemo(() => {
    const budget = obligationsItems.reduce((s, i) => s + i.budget_amount + i.arrears_amount, 0)
    const executed = obligationsItems.reduce((s, i) => s + i.executed_amount_cached, 0)
    const pending = obligationsItems.reduce((s, i) => {
      return s + Math.max(0, i.budget_amount + i.arrears_amount - i.executed_amount_cached - i.deferred_amount)
    }, 0)
    return { budget, executed, pending }
  }, [obligationsItems])

  // KPIs for Envelopes
  const envelopesStats = useMemo(() => {
    const budget = envelopesItems.reduce((s, i) => s + i.budget_amount + i.arrears_amount, 0)
    const executed = envelopesItems.reduce((s, i) => s + i.executed_amount_cached, 0)
    const available = envelopesItems.reduce((s, i) => {
      return s + calcEnvelopeAvailable(i.budget_amount, i.arrears_amount, 0, 0, i.executed_amount_cached, i.deferred_amount)
    }, 0)
    return { budget, executed, available }
  }, [envelopesItems])

  const zeroObligations = useMemo(() => {
    return obligationsItems.filter(i => (i.budget_amount + i.arrears_amount) === 0)
  }, [obligationsItems])

  const zeroEnvelopes = useMemo(() => {
    return envelopesItems.filter(i => (i.budget_amount + i.arrears_amount) === 0)
  }, [envelopesItems])

  // Group items by category for rendering in folders
  const obligationsGroups = useMemo(() => {
    const sortByDate = (a: MonthlyExpenseItem, b: MonthlyExpenseItem) => {
      if (!a.due_date && !b.due_date) return 0
      if (!a.due_date) return 1
      if (!b.due_date) return -1
      return a.due_date.localeCompare(b.due_date)
    }

    const activeObligations = obligationsItems.filter(i => (i.budget_amount + i.arrears_amount) > 0)

    return categories.map(cat => ({
      id: cat.id,
      label: cat.name,
      items: activeObligations.filter(i => i.category_id === cat.id).sort(sortByDate)
    })).filter(g => g.items.length > 0)
  }, [obligationsItems, categories])

  const envelopesGroups = useMemo(() => {
    const activeEnvelopes = envelopesItems.filter(i => (i.budget_amount + i.arrears_amount) > 0)

    return categories.map(cat => ({
      id: cat.id,
      label: cat.name,
      items: activeEnvelopes.filter(i => i.category_id === cat.id)
    })).filter(g => g.items.length > 0)
  }, [envelopesItems, categories])

  // Set default type on form display (always 'fixed' for obligations now)
  useEffect(() => {
    if (showForm) {
      setForm(f => ({
        ...f,
        expense_type: activeTab === 'obligations' ? 'fixed' : 'variable'
      }))
    }
  }, [showForm, activeTab])

  const handleStartEdit = (item: MonthlyExpenseItem) => {
    setEditingId(item.id)
    setEditForm({
      expense_type: item.expense_type === 'sporadic' ? 'fixed' : item.expense_type,
      budget_amount: item.budget_amount,
      criticality: item.criticality,
      due_date: item.due_date || '',
    })
  }

  const handleSaveEdit = (id: string) => {
    if (!editForm) return
    const updates: Partial<MonthlyExpenseItem> = {
      expense_type: editForm.expense_type,
      budget_amount: editForm.budget_amount,
      criticality: editForm.criticality,
      due_date: editForm.expense_type === 'variable' ? null : (editForm.due_date || null),
    }
    updateItem.mutate({ id, data: updates })
  }

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
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header and Switch */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Plan de gastos</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Organiza tus finanzas separando obligaciones y bolsillos de consumo
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-primary flex items-center gap-2" onClick={() => setShowForm(true)}>
            <Plus size={16} /> {activeTab === 'obligations' ? 'Nueva obligación' : 'Nuevo sobre'}
          </button>
        </div>
      </div>

      {/* Tabs Menu */}
      <div className="flex border-b border-slate-800 gap-6 mt-2">
        <button
          onClick={() => { setActiveTab('obligations'); setExpandedId(null); setEditingId(null); }}
          className={clsx(
            'pb-3 text-sm font-semibold transition-all relative flex items-center gap-2',
            activeTab === 'obligations' ? 'text-indigo-400' : 'text-slate-400 hover:text-slate-200'
          )}
        >
          <Shield size={16} />
          Controlador de Obligaciones
          <span className="text-xs px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
            {obligationsItems.length}
          </span>
          {activeTab === 'obligations' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />
          )}
        </button>
        <button
          onClick={() => { setActiveTab('envelopes'); setExpandedId(null); setEditingId(null); }}
          className={clsx(
            'pb-3 text-sm font-semibold transition-all relative flex items-center gap-2',
            activeTab === 'envelopes' ? 'text-indigo-400' : 'text-slate-400 hover:text-slate-200'
          )}
        >
          <PiggyBank size={16} />
          Sobres de Consumo (Bolsillos)
          <span className="text-xs px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
            {envelopesItems.length}
          </span>
          {activeTab === 'envelopes' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />
          )}
        </button>
      </div>

      {/* KPIs Display */}
      {activeTab === 'obligations' ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card bg-slate-900/40 border-slate-800 p-4">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Total Comprometido</p>
            <p className="text-lg font-bold text-white mt-1">{formatCOP(obligationsStats.budget)}</p>
            <p className="text-[10px] text-slate-500 mt-1">Cuota + mora de este mes</p>
          </div>
          <div className="card bg-slate-900/40 border-slate-800 p-4">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Total Pagado/Abonado</p>
            <p className="text-lg font-bold text-emerald-400 mt-1">{formatCOP(obligationsStats.executed)}</p>
            <p className="text-[10px] text-slate-500 mt-1">Dinero transferido</p>
          </div>
          <div className="card bg-slate-900/40 border-slate-800 p-4">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Saldo Pendiente</p>
            <p className={clsx("text-lg font-bold mt-1", obligationsStats.pending > 0 ? "text-amber-400" : "text-slate-400")}>
              {formatCOP(obligationsStats.pending)}
            </p>
            <p className="text-[10px] text-slate-500 mt-1">Obligaciones por liquidar</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card bg-slate-900/40 border-slate-800 p-4">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Presupuesto Inicial</p>
            <p className="text-lg font-bold text-white mt-1">{formatCOP(envelopesStats.budget)}</p>
            <p className="text-[10px] text-slate-500 mt-1">Fondeo de base base cero</p>
          </div>
          <div className="card bg-slate-900/40 border-slate-800 p-4">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Dinero Gastado</p>
            <p className="text-lg font-bold text-slate-300 mt-1">{formatCOP(envelopesStats.executed)}</p>
            <p className="text-[10px] text-slate-500 mt-1">Transaccionalidad acumulada</p>
          </div>
          <div className="card bg-slate-900/40 border-slate-800 p-4">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Dinero Disponible</p>
            <p className={clsx("text-lg font-bold mt-1", envelopesStats.available < 0 ? "text-red-400" : "text-emerald-400")}>
              {formatCOP(envelopesStats.available)}
            </p>
            <p className="text-[10px] text-slate-500 mt-1">Saldo restante en bolsillos</p>
          </div>
        </div>
      )}

      {/* Expense Form */}
      {showForm && (
        <div className="card border-indigo-500/30 space-y-4 bg-slate-900/60">
          <h2 className="text-white font-semibold">
            {activeTab === 'obligations' ? 'Nueva Obligación Financiera' : 'Nuevo Bolsillo de Consumo'}
          </h2>
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
              <label className="label">Criticidad</label>
              <select className="input w-full" value={form.criticality} onChange={e => setForm(f => ({ ...f, criticality: e.target.value as typeof form.criticality }))}>
                <option value="critical">Crítico</option>
                <option value="necessary">Necesario</option>
                <option value="desirable">Deseable</option>
                <option value="optional">Opcional</option>
              </select>
            </div>
            <div>
              <label className="label">
                {activeTab === 'obligations' ? 'Monto Obligación' : 'Presupuesto Inicial'}
              </label>
              <CurrencyInput className="input w-full" value={form.budget_amount} onChange={val => setForm(f => ({ ...f, budget_amount: val }))} />
            </div>
            {activeTab === 'obligations' && (
              <div>
                <label className="label">Fecha límite (opcional)</label>
                <input type="date" className="input w-full" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
              </div>
            )}
          </div>
          <div className="flex gap-3 justify-end mt-2">
            <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancelar</button>
            <button className="btn-primary" disabled={!form.category_id || !form.concept_id || createItem.isPending} onClick={() => createItem.mutate()}>
              {createItem.isPending ? 'Guardando...' : activeTab === 'obligations' ? 'Agregar obligación' : 'Crear sobre'}
            </button>
          </div>
        </div>
      )}

      {/* Main List */}
      {isLoading && <div className="card text-center text-slate-500 py-8">Cargando...</div>}
      
      {!isLoading && activeTab === 'obligations' && obligationsItems.length === 0 && (
        <div className="card text-center text-slate-500 py-12">
          <Shield className="text-slate-600 mx-auto mb-2" size={32} />
          <p className="font-medium text-slate-400 mb-1">Sin obligaciones presupuestadas</p>
          <p className="text-xs">Agrega facturas fijas, cuotas o deudas comprometidas de este mes.</p>
        </div>
      )}

      {!isLoading && activeTab === 'envelopes' && envelopesItems.length === 0 && (
        <div className="card text-center text-slate-500 py-12">
          <PiggyBank className="text-slate-600 mx-auto mb-2" size={32} />
          <p className="font-medium text-slate-400 mb-1">Sin sobres de consumo activos</p>
          <p className="text-xs">Crea bolsillos para tus gastos de mercado, gasolina o salidas del mes.</p>
        </div>
      )}

      {/* Render Lists */}
      {activeTab === 'obligations' ? (
        obligationsGroups.map(group => (
          <div key={group.id} className="space-y-3 mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-widest px-1 text-slate-400 border-b border-slate-800 pb-1 flex items-center gap-1.5">
              <Tag size={12} className="opacity-70" />
              {group.label}
            </h3>
            {group.items.map(item => {
              const conName = concepts.find(c => c.id === item.concept_id)?.name ?? ''
              const totalDue = item.budget_amount + item.arrears_amount
              const executed = item.executed_amount_cached
              const pending = Math.max(0, totalDue - executed - item.deferred_amount)
              const isExpanded = expandedId === item.id
              const isEditing = editingId === item.id
              const tag = getStatusTag(item)

              return (
                <div key={item.id} className={clsx('card p-0 overflow-hidden bg-slate-900/30 border-slate-850', item.postponed && 'opacity-60', item.is_mora_item && 'border-red-500/40')}>
                  <div
                    className="flex items-center gap-4 px-4 py-3.5 cursor-pointer hover:bg-slate-800/30 transition-colors"
                    onClick={() => {
                      if (isExpanded) {
                        setExpandedId(null)
                        setEditingId(null)
                      } else {
                        setExpandedId(item.id)
                      }
                    }}
                  >
                    {item.is_mora_item
                      ? <AlertTriangle size={16} className="text-red-400 flex-shrink-0 animate-pulse" />
                      : item.postponed
                        ? <Calendar size={16} className="text-slate-500 flex-shrink-0" />
                        : totalDue === 0
                          ? <Tag size={16} className="text-slate-500 flex-shrink-0 opacity-60" />
                          : executed >= totalDue
                            ? <CheckCircle size={16} className="text-emerald-400 flex-shrink-0" />
                            : <Clock size={16} className="text-orange-400 flex-shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={clsx('text-sm font-medium', item.is_mora_item ? 'text-red-300' : 'text-slate-200')}>
                          {conName}{item.is_mora_item ? ' — Mora' : ''}
                        </p>
                        <span className={clsx('text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wider', tag.color)}>
                          {tag.label}
                        </span>
                        {item.arrears_amount > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded border font-bold uppercase tracking-wider bg-red-500/10 text-red-400 border-red-500/20">
                            Mora: {formatCOP(item.arrears_amount)}
                          </span>
                        )}
                        {item.due_date && (() => {
                          const todayStr = new Date().toISOString().split('T')[0]
                          const isOverdue = !item.postponed && executed < totalDue && item.due_date < todayStr
                          return (
                            <span className={clsx("text-[11px] font-medium tracking-wide flex items-center gap-1 ml-1", isOverdue ? "text-red-400" : "text-slate-500")}>
                              <Clock size={11} className="opacity-70" />
                              {item.due_date.split('-').reverse().slice(0, 2).join('/')}
                              {isOverdue && <span className="text-[9px] uppercase px-1 rounded bg-red-500/20 text-red-300">Vencido</span>}
                            </span>
                          )
                        })()}
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        {totalDue === 0 ? (
                          <span className="text-slate-400/80">No presupuestado / No aplica este mes</span>
                        ) : executed > 0 && executed < totalDue ? (
                          <span>Abonado: <strong className="text-slate-300">{formatCOP(executed)}</strong> · Quedan: <strong className="text-orange-400">{formatCOP(pending)}</strong>{item.arrears_amount > 0 && <span className="text-red-400 font-medium"> (incluye mora)</span>}</span>
                        ) : executed >= totalDue ? (
                          <span className="text-emerald-400/80">Liquidado al 100%</span>
                        ) : (
                          <span>
                            {item.arrears_amount > 0 ? (
                              <>
                                Cuota: <strong className="text-slate-300">{formatCOP(item.budget_amount)}</strong> + Mora: <strong className="text-red-400">{formatCOP(item.arrears_amount)}</strong>
                              </>
                            ) : (
                              <>Monto total: <strong className="text-slate-300">{formatCOP(totalDue)}</strong></>
                            )}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-white text-sm font-semibold">{formatCOP(pending)}</p>
                      <p className="text-slate-500 text-xs">Pendiente</p>
                    </div>
                    <ChevronDown size={15} className={clsx('text-slate-500 transition-transform', isExpanded && 'rotate-180')} />
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-800/60 px-4 py-4 bg-slate-950/40 space-y-4">
                      {isEditing && editForm ? (
                        /* Inline Edit Form */
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="text-xs text-slate-400 block mb-1">Clasificación</label>
                            <select 
                              className="input w-full text-xs py-1.5 h-8 bg-slate-800 border-slate-750" 
                              value={editForm.expense_type} 
                              onChange={e => setEditForm({ ...editForm, expense_type: e.target.value as any })}
                            >
                              <option value="fixed">Obligación</option>
                              <option value="variable">Sobre de Consumo (Bolsillo)</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-xs text-slate-400 block mb-1">Monto Presupuesto</label>
                            <CurrencyInput 
                              className="input w-full text-xs py-1.5 h-8 bg-slate-800 border-slate-750" 
                              value={editForm.budget_amount} 
                              onChange={val => setEditForm({ ...editForm, budget_amount: val })}
                            />
                          </div>
                          {editForm.expense_type !== 'variable' && (
                            <div>
                              <label className="text-xs text-slate-400 block mb-1">Fecha Límite</label>
                              <input 
                                type="date" 
                                className="input w-full text-xs py-1.5 h-8 bg-slate-800 border-slate-750 text-slate-350" 
                                value={editForm.due_date} 
                                onChange={e => setEditForm({ ...editForm, due_date: e.target.value })}
                              />
                            </div>
                          )}
                          <div>
                            <label className="text-xs text-slate-400 block mb-1">Criticidad</label>
                            <select 
                              className="input w-full text-xs py-1.5 h-8 bg-slate-800 border-slate-750" 
                              value={editForm.criticality} 
                              onChange={e => setEditForm({ ...editForm, criticality: e.target.value as any })}
                            >
                              <option value="critical">Crítico</option>
                              <option value="necessary">Necesario</option>
                              <option value="desirable">Deseable</option>
                              <option value="optional">Opcional</option>
                            </select>
                          </div>
                          <div className="sm:col-span-2 flex justify-end gap-2 mt-2">
                            <button className="btn-ghost text-xs py-1 px-3" onClick={() => setEditingId(null)}>Cancelar</button>
                            <button className="btn-primary text-xs py-1 px-3 bg-indigo-650" onClick={() => handleSaveEdit(item.id)}>Guardar</button>
                          </div>
                        </div>
                      ) : (
                        /* Static Panel */
                        <>
                          <div className="grid grid-cols-4 gap-4 text-center">
                            <div>
                              <p className="text-slate-500 text-xs">Cuota Base</p>
                              <p className="text-slate-200 text-sm font-semibold mt-0.5">{formatCOP(item.budget_amount)}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 text-xs">Mora Acumulada</p>
                              <p className={clsx('text-sm font-semibold mt-0.5', item.arrears_amount > 0 ? 'text-red-400' : 'text-slate-200')}>{formatCOP(item.arrears_amount)}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 text-xs">Abonado</p>
                              <p className="text-slate-200 text-sm font-semibold mt-0.5">{formatCOP(executed)}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 text-xs">Pospuesto</p>
                              <p className="text-slate-200 text-sm font-semibold mt-0.5">{formatCOP(item.deferred_amount)}</p>
                            </div>
                          </div>

                          <div className="flex justify-between items-center mt-2 pt-2 border-t border-slate-800/40">
                            <div className="flex items-center gap-1.5">
                              <span className={clsx('text-xs px-2 py-0.5 rounded border', CRITICALITY_COLORS[item.criticality as keyof typeof CRITICALITY_COLORS])}>
                                {CRITICALITY_LABELS[item.criticality as keyof typeof CRITICALITY_LABELS]}
                              </span>
                            </div>

                            <div className="flex justify-end gap-4">
                              {pending > 0 && (
                                <button className="text-xs flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition-colors" onClick={() => {
                                  navigate('/transactions', { 
                                    state: { 
                                      prefillExpenseId: item.id, 
                                      prefillCategoryId: item.category_id, 
                                      prefillConceptId: item.concept_id,
                                      prefillAmount: pending
                                    } 
                                  })
                                }}>
                                  <Plus size={14} /> Registrar pago
                                </button>
                              )}
                              <button className="text-xs flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors" onClick={() => handleStartEdit(item)}>
                                <Edit2 size={14} /> Editar
                              </button>
                              {!item.postponed && !item.is_mora_item && pending > 0 && (
                                <button className="text-xs flex items-center gap-1 text-orange-400 hover:text-orange-300 transition-colors" onClick={() => {
                                  if (window.confirm(`¿Posponer ${formatCOP(pending)} al siguiente mes?\nSe creará un ítem de mora prioritario el día 1.`)) {
                                    postponeItem.mutate(item)
                                  }
                                }}>
                                  <AlertTriangle size={14} /> Posponer
                                </button>
                              )}
                              {item.postponed && (
                                <button className="text-xs flex items-center gap-1 text-sky-400 hover:text-sky-300 transition-colors" onClick={() => {
                                  if (window.confirm(`¿Cancelar diferimiento de esta obligación para pagarla este mes?`)) {
                                    unpostponeItem.mutate(item)
                                  }
                                }}>
                                  <Calendar size={14} /> Reactivar pago
                                </button>
                              )}
                              <button className="text-xs flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors" onClick={() => {
                                if (window.confirm('¿Seguro que deseas eliminar esta obligación del plan del mes?')) {
                                  deleteItem.mutate(item.id)
                                }
                              }}>
                                <Trash2 size={14} /> Eliminar
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))
      ) : (
        envelopesGroups.map(group => (
          <div key={group.id} className="space-y-3 mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-widest px-1 text-slate-400 border-b border-slate-800 pb-1 flex items-center gap-1.5">
              <Tag size={12} className="opacity-70" />
              {group.label}
            </h3>
            {group.items.map(item => {
              const conName = concepts.find(c => c.id === item.concept_id)?.name ?? ''
              const budgetTotal = item.budget_amount + item.arrears_amount
              const executed = item.executed_amount_cached
              const available = calcEnvelopeAvailable(item.budget_amount, item.arrears_amount, 0, 0, executed, item.deferred_amount)
              
              // spent percentage
              const pct = budgetTotal > 0 ? Math.min((executed / budgetTotal) * 100, 100) : 0
              const isExpanded = expandedId === item.id
              const isEditing = editingId === item.id
              const tag = getStatusTag(item)

              return (
                <div key={item.id} className="card p-0 overflow-hidden bg-slate-900/30 border-slate-850">
                  <div
                    className="flex items-center gap-4 px-4 py-3.5 cursor-pointer hover:bg-slate-800/30 transition-colors"
                    onClick={() => {
                      if (isExpanded) {
                        setExpandedId(null)
                        setEditingId(null)
                      } else {
                        setExpandedId(item.id)
                      }
                    }}
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center flex-shrink-0 border border-slate-750">
                      <span className="text-indigo-400 text-xs font-bold font-mono">C</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-slate-200">{conName}</p>
                        <span className={clsx('text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wider', tag.color)}>
                          {tag.label}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-slate-800 text-slate-400 bg-slate-800/20">
                          Disponible: {formatCOP(available)}
                        </span>
                      </div>
                      
                      {/* Fuel Tank ProgressBar */}
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                          <div 
                            className={clsx(
                              'h-full rounded-full transition-all duration-300', 
                              available < 0 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-emerald-500'
                            )} 
                            style={{ width: `${pct}%` }} 
                          />
                        </div>
                        <span className="text-slate-500 text-xs font-semibold">{Math.round(pct)}% consumido</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-white text-sm font-semibold">{formatCOP(available)}</p>
                      <p className="text-slate-500 text-xs">Disponible</p>
                    </div>
                    <ChevronDown size={15} className={clsx('text-slate-500 transition-transform', isExpanded && 'rotate-180')} />
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-800/60 px-4 py-4 bg-slate-950/40 space-y-4">
                      {isEditing && editForm ? (
                        /* Inline Edit Form */
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="text-xs text-slate-400 block mb-1">Clasificación</label>
                            <select 
                              className="input w-full text-xs py-1.5 h-8 bg-slate-800 border-slate-750" 
                              value={editForm.expense_type} 
                              onChange={e => setEditForm({ ...editForm, expense_type: e.target.value as any })}
                            >
                              <option value="variable">Sobre de Consumo (Bolsillo)</option>
                              <option value="fixed">Obligación</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-xs text-slate-400 block mb-1">Presupuesto Inicial</label>
                            <CurrencyInput 
                              className="input w-full text-xs py-1.5 h-8 bg-slate-800 border-slate-750" 
                              value={editForm.budget_amount} 
                              onChange={val => setEditForm({ ...editForm, budget_amount: val })}
                            />
                          </div>
                          {editForm.expense_type !== 'variable' && (
                            <div>
                              <label className="text-xs text-slate-400 block mb-1">Fecha Límite</label>
                              <input 
                                type="date" 
                                className="input w-full text-xs py-1.5 h-8 bg-slate-800 border-slate-750 text-slate-350" 
                                value={editForm.due_date} 
                                onChange={e => setEditForm({ ...editForm, due_date: e.target.value })}
                              />
                            </div>
                          )}
                          <div>
                            <label className="text-xs text-slate-400 block mb-1">Criticidad</label>
                            <select 
                              className="input w-full text-xs py-1.5 h-8 bg-slate-800 border-slate-750" 
                              value={editForm.criticality} 
                              onChange={e => setEditForm({ ...editForm, criticality: e.target.value as any })}
                            >
                              <option value="critical">Crítico</option>
                              <option value="necessary">Necesario</option>
                              <option value="desirable">Deseable</option>
                              <option value="optional">Opcional</option>
                            </select>
                          </div>
                          <div className="sm:col-span-2 flex justify-end gap-2 mt-2">
                            <button className="btn-ghost text-xs py-1 px-3" onClick={() => setEditingId(null)}>Cancelar</button>
                            <button className="btn-primary text-xs py-1 px-3 bg-indigo-650" onClick={() => handleSaveEdit(item.id)}>Guardar</button>
                          </div>
                        </div>
                      ) : (
                        /* Static Panel */
                        <>
                          <div className="grid grid-cols-3 gap-4 text-center">
                            <div>
                              <p className="text-slate-500 text-xs">Presupuesto Asignado</p>
                              <p className="text-slate-200 text-sm font-semibold mt-0.5">{formatCOP(budgetTotal)}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 text-xs">Dinero Gastado</p>
                              <p className="text-slate-200 text-sm font-semibold mt-0.5">{formatCOP(executed)}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 text-xs">Saldo Disponible</p>
                              <p className={clsx('text-sm font-semibold mt-0.5', available < 0 ? 'text-red-400' : 'text-emerald-400')}>{formatCOP(available)}</p>
                            </div>
                          </div>

                          <div className="flex justify-between items-center mt-2 pt-2 border-t border-slate-800/40">
                            <span className={clsx('text-xs px-2 py-0.5 rounded border', CRITICALITY_COLORS[item.criticality as keyof typeof CRITICALITY_COLORS])}>
                              {CRITICALITY_LABELS[item.criticality as keyof typeof CRITICALITY_LABELS]}
                            </span>

                            <div className="flex justify-end gap-4">
                              <button className="text-xs flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition-colors" onClick={() => {
                                navigate('/transactions', { 
                                  state: { 
                                    prefillExpenseId: item.id, 
                                    prefillCategoryId: item.category_id, 
                                    prefillConceptId: item.concept_id 
                                  } 
                                })
                              }}>
                                <Plus size={14} /> Registrar gasto
                              </button>
                              <button className="text-xs flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors" onClick={() => handleStartEdit(item)}>
                                <Edit2 size={14} /> Editar
                              </button>
                              <button className="text-xs flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors" onClick={() => {
                                if (window.confirm('¿Seguro que deseas eliminar este sobre del plan del mes?')) {
                                  deleteItem.mutate(item.id)
                                }
                              }}>
                                <Trash2 size={14} /> Eliminar
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))
      )}

      {/* Zero budget section */}
      {((activeTab === 'obligations' ? zeroObligations : zeroEnvelopes).length > 0) && (
        <div className="mt-8 pt-4 border-t border-slate-800/80">
          <button 
            className="flex items-center justify-between w-full text-left text-xs font-semibold text-slate-500 hover:text-slate-400 py-2.5 transition-colors"
            onClick={() => setShowZeroItems(!showZeroItems)}
          >
            <span className="flex items-center gap-1.5">
              {showZeroItems ? '▼' : '▶'} {activeTab === 'obligations' ? 'Obligaciones' : 'Bolsillos'} no aplicables este mes ({ (activeTab === 'obligations' ? zeroObligations : zeroEnvelopes).length })
            </span>
            <span className="text-[10px] bg-slate-800/60 px-2 py-0.5 rounded border border-slate-700 text-slate-400">
              Valor $0
            </span>
          </button>
          
          {showZeroItems && (
            <div className="space-y-2 mt-3">
              {(activeTab === 'obligations' ? zeroObligations : zeroEnvelopes).map(item => {
                const conName = concepts.find(c => c.id === item.concept_id)?.name ?? ''
                const isExpanded = expandedId === item.id
                const isEditing = editingId === item.id
                
                return (
                  <div key={item.id} className="card p-0 overflow-hidden bg-slate-900/10 border-slate-850/50 opacity-60 hover:opacity-100 transition-opacity">
                    <div 
                      className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-slate-850/20"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    >
                      <div className="flex items-center gap-2.5">
                        <Tag size={12} className="text-slate-500" />
                        <span className="text-xs font-medium text-slate-400">{conName}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-slate-800 text-slate-500 bg-slate-800/20 font-medium">No aplica</span>
                        <ChevronDown size={12} className={clsx('text-slate-600 transition-transform', isExpanded && 'rotate-180')} />
                      </div>
                    </div>
                    
                    {isExpanded && (
                      <div className="border-t border-slate-800/60 px-4 py-3 bg-slate-950/20">
                        {isEditing && editForm ? (
                          /* Inline Edit */
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="text-xs text-slate-400 block mb-1">Clasificación</label>
                              <select 
                                className="input w-full text-xs py-1 h-8 bg-slate-800 border-slate-750" 
                                value={editForm.expense_type} 
                                onChange={e => setEditForm({ ...editForm, expense_type: e.target.value as any })}
                              >
                                <option value={activeTab === 'obligations' ? 'fixed' : 'variable'}>
                                  {activeTab === 'obligations' ? 'Obligación' : 'Sobre de Consumo'}
                                </option>
                                <option value={activeTab === 'obligations' ? 'variable' : 'fixed'}>
                                  {activeTab === 'obligations' ? 'Sobre de Consumo' : 'Obligación'}
                                </option>
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-slate-400 block mb-1">Asignar Presupuesto</label>
                              <CurrencyInput 
                                className="input w-full text-xs py-1 h-8 bg-slate-800 border-slate-750 font-bold" 
                                value={editForm.budget_amount} 
                                onChange={val => setEditForm({ ...editForm, budget_amount: val })}
                              />
                            </div>
                            {editForm.expense_type !== 'variable' && (
                              <div>
                                <label className="text-xs text-slate-400 block mb-1">Fecha Límite</label>
                                <input 
                                  type="date" 
                                  className="input w-full text-xs py-1 h-8 bg-slate-800 border-slate-750 text-slate-350" 
                                  value={editForm.due_date} 
                                  onChange={e => setEditForm({ ...editForm, due_date: e.target.value })}
                                />
                              </div>
                            )}
                            <div>
                              <label className="text-xs text-slate-400 block mb-1">Criticidad</label>
                              <select 
                                className="input w-full text-xs py-1 h-8 bg-slate-800 border-slate-750" 
                                value={editForm.criticality} 
                                onChange={e => setEditForm({ ...editForm, criticality: e.target.value as any })}
                              >
                                <option value="critical">Crítico</option>
                                <option value="necessary">Necesario</option>
                                <option value="desirable">Deseable</option>
                                <option value="optional">Opcional</option>
                              </select>
                            </div>
                            <div className="sm:col-span-2 flex justify-end gap-2 mt-1">
                              <button className="btn-ghost text-xs py-1 px-3" onClick={() => setEditingId(null)}>Cancelar</button>
                              <button className="btn-primary text-xs py-1 px-3 bg-indigo-650" onClick={() => handleSaveEdit(item.id)}>Guardar</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-xs text-slate-500">Este gasto está en $0 y se copiará al próximo mes.</span>
                            <div className="flex gap-3">
                              <button className="text-xs flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors" onClick={() => handleStartEdit(item)}>
                                <Edit2 size={12} /> Presupuestar
                              </button>
                              <button className="text-xs flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors" onClick={() => {
                                if (window.confirm('¿Seguro que deseas eliminar este gasto del plan del mes?')) {
                                  deleteItem.mutate(item.id)
                                }
                              }}>
                                <Trash2 size={12} /> Eliminar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
