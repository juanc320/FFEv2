import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useAuth } from '@/features/auth/AuthContext'
import { Plus, RefreshCw, Trash2, ChevronDown, Check } from 'lucide-react'
import type { Category, Concept } from '@/shared/types/database'
import { formatCOP } from '@/shared/utils/calculations'
import { CurrencyInput } from '@/shared/components/CurrencyInput'
import { syncPeriodicExpenses, syncPeriodicIncomes } from '@/shared/utils/periodicSync'
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

const CRITICALITY_LABELS = { 
  critical: 'Crítico', 
  necessary: 'Necesario', 
  desirable: 'Deseable', 
  optional: 'Opcional' 
}

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const now = new Date()

const EMPTY_FORM = {
  label: '',
  category_id: '',
  concept_id: '',
  member_id: '',
  amount: 0,
  periodicity: 'annual' as 'quarterly' | 'semi_annual' | 'annual',
  start_month: now.getMonth() + 1,
  start_year: now.getFullYear(),
  criticality: 'necessary' as 'critical' | 'necessary' | 'desirable' | 'optional',
  due_day: '' as number | '',
}

/** Calcula los próximos meses en los que vence este ítem periódico */
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
  const [activeTab, setActiveTab] = useState<'expenses' | 'incomes'>('expenses')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})

  // Estados para creación rápida de categorías
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [showEditNewCategoryInput, setShowEditNewCategoryInput] = useState<Record<string, boolean>>({})
  const [editNewCategoryName, setEditNewCategoryName] = useState<Record<string, string>>({})

  // Estados para creación rápida de conceptos
  const [showNewConceptInput, setShowNewConceptInput] = useState(false)
  const [newConceptName, setNewConceptName] = useState('')
  const [showEditNewConceptInput, setShowEditNewConceptInput] = useState<Record<string, boolean>>({})
  const [editNewConceptName, setEditNewConceptName] = useState<Record<string, string>>({})

  // Sincronización automática al montar
  useEffect(() => {
    if (profile?.family_id) {
      Promise.all([
        syncPeriodicExpenses(profile.family_id),
        syncPeriodicIncomes(profile.family_id)
      ]).then(() => {
        qc.invalidateQueries({ queryKey: ['expense_items'] })
        qc.invalidateQueries({ queryKey: ['income_items'] })
      })
    }
  }, [profile?.family_id, qc])

  // Reset de formularios al cambiar de pestaña
  useEffect(() => {
    setShowForm(false)
    setExpandedId(null)
    setForm(EMPTY_FORM)
    setShowNewCategoryInput(false)
    setNewCategoryName('')
    setShowNewConceptInput(false)
    setNewConceptName('')
  }, [activeTab])

  // Queries
  const { data: expenses = [], isLoading: loadingExpenses } = useQuery({
    queryKey: ['periodic_expenses', profile?.family_id],
    queryFn: async () => {
      const { data } = await supabase.from('periodic_expenses').select('*').eq('family_id', profile!.family_id!).eq('active', true).order('amount', { ascending: false })
      return (data ?? []) as any[]
    },
    enabled: !!profile?.family_id,
  })

  const { data: incomes = [], isLoading: loadingIncomes } = useQuery({
    queryKey: ['periodic_incomes', profile?.family_id],
    queryFn: async () => {
      const { data } = await supabase.from('periodic_incomes').select('*').eq('family_id', profile!.family_id!).eq('active', true).order('amount', { ascending: false })
      return (data ?? []) as any[]
    },
    enabled: !!profile?.family_id,
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', profile?.family_id],
    queryFn: async () => { 
      const { data } = await supabase.from('categories').select('*').eq('family_id', profile!.family_id!).eq('active', true).order('name')
      return (data ?? []) as Category[] 
    },
    enabled: !!profile?.family_id,
  })

  const { data: concepts = [] } = useQuery({
    queryKey: ['concepts', profile?.family_id],
    queryFn: async () => { 
      const { data } = await supabase.from('concepts').select('*').eq('family_id', profile!.family_id!).eq('active', true).order('name')
      return (data ?? []) as Concept[] 
    },
    enabled: !!profile?.family_id,
  })

  const { data: familyMembers = [] } = useQuery({
    queryKey: ['family_members', profile?.family_id],
    queryFn: async () => {
      const { data } = await supabase.from('family_members').select('*').eq('family_id', profile!.family_id!).eq('active', true).order('name')
      return (data ?? []) as any[]
    },
    enabled: !!profile?.family_id,
  })

  // Filter categories and concepts based on activeTab
  const activeCategories = useMemo(() => {
    return categories.filter(c => c.type === (activeTab === 'expenses' ? 'expense' : 'income'))
  }, [categories, activeTab])

  const filteredConcepts = concepts.filter(c => c.category_id === form.category_id)

  const items = activeTab === 'expenses' ? expenses : incomes
  const isLoading = activeTab === 'expenses' ? loadingExpenses : loadingIncomes

  // Mutations
  const createItem = useMutation({
    mutationFn: async () => {
      let finalCategoryId = form.category_id
      let finalConceptId = form.concept_id

      // 1. Crear categoría rápida si es necesario
      if (showNewCategoryInput && newCategoryName.trim()) {
        const { data: newCat, error: catErr } = await db
          .from('categories')
          .insert({
            family_id: profile!.family_id!,
            name: newCategoryName.trim(),
            type: activeTab === 'expenses' ? 'expense' : 'income',
            active: true
          })
          .select()
          .single()
        
        if (catErr) throw catErr
        finalCategoryId = newCat.id
      }

      // 2. Crear concepto rápido si es necesario
      if (showNewConceptInput && newConceptName.trim()) {
        const { data: newConcept, error: conErr } = await db
          .from('concepts')
          .insert({
            family_id: profile!.family_id!,
            category_id: finalCategoryId,
            name: newConceptName.trim(),
            active: true
          })
          .select()
          .single()
        
        if (conErr) throw conErr
        finalConceptId = newConcept.id
      }

      if (activeTab === 'expenses') {
        // Gasto periódico
        await db.from('periodic_expenses').insert({
          family_id: profile!.family_id!,
          label: form.label.trim(),
          category_id: finalCategoryId || null,
          concept_id: finalConceptId || null,
          amount: form.amount,
          periodicity: form.periodicity,
          start_month: form.start_month,
          start_year: form.start_year,
          criticality: form.criticality,
          due_day: form.due_day || null,
          active: true,
        })
        await syncPeriodicExpenses(profile!.family_id!)
      } else {
        // Ingreso periódico
        await db.from('periodic_incomes').insert({
          family_id: profile!.family_id!,
          member_id: form.member_id || null,
          concept_id: finalConceptId || null,
          label: form.label.trim(),
          amount: form.amount,
          periodicity: form.periodicity,
          start_month: form.start_month,
          start_year: form.start_year,
          due_day: form.due_day || null,
          active: true,
        })
        await syncPeriodicIncomes(profile!.family_id!)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [activeTab === 'expenses' ? 'periodic_expenses' : 'periodic_incomes'] })
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['concepts'] })
      qc.invalidateQueries({ queryKey: [activeTab === 'expenses' ? 'expense_items' : 'income_items'] })
      setShowForm(false)
      setForm(EMPTY_FORM)
      setShowNewCategoryInput(false)
      setNewCategoryName('')
      setShowNewConceptInput(false)
      setNewConceptName('')
    },
  })

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      if (activeTab === 'expenses') {
        await db.from('periodic_expenses').update({ active: false }).eq('id', id)
        await syncPeriodicExpenses(profile!.family_id!)
      } else {
        await db.from('periodic_incomes').update({ active: false }).eq('id', id)
        await syncPeriodicIncomes(profile!.family_id!)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [activeTab === 'expenses' ? 'periodic_expenses' : 'periodic_incomes'] })
      qc.invalidateQueries({ queryKey: [activeTab === 'expenses' ? 'expense_items' : 'income_items'] })
      setExpandedId(null)
    },
  })

  const updateItem = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      let finalCategoryId = data.category_id
      let finalConceptId = data.concept_id

      // 1. Crear categoría rápida si es necesario
      if (showEditNewCategoryInput[id] && editNewCategoryName[id]?.trim()) {
        const { data: newCat, error: catErr } = await db
          .from('categories')
          .insert({
            family_id: profile!.family_id!,
            name: editNewCategoryName[id].trim(),
            type: activeTab === 'expenses' ? 'expense' : 'income',
            active: true
          })
          .select()
          .single()
        
        if (catErr) throw catErr
        finalCategoryId = newCat.id
      }

      // 2. Crear concepto rápido si es necesario
      if (showEditNewConceptInput[id] && editNewConceptName[id]?.trim()) {
        const { data: newConcept, error: conErr } = await db
          .from('concepts')
          .insert({
            family_id: profile!.family_id!,
            category_id: finalCategoryId,
            name: editNewConceptName[id].trim(),
            active: true
          })
          .select()
          .single()
        
        if (conErr) throw conErr
        finalConceptId = newConcept.id
      }

      if (activeTab === 'expenses') {
        await db.from('periodic_expenses').update({
          label: data.label,
          category_id: finalCategoryId || null,
          concept_id: finalConceptId || null,
          amount: data.amount,
          periodicity: data.periodicity,
          start_month: data.start_month,
          start_year: data.start_year,
          criticality: data.criticality,
          due_day: data.due_day || null,
        }).eq('id', id)
        await syncPeriodicExpenses(profile!.family_id!)
      } else {
        await db.from('periodic_incomes').update({
          label: data.label,
          member_id: data.member_id || null,
          concept_id: finalConceptId || null,
          amount: data.amount,
          periodicity: data.periodicity,
          start_month: data.start_month,
          start_year: data.start_year,
          due_day: data.due_day || null,
        }).eq('id', id)
        await syncPeriodicIncomes(profile!.family_id!)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [activeTab === 'expenses' ? 'periodic_expenses' : 'periodic_incomes'] })
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['concepts'] })
      qc.invalidateQueries({ queryKey: [activeTab === 'expenses' ? 'expense_items' : 'income_items'] })
      setExpandedId(null)
      setEditNewCategoryName({})
      setShowEditNewCategoryInput({})
      setEditNewConceptName({})
      setShowEditNewConceptInput({})
    },
  })

  // KPIs calculations
  const totalAnnual = useMemo(() => {
    return items.reduce((s: number, i: any) => {
      const mult = i.periodicity === 'quarterly' ? 4 : i.periodicity === 'semi_annual' ? 2 : 1
      return s + i.amount * mult
    }, 0)
  }, [items])

  const totalMonthlyAvg = Math.round(totalAnnual / 12)

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Frecuentes / Periódicos</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Administra tus ingresos y gastos que ocurren de forma trimestral, semestral o anual
          </p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => setShowForm(true)}>
          <Plus size={16} /> {activeTab === 'expenses' ? 'Nuevo gasto' : 'Nuevo ingreso'}
        </button>
      </div>

      {/* Tabs Menu */}
      <div className="flex border-b border-slate-800 gap-6 mt-2">
        <button
          onClick={() => setActiveTab('expenses')}
          className={clsx(
            'pb-3 text-sm font-semibold transition-all relative flex items-center gap-2',
            activeTab === 'expenses' ? 'text-indigo-400' : 'text-slate-400 hover:text-slate-200'
          )}
        >
          Gastos periódicos
          <span className="text-xs px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
            {expenses.length}
          </span>
          {activeTab === 'expenses' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('incomes')}
          className={clsx(
            'pb-3 text-sm font-semibold transition-all relative flex items-center gap-2',
            activeTab === 'incomes' ? 'text-indigo-400' : 'text-slate-400 hover:text-slate-200'
          )}
        >
          Ingresos periódicos
          <span className="text-xs px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
            {incomes.length}
          </span>
          {activeTab === 'incomes' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />
          )}
        </button>
      </div>

      {/* Formulario */}
      {showForm && (
        <div className={clsx('card space-y-4 bg-slate-900/60', activeTab === 'expenses' ? 'border-violet-500/30' : 'border-emerald-500/30')}>
          <h2 className="text-white font-semibold">
            {activeTab === 'expenses' ? 'Nuevo Gasto Periódico' : 'Nuevo Ingreso Periódico'}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="label">Nombre</label>
              <input 
                className="input w-full" 
                placeholder={activeTab === 'expenses' ? "Ej: Soat Carro" : "Ej: Bono de desempeño"} 
                value={form.label} 
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))} 
              />
            </div>
            
            {activeTab === 'incomes' && (
              <div>
                <label className="label">Integrante familiar (opcional)</label>
                <select className="input w-full" value={form.member_id} onChange={e => setForm(f => ({ ...f, member_id: e.target.value }))}>
                  <option value="">Ninguno</option>
                  {familyMembers.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="label">Categoría</label>
              <select className="input w-full" value={showNewCategoryInput ? 'CREATE_NEW' : form.category_id} onChange={e => {
                if (e.target.value === 'CREATE_NEW') {
                  setShowNewCategoryInput(true)
                  setShowNewConceptInput(true)
                  setForm(f => ({ ...f, category_id: '', concept_id: '' }))
                } else {
                  setShowNewCategoryInput(false)
                  const catId = e.target.value
                  const matchingConcepts = concepts.filter(c => c.category_id === catId)
                  let nextConceptId = ''
                  if (matchingConcepts.length === 1) {
                    nextConceptId = matchingConcepts[0].id
                  }
                  setForm(f => ({ ...f, category_id: catId, concept_id: nextConceptId }))
                  setShowNewConceptInput(false)
                }
              }}>
                <option value="">Seleccionar categoría...</option>
                {activeCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="CREATE_NEW">+ Crear nueva categoría...</option>
              </select>
            </div>
            <div>
              <label className="label">Concepto</label>
              <select className="input w-full" value={form.concept_id} onChange={e => {
                if (e.target.value === 'CREATE_NEW') {
                  setShowNewConceptInput(true)
                  setForm(f => ({ ...f, concept_id: '' }))
                } else {
                  setShowNewConceptInput(false)
                  setForm(f => ({ ...f, concept_id: e.target.value }))
                }
              }} disabled={!form.category_id && !showNewCategoryInput}>
                <option value="">Seleccionar concepto...</option>
                {filteredConcepts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                {(form.category_id || showNewCategoryInput) && <option value="CREATE_NEW">+ Crear nuevo concepto...</option>}
              </select>
            </div>

            {/* Campo rápido para crear categoría */}
            {showNewCategoryInput && (
              <div className="sm:col-span-2">
                <label className="label text-indigo-400">Nombre de la nueva categoría</label>
                <input
                  className="input w-full border-indigo-500/50"
                  placeholder="Ej: Otros"
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                />
              </div>
            )}

            {/* Campo rápido para crear concepto */}
            {showNewConceptInput && (
              <div className="sm:col-span-2">
                <label className="label text-indigo-400">Nombre del nuevo concepto</label>
                <input
                  className="input w-full border-indigo-500/50"
                  placeholder="Ej: Impuesto"
                  value={newConceptName}
                  onChange={e => setNewConceptName(e.target.value)}
                />
              </div>
            )}

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
            {activeTab === 'expenses' ? (
              <div>
                <label className="label">Criticidad</label>
                <select className="input w-full" value={form.criticality} onChange={e => setForm(f => ({ ...f, criticality: e.target.value as any }))}>
                  {Object.entries(CRITICALITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            ) : (
              <div className="opacity-0 pointer-events-none" />
            )}
            <div>
              <label className="label">Día del mes esperado (opcional)</label>
              <input type="number" min={1} max={31} className="input w-full" placeholder="Ej: 15" value={form.due_day} onChange={e => setForm(f => ({ ...f, due_day: e.target.value ? Number(e.target.value) : '' }))} />
            </div>
          </div>

          {/* Preview de próximas fechas */}
          {form.amount > 0 && (
            <div className={clsx('border rounded-xl px-4 py-3 space-y-1', activeTab === 'expenses' ? 'bg-violet-500/10 border-violet-500/20' : 'bg-emerald-500/10 border-emerald-500/20')}>
              <p className={clsx('text-xs font-medium uppercase tracking-wide', activeTab === 'expenses' ? 'text-violet-300' : 'text-emerald-300')}>Próximas fechas estimadas</p>
              <div className="flex gap-3 flex-wrap mt-1">
                {getNextDueDates(form.start_month, form.start_year, form.periodicity).map(d => (
                  <span key={d} className={clsx('text-xs px-2 py-1 rounded border', activeTab === 'expenses' ? 'bg-violet-500/20 text-violet-300 border-violet-500/30' : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30')}>{d} · {formatCOP(form.amount)}</span>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancelar</button>
            <button
              className="btn-primary"
              disabled={
                !form.label.trim() ||
                (!form.category_id && (!showNewCategoryInput || !newCategoryName.trim())) ||
                (!form.concept_id && (!showNewConceptInput || !newConceptName.trim())) ||
                form.amount <= 0 ||
                createItem.isPending
              }
              onClick={() => createItem.mutate()}
            >
              {createItem.isPending ? 'Guardando...' : activeTab === 'expenses' ? 'Agregar gasto periódico' : 'Agregar ingreso periódico'}
            </button>
          </div>
        </div>
      )}

      {/* Info de inyección automática */}
      <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-4 py-3 flex gap-3">
        <RefreshCw size={16} className="text-indigo-400 flex-shrink-0 mt-0.5" />
        <p className="text-indigo-300 text-sm">
          <span className="font-medium">Inyección automática:</span> Cuando crees un nuevo mes o edites tus periódicos, el sistema detectará automáticamente cuáles corresponden a ese mes y los sincronizará en tu Plan de {activeTab === 'expenses' ? 'gastos' : 'ingresos'} como tipo <span className="font-medium">Esporádico</span>.
        </p>
      </div>

      {/* Lista */}
      {isLoading && <div className="card text-center text-slate-500 py-8">Cargando...</div>}
      {!isLoading && items.length === 0 && (
        <div className="card text-center py-10 space-y-2">
          <RefreshCw className="text-slate-600 mx-auto" size={36} />
          <p className="text-slate-400 font-medium">Sin {activeTab === 'expenses' ? 'gastos' : 'ingresos'} periódicos</p>
          <p className="text-slate-500 text-sm">Agrega los ítems frecuentes que no son mensuales (e.g. seguros anuales, primas semestrales).</p>
        </div>
      )}
      <div className="space-y-3">
        {items.map((item: any) => {
          const nextDates = getNextDueDates(item.start_month, item.start_year, item.periodicity, 2)
          const mult = item.periodicity === 'quarterly' ? 4 : item.periodicity === 'semi_annual' ? 2 : 1
          const annualCost = item.amount * mult
          const badgeColor = activeTab === 'expenses' ? PERIODICITY_BADGE[item.periodicity as keyof typeof PERIODICITY_BADGE] : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'

          return (
            <div key={item.id} className="card p-0 overflow-hidden bg-slate-900/30 border-slate-850">
              {/* Header del card */}
              <div
                className="flex items-center gap-4 px-4 py-3.5 cursor-pointer hover:bg-slate-800/35 transition-colors"
                onClick={() => {
                  if (expandedId !== item.id) {
                    const mappedCategory = concepts.find(c => c.id === item.concept_id)?.category_id || ''
                    setEditForm({
                      label: item.label,
                      member_id: item.member_id || '',
                      category_id: mappedCategory,
                      concept_id: item.concept_id || '',
                      amount: item.amount,
                      periodicity: item.periodicity,
                      start_month: item.start_month,
                      start_year: item.start_year,
                      criticality: item.criticality || 'necessary',
                      due_day: item.due_day || '',
                    })
                  }
                  setExpandedId(expandedId === item.id ? null : item.id)
                }}
              >
                <div className={clsx('flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center border', badgeColor)}>
                  <RefreshCw size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-slate-200 text-sm font-medium">{item.label}</p>
                    <span className={clsx('text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wider', badgeColor)}>
                      {item.periodicity === 'quarterly' ? 'Trimestral' : item.periodicity === 'semi_annual' ? 'Semestral' : 'Anual'}
                    </span>
                    {activeTab === 'incomes' && item.member_id && (() => {
                      const memberName = familyMembers.find((m: any) => m.id === item.member_id)?.name
                      return memberName ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-slate-800 bg-slate-800/25 text-slate-400 font-medium">
                          {memberName}
                        </span>
                      ) : null
                    })()}
                  </div>
                  <p className="text-slate-500 text-xs mt-0.5">
                    Próx: {nextDates[0]} · {formatCOP(annualCost)}/año
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={clsx('font-semibold text-sm', activeTab === 'expenses' ? 'text-white' : 'text-emerald-400')}>{formatCOP(item.amount)}</p>
                  <p className="text-slate-500 text-xs">por pago</p>
                </div>
                <ChevronDown size={15} className={clsx('text-slate-500 transition-transform flex-shrink-0', expandedId === item.id && 'rotate-180')} />
              </div>

              {/* Panel de edición */}
              {expandedId === item.id && (
                <div className="border-t border-slate-800 px-4 py-4 bg-slate-950/40 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label className="label">Nombre</label>
                      <input className="input w-full" value={editForm.label || ''} onChange={e => setEditForm(f => ({ ...f, label: e.target.value }))} />
                    </div>

                    {activeTab === 'incomes' && (
                      <div>
                        <label className="label">Integrante familiar (opcional)</label>
                        <select className="input w-full" value={editForm.member_id || ''} onChange={e => setEditForm(f => ({ ...f, member_id: e.target.value }))}>
                          <option value="">Ninguno</option>
                          {familyMembers.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                      </div>
                    )}

                    <div>
                      <label className="label">Categoría</label>
                      <select className="input w-full" value={showEditNewCategoryInput[item.id] ? 'CREATE_NEW' : (editForm.category_id || '')} onChange={e => {
                        if (e.target.value === 'CREATE_NEW') {
                          setShowEditNewCategoryInput(prev => ({ ...prev, [item.id]: true }))
                          setShowEditNewConceptInput(prev => ({ ...prev, [item.id]: true }))
                          setEditForm(f => ({ ...f, category_id: '', concept_id: '' }))
                        } else {
                          setShowEditNewCategoryInput(prev => ({ ...prev, [item.id]: false }))
                          const catId = e.target.value
                          const matchingConcepts = concepts.filter(c => c.category_id === catId)
                          let nextConceptId = ''
                          if (matchingConcepts.length === 1) {
                            nextConceptId = matchingConcepts[0].id
                          }
                          setEditForm(f => ({ ...f, category_id: catId, concept_id: nextConceptId }))
                          setShowEditNewConceptInput(prev => ({ ...prev, [item.id]: false }))
                        }
                      }}>
                        <option value="">Seleccionar categoría...</option>
                        {activeCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        <option value="CREATE_NEW">+ Crear nueva categoría...</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Concepto</label>
                      <select className="input w-full" value={showEditNewConceptInput[item.id] ? 'CREATE_NEW' : (editForm.concept_id || '')} onChange={e => {
                        if (e.target.value === 'CREATE_NEW') {
                          setShowEditNewConceptInput(prev => ({ ...prev, [item.id]: true }))
                          setEditForm(f => ({ ...f, concept_id: '' }))
                        } else {
                          setShowEditNewConceptInput(prev => ({ ...prev, [item.id]: false }))
                          setEditForm(f => ({ ...f, concept_id: e.target.value }))
                        }
                      }} disabled={!editForm.category_id && !showEditNewCategoryInput[item.id]}>
                        <option value="">Seleccionar concepto...</option>
                        {concepts.filter(c => c.category_id === editForm.category_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        {(editForm.category_id || showEditNewCategoryInput[item.id]) && <option value="CREATE_NEW">+ Crear nuevo concepto...</option>}
                      </select>
                    </div>

                    {/* Campo rápido para crear categoría en edición */}
                    {showEditNewCategoryInput[item.id] && (
                      <div className="sm:col-span-2">
                        <label className="label text-indigo-400">Nombre de la nueva categoría</label>
                        <input
                          className="input w-full border-indigo-500/50"
                          placeholder="Ej: Otros"
                          value={editNewCategoryName[item.id] || ''}
                          onChange={e => setEditNewCategoryName(prev => ({ ...prev, [item.id]: e.target.value }))}
                        />
                      </div>
                    )}

                    {/* Campo rápido para crear concepto en edición */}
                    {showEditNewConceptInput[item.id] && (
                      <div className="sm:col-span-2">
                        <label className="label text-indigo-400">Nombre del nuevo concepto</label>
                        <input
                          className="input w-full border-indigo-500/50"
                          placeholder="Ej: Impuesto"
                          value={editNewConceptName[item.id] || ''}
                          onChange={e => setEditNewConceptName(prev => ({ ...prev, [item.id]: e.target.value }))}
                        />
                      </div>
                    )}

                    <div>
                      <label className="label">Monto</label>
                      <CurrencyInput className="input w-full" value={editForm.amount || 0} onChange={val => setEditForm(f => ({ ...f, amount: val }))} />
                    </div>
                    <div>
                      <label className="label">Periodicidad</label>
                      <select className="input w-full" value={editForm.periodicity || 'annual'} onChange={e => setEditForm(f => ({ ...f, periodicity: e.target.value }))}>
                        <option value="quarterly">Trimestral</option>
                        <option value="semi_annual">Semestral</option>
                        <option value="annual">Anual</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Mes de inicio</label>
                      <div className="grid grid-cols-2 gap-2">
                        <select className="input w-full" value={editForm.start_month || 1} onChange={e => setEditForm(f => ({ ...f, start_month: Number(e.target.value) }))}>
                          {MONTH_NAMES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                        </select>
                        <select className="input w-full" value={editForm.start_year || now.getFullYear()} onChange={e => setEditForm(f => ({ ...f, start_year: Number(e.target.value) }))}>
                          {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                      </div>
                    </div>
                    {activeTab === 'expenses' ? (
                      <div>
                        <label className="label">Criticidad</label>
                        <select className="input w-full" value={editForm.criticality || 'necessary'} onChange={e => setEditForm(f => ({ ...f, criticality: e.target.value }))}>
                          {Object.entries(CRITICALITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                    ) : (
                      <div className="opacity-0 pointer-events-none" />
                    )}
                    <div>
                      <label className="label">Día del mes (opcional)</label>
                      <input type="number" min={1} max={31} className="input w-full" placeholder="Ej: 15" value={editForm.due_day || ''} onChange={e => setEditForm(f => ({ ...f, due_day: e.target.value ? Number(e.target.value) : '' }))} />
                    </div>
                  </div>
                  <div className="flex justify-between items-center pt-1 mt-2 border-t border-slate-800/40">
                    <button
                      className="text-xs flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors"
                      onClick={() => { if (confirm(`¿Eliminar "${item.label}"?`)) deleteItem.mutate(item.id) }}
                    >
                      <Trash2 size={13} /> Eliminar
                    </button>
                    <div className="flex gap-2">
                      <button className="btn-ghost text-sm py-1.5 px-3" onClick={() => setExpandedId(null)}>Cancelar</button>
                      <button
                        className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1"
                        disabled={
                          !editForm.label?.trim() ||
                          (!editForm.category_id && (!showEditNewCategoryInput[item.id] || !(editNewCategoryName[item.id]?.trim()))) ||
                          (!editForm.concept_id && (!showEditNewConceptInput[item.id] || !(editNewConceptName[item.id]?.trim()))) ||
                          (editForm.amount || 0) <= 0 ||
                          updateItem.isPending
                        }
                        onClick={() => updateItem.mutate({ id: item.id, data: editForm })}
                      >
                        <Check size={13} /> {updateItem.isPending ? 'Guardando...' : 'Guardar'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {items.length > 0 && (
        <div className="card bg-slate-800/30 border-slate-700/30 flex items-center justify-between">
          <div>
            <p className="text-slate-400 text-sm">{activeTab === 'expenses' ? 'Costo' : 'Ingreso'} anual proyectado</p>
            <p className="text-white font-bold text-lg">{formatCOP(totalAnnual)}</p>
          </div>
          <div className="text-right">
            <p className="text-slate-400 text-sm">Promedio mensual</p>
            <p className={clsx('font-semibold', activeTab === 'expenses' ? 'text-indigo-400' : 'text-emerald-400')}>{formatCOP(totalMonthlyAvg)}</p>
          </div>
        </div>
      )}
    </div>
  )
}
