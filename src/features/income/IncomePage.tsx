import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useAuth } from '@/features/auth/AuthContext'
import { useActiveMonth } from '@/features/months/MonthsPage'
import type { MonthlyIncomeItem, DeductionType, Account } from '@/shared/types/database'
import { formatCOP, calcNetIncome } from '@/shared/utils/calculations'
import { Plus, TrendingUp, AlertTriangle, CheckCircle, Clock, Pencil, Trash2, ChevronDown, RefreshCw } from 'lucide-react'
import clsx from 'clsx'
import { CurrencyInput } from '@/shared/components/CurrencyInput'
import { syncPeriodicIncomes } from '@/shared/utils/periodicSync'

const DEDUCTION_PRESETS = [
  { label: '8%', rate: 0.08 },
  { label: '13.5%', rate: 0.135 },
]

function useIncomeItems() {
  const { data: activeMonth } = useActiveMonth()
  return useQuery({
    queryKey: ['income_items', activeMonth?.id],
    queryFn: async (): Promise<MonthlyIncomeItem[]> => {
      const { data } = await supabase.from('monthly_income_items').select('*').eq('month_id', activeMonth!.id).order('expected_date')
      return (data ?? []) as MonthlyIncomeItem[]
    },
    enabled: !!activeMonth?.id,
  })
}

function useAccounts() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['accounts', profile?.family_id],
    queryFn: async (): Promise<Account[]> => {
      const { data } = await supabase.from('accounts').select('*').eq('family_id', profile!.family_id!).eq('active', true)
      return (data ?? []) as Account[]
    },
    enabled: !!profile?.family_id,
  })
}

interface IncomeForm {
  label: string
  gross_amount: number
  deduction_type: DeductionType
  deduction_rate: number
  deduction_amount: number
  expected_date: string
  is_recurring: boolean
  income_type: 'fixed' | 'sporadic'
}

const EMPTY_FORM: IncomeForm = {
  label: '',
  gross_amount: 0,
  deduction_type: 'none',
  deduction_rate: 0,
  deduction_amount: 0,
  expected_date: '',
  is_recurring: false,
  income_type: 'fixed',
}

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const EMPTY_PERIODIC_FORM = {
  label: '',
  amount: 0,
  periodicity: 'annual' as 'quarterly' | 'semi_annual' | 'annual',
  member_id: '',
  start_month: new Date().getMonth() + 1,
  start_year: new Date().getFullYear(),
  due_day: '' as number | '',
}

const PERIODICITY_LABELS = {
  quarterly: 'Trimestral (cada 3 meses)',
  semi_annual: 'Semestral (cada 6 meses)',
  annual: 'Anual (cada 12 meses)',
}

function getNextDueDates(startMonth: number, startYear: number, periodicity: string, count = 3): string[] {
  const intervalMonths = periodicity === 'quarterly' ? 3 : periodicity === 'semi_annual' ? 6 : 12
  const result: string[] = []
  let m = startMonth
  let y = startYear
  const now = new Date()
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

export default function IncomePage() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const { data: activeMonth } = useActiveMonth()
  const { data: items = [], isLoading } = useIncomeItems()
  const { data: accounts = [] } = useAccounts()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingItem, setEditingItem] = useState<MonthlyIncomeItem | null>(null)

  // Tab state: 'current_month' (ingresos del mes activo) o 'templates' (plantillas periódicas)
  const [activeTab, setActiveTab] = useState<'current_month' | 'templates'>(() => {
    return (localStorage.getItem('ffev2_incomes_tab') as 'current_month' | 'templates') || 'current_month'
  })

  const [showPeriodicForm, setShowPeriodicForm] = useState(false)
  const [periodicForm, setPeriodicForm] = useState(EMPTY_PERIODIC_FORM)
  const [editingPeriodicId, setEditingPeriodicId] = useState<string | null>(null)
  const [expandedPeriodicId, setExpandedPeriodicId] = useState<string | null>(null)
  const [editPeriodicForm, setEditPeriodicForm] = useState<Record<string, any>>({})

  // Reset form when activeTab changes
  useEffect(() => {
    setShowForm(false)
    setEditingItem(null)
    setForm(EMPTY_FORM)
    setShowPeriodicForm(false)
    setEditingPeriodicId(null)
    setExpandedPeriodicId(null)
    setPeriodicForm(EMPTY_PERIODIC_FORM)
  }, [activeTab])

  const handleTabChange = (tab: 'current_month' | 'templates') => {
    setActiveTab(tab)
    localStorage.setItem('ffev2_incomes_tab', tab)
  }

  const { data: periodicIncomes = [] } = useQuery({
    queryKey: ['periodic_incomes', profile?.family_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('periodic_incomes')
        .select('*')
        .eq('family_id', profile!.family_id!)
        .eq('active', true)
        .order('amount', { ascending: false })
      return (data ?? []) as any[]
    },
    enabled: !!profile?.family_id,
  })

  const { data: familyMembers = [] } = useQuery({
    queryKey: ['family_members', profile?.family_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('family_members')
        .select('*')
        .eq('family_id', profile!.family_id!)
        .eq('active', true)
        .order('name')
      return (data ?? []) as any[]
    },
    enabled: !!profile?.family_id,
  })

  useEffect(() => {
    if (profile?.family_id) {
      syncPeriodicIncomes(profile.family_id).then(() => {
        qc.invalidateQueries({ queryKey: ['income_items'] })
      })
    }
  }, [profile?.family_id, qc])

  const periodicLabelsMap = useMemo(() => {
    if (!activeMonth || periodicIncomes.length === 0 || items.length === 0) return new Map<string, string>()
    const map = new Map<string, string>()
    const { year, month } = activeMonth

    const periodicToInject = periodicIncomes.filter((p: any) => {
      const intervalMonths = p.periodicity === 'quarterly' ? 3 : p.periodicity === 'semi_annual' ? 6 : 12
      const diffMonths = (year - p.start_year) * 12 + (month - p.start_month)
      return diffMonths >= 0 && diffMonths % intervalMonths === 0
    })

    const periodicByGroup: Record<string, any[]> = {}
    for (const p of periodicToInject) {
      const key = p.concept_id || `label:${p.label}`
      if (!periodicByGroup[key]) periodicByGroup[key] = []
      periodicByGroup[key].push(p)
    }

    const sporadicItems = items.filter(item => item.income_type === 'sporadic')
    const existingByGroup: Record<string, any[]> = {}
    for (const item of sporadicItems) {
      const key = item.concept_id || `label:${item.label}`
      if (!existingByGroup[key]) existingByGroup[key] = []
      existingByGroup[key].push(item)
    }

    for (const groupKey of Object.keys(existingByGroup)) {
      const E_g = existingByGroup[groupKey] || []
      const P_g = periodicByGroup[groupKey] || []
      for (let i = 0; i < E_g.length; i++) {
        const item = E_g[i]
        const p = P_g[i]
        if (item && p) {
          map.set(item.id, p.label)
        }
      }
    }
    return map
  }, [activeMonth, periodicIncomes, items])

  // Filter items based on activeTab
  const filteredItems = useMemo(() => {
    if (activeTab === 'current_month') return items
    return []
  }, [items, activeTab])

  const netPreview = calcNetIncome(form.gross_amount, form.deduction_type, form.deduction_rate, form.deduction_amount)

  const createItem = useMutation({
    mutationFn: async () => {
      await db.from('monthly_income_items').insert({
        month_id: activeMonth!.id,
        family_id: profile!.family_id!,
        label: form.label,
        gross_amount: form.gross_amount,
        deduction_type: form.deduction_type,
        deduction_rate: form.deduction_rate,
        deduction_amount: form.deduction_amount,
        expected_date: form.expected_date || null,
        received_amount: 0,
        status: 'pending',
        is_recurring: form.income_type === 'fixed' ? form.is_recurring : false,
        income_type: form.income_type,
      })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['income_items'] }); setShowForm(false); setForm(EMPTY_FORM) },
  })

  // Mutations for periodic incomes (templates)
  const createPeriodicIncome = useMutation({
    mutationFn: async () => {
      await db.from('periodic_incomes').insert({
        family_id: profile!.family_id!,
        member_id: periodicForm.member_id || null,
        label: periodicForm.label.trim(),
        amount: periodicForm.amount,
        periodicity: periodicForm.periodicity,
        start_month: periodicForm.start_month,
        start_year: periodicForm.start_year,
        due_day: periodicForm.due_day || null,
        active: true,
      })
      await syncPeriodicIncomes(profile!.family_id!)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['periodic_incomes'] })
      qc.invalidateQueries({ queryKey: ['income_items'] })
      setShowPeriodicForm(false)
      setPeriodicForm(EMPTY_PERIODIC_FORM)
    },
  })

  const updatePeriodicIncome = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      await db.from('periodic_incomes').update({
        label: data.label.trim(),
        member_id: data.member_id || null,
        amount: data.amount,
        periodicity: data.periodicity,
        start_month: data.start_month,
        start_year: data.start_year,
        due_day: data.due_day || null,
      }).eq('id', id)
      await syncPeriodicIncomes(profile!.family_id!)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['periodic_incomes'] })
      qc.invalidateQueries({ queryKey: ['income_items'] })
      setExpandedPeriodicId(null)
    },
  })

  const deletePeriodicIncome = useMutation({
    mutationFn: async (id: string) => {
      await db.from('periodic_incomes').update({ active: false }).eq('id', id)
      await syncPeriodicIncomes(profile!.family_id!)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['periodic_incomes'] })
      qc.invalidateQueries({ queryKey: ['income_items'] })
      setExpandedPeriodicId(null)
    },
  })

  const updateItem = useMutation({
    mutationFn: async () => {
      const { error } = await db.from('monthly_income_items').update({
        label: form.label,
        gross_amount: form.gross_amount,
        deduction_type: form.deduction_type,
        deduction_rate: form.deduction_rate,
        deduction_amount: form.deduction_amount,
        expected_date: form.expected_date || null,
        is_recurring: form.income_type === 'fixed' ? form.is_recurring : false,
        income_type: form.income_type,
      }).eq('id', editingItem!.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['income_items'] })
      setShowForm(false)
      setEditingItem(null)
      setForm(EMPTY_FORM)
    }
  })

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      // Unlink any transactions pointing to this income item
      await db.from('transactions').update({ income_item_id: null }).eq('income_item_id', id)
      // Delete the income item
      const { error } = await db.from('monthly_income_items').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['income_items'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      setShowForm(false)
      setEditingItem(null)
      setForm(EMPTY_FORM)
    }
  })

  const handleEdit = (item: MonthlyIncomeItem) => {
    setEditingItem(item)
    setForm({
      label: item.label,
      gross_amount: item.gross_amount,
      deduction_type: item.deduction_type,
      deduction_rate: item.deduction_rate,
      deduction_amount: item.deduction_amount,
      expected_date: item.expected_date || '',
      is_recurring: item.is_recurring,
      income_type: item.income_type || 'fixed',
    })
    setShowForm(true)
  }

  const markReceived = useMutation({
    mutationFn: async ({ id, amount, netExpected, accountId, label }: { id: string; amount: number; netExpected: number; accountId: string; label: string }) => {
      // 1. Update income item received amount and status
      const status = amount >= netExpected ? 'received' : 'partial'
      await db.from('monthly_income_items').update({ received_amount: amount, status }).eq('id', id)

      // 2. Create income transaction in database
      const familyId = profile!.family_id!
      const userId = profile!.id
      const today = new Date().toISOString().split('T')[0]
      const { data: tx, error } = await db.from('transactions').insert({
        family_id: familyId,
        month_id: activeMonth!.id,
        type: 'income',
        amount: amount,
        tax_amount: 0,
        source_account_id: null,
        destination_account_id: accountId,
        income_item_id: id,
        date: today,
        note: `Ingreso recibido: ${label}`,
        created_by: userId,
        is_automatic: false,
      }).select().single()
      if (error) throw error

      // 3. Update destination account balance cache
      const destAcc = accounts.find(a => a.id === accountId)
      if (destAcc) {
        await db.from('accounts').update({
          current_balance_cached: (destAcc.current_balance_cached || 0) + amount
        }).eq('id', accountId)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['income_items'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
    },
  })
  const templatesCount = periodicIncomes.length

  const totalExpected = items.reduce((s, i) => s + i.net_expected, 0)
  const totalReceived = items.reduce((s, i) => s + i.received_amount, 0)

  const periodicProjectedAnnual = useMemo(() => {
    return periodicIncomes.reduce((s: number, i: any) => {
      const mult = i.periodicity === 'quarterly' ? 4 : i.periodicity === 'semi_annual' ? 2 : 1
      return s + (i.amount || 0) * mult
    }, 0)
  }, [periodicIncomes])

  const periodicMonthlyAvg = useMemo(() => periodicProjectedAnnual / 12, [periodicProjectedAnnual])

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
          <h1 className="text-2xl font-bold text-white">
            {activeTab === 'current_month' ? 'Ingresos del Mes' : 'Ingresos Periódicos'}
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {activeTab === 'templates' ? (
              <>
                Proyectado anual: <span className="text-emerald-400 font-semibold">{formatCOP(periodicProjectedAnnual)}</span>
                {' '}/ Promedio mensual: <span className="text-indigo-400 font-medium">{formatCOP(periodicMonthlyAvg)}</span>
              </>
            ) : (
              <>
                Recibido: <span className="text-emerald-400 font-semibold">{formatCOP(totalReceived)}</span>
                {' '}/ Esperado: <span className="text-indigo-400 font-medium">{formatCOP(totalExpected)}</span>
              </>
            )}
          </p>
        </div>
        {activeTab === 'templates' ? (
          <button className="btn-primary flex items-center gap-2" onClick={() => { setEditingPeriodicId(null); setPeriodicForm(EMPTY_PERIODIC_FORM); setShowPeriodicForm(true); }}>
            <Plus size={16} /> Nuevo periódico
          </button>
        ) : (
          <button className="btn-primary flex items-center gap-2" onClick={() => { setEditingItem(null); setForm(EMPTY_FORM); setShowForm(true); }}>
            <Plus size={16} /> Nuevo ingreso
          </button>
        )}
      </div>

      {/* Tabs Menu */}
      <div className="flex border-b border-slate-800 gap-6 mt-2">
        <button
          onClick={() => handleTabChange('current_month')}
          className={clsx(
            'pb-3 text-sm font-semibold transition-all relative flex items-center gap-2',
            activeTab === 'current_month' ? 'text-indigo-400' : 'text-slate-400 hover:text-slate-200'
          )}
        >
          Ingresos del Mes
          <span className="text-xs px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
            {items.length}
          </span>
          {activeTab === 'current_month' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />
          )}
        </button>
        <button
          onClick={() => handleTabChange('templates')}
          className={clsx(
            'pb-3 text-sm font-semibold transition-all relative flex items-center gap-2',
            activeTab === 'templates' ? 'text-indigo-400' : 'text-slate-400 hover:text-slate-200'
          )}
        >
          Ingresos Periódicos
          <span className="text-xs px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
            {templatesCount}
          </span>
          {activeTab === 'templates' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />
          )}
        </button>
      </div>

      {activeTab === 'current_month' && showForm && (
        <div className="card space-y-4 bg-slate-900/60 border-emerald-500/30">
          <h2 className="text-white font-semibold">
            {editingItem ? 'Editar ingreso esperado' : 'Nuevo ingreso esperado'}
          </h2>
          
          {/* Conceptos prediseñados rápidos (solo para creación de fijos) */}
          {!editingItem && form.income_type === 'fixed' && (
            <div className="space-y-1.5 p-3 rounded-xl bg-slate-900/30 border border-slate-800/40">
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Conceptos prediseñados rápidos</span>
              <div className="flex gap-2 flex-wrap mt-1">
                <button 
                  type="button" 
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800/40 text-slate-300 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
                  onClick={() => setForm(f => ({ ...f, label: 'Salario basico Juan', gross_amount: 3088000 }))}
                >
                  Salario Juan ($3.088.000)
                </button>
                <button 
                  type="button" 
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800/40 text-slate-300 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
                  onClick={() => setForm(f => ({ ...f, label: 'Salario basico Diana', gross_amount: 5808000 }))}
                >
                  Salario Diana ($5.808.000)
                </button>
                <button 
                  type="button" 
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800/40 text-slate-300 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
                  onClick={() => setForm(f => ({ ...f, label: 'Arriendo Argo', gross_amount: 1112500 }))}
                >
                  Arriendo Argo ($1.112.500)
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="label">Nombre / descripción</label>
              <input className="input w-full" placeholder={form.income_type === 'fixed' ? "Ej: Salario junio" : "Ej: Devolución de impuestos"} value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
            </div>
            <div>
              <label className="label">Tipo de ingreso</label>
              <select className="input w-full" value={form.income_type} onChange={e => setForm(f => ({ ...f, income_type: e.target.value as any }))}>
                <option value="fixed">Mensual / Fijo</option>
                <option value="sporadic">Esporádico / Ocasional</option>
              </select>
            </div>
            <div>
              <label className="label">Bruto</label>
              <CurrencyInput className="input w-full" value={form.gross_amount} onChange={val => setForm(f => ({ ...f, gross_amount: val }))} />
            </div>
            <div>
              <label className="label">Tipo de deducción</label>
              <select className="input w-full" value={form.deduction_type} onChange={e => setForm(f => ({ ...f, deduction_type: e.target.value as typeof form.deduction_type, deduction_rate: 0, deduction_amount: 0 }))}>
                <option value="none">Sin deducción</option>
                <option value="percent">Porcentaje</option>
                <option value="fixed">Monto fijo</option>
                <option value="both">Ambos</option>
              </select>
            </div>
            {(form.deduction_type === 'percent' || form.deduction_type === 'both') && (
              <div>
                <label className="label">% de deducción</label>
                <div className="flex gap-2">
                  <input type="number" min={0} max={100} step={0.1} className="input flex-1" placeholder="0" value={form.deduction_rate * 100} onChange={e => setForm(f => ({ ...f, deduction_rate: Number(e.target.value) / 100 }))} />
                  {DEDUCTION_PRESETS.map(p => (
                    <button key={p.label} type="button" className={clsx('px-3 py-2 rounded-xl text-xs font-medium border transition-all', form.deduction_rate === p.rate ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-slate-700 text-slate-400 hover:text-white hover:border-slate-600')} onClick={() => setForm(f => ({ ...f, deduction_rate: p.rate }))}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(form.deduction_type === 'fixed' || form.deduction_type === 'both') && (
              <div>
                <label className="label">Deducción fija</label>
                <CurrencyInput className="input w-full" value={form.deduction_amount} onChange={val => setForm(f => ({ ...f, deduction_amount: val }))} />
              </div>
            )}
            <div>
              <label className="label">Fecha esperada</label>
              <input type="date" className="input w-full" value={form.expected_date} onChange={e => setForm(f => ({ ...f, expected_date: e.target.value }))} />
            </div>
          </div>
          {/* Preview neto */}
          {form.gross_amount > 0 && form.deduction_type !== 'none' && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 flex items-center justify-between">
              <p className="text-emerald-300 text-sm">Neto estimado</p>
              <p className="text-emerald-400 font-bold text-lg">{formatCOP(netPreview)}</p>
            </div>
          )}
          {form.income_type === 'fixed' && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-indigo-500 rounded" checked={form.is_recurring} onChange={e => setForm(f => ({ ...f, is_recurring: e.target.checked }))} />
              <span className="text-slate-300 text-sm">Ingreso recurrente (se copiará al siguiente mes)</span>
            </label>
          )}
          <div className="flex gap-3 justify-between">
            <div>
              {editingItem && (
                <button
                  type="button"
                  className="btn-ghost border border-red-500/40 text-red-400 hover:bg-red-500/10 text-xs py-1.5 px-3 rounded-xl transition-all"
                  onClick={() => {
                    if (confirm('¿Estás seguro de que deseas eliminar este ingreso esperado? Las transacciones asociadas ya no estarán vinculadas.')) {
                      deleteItem.mutate(editingItem.id)
                    }
                  }}
                  disabled={deleteItem.isPending}
                >
                  {deleteItem.isPending ? 'Eliminando...' : 'Eliminar'}
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <button 
                type="button"
                className="btn-ghost" 
                onClick={() => {
                  setShowForm(false)
                  setEditingItem(null)
                  setForm(EMPTY_FORM)
                }}
              >
                Cancelar
              </button>
              <button 
                type="button"
                className="btn-primary" 
                disabled={!form.label.trim() || form.gross_amount <= 0 || createItem.isPending || updateItem.isPending} 
                onClick={() => {
                  if (editingItem) {
                    updateItem.mutate()
                  } else {
                    createItem.mutate()
                  }
                }}
              >
                {editingItem 
                  ? (updateItem.isPending ? 'Guardando...' : 'Guardar cambios') 
                  : (createItem.isPending ? 'Guardando...' : 'Agregar ingreso')}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'templates' && showPeriodicForm && (
        <div className="card space-y-4 bg-slate-900/60 border-emerald-500/30">
          <h2 className="text-white font-semibold">
            Nuevo ingreso periódico (Plantilla)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="label">Nombre / descripción</label>
              <input className="input w-full" placeholder="Ej: Bono trimestral" value={periodicForm.label} onChange={e => setPeriodicForm(f => ({ ...f, label: e.target.value }))} />
            </div>
            <div>
              <label className="label">Monto por pago</label>
              <CurrencyInput className="input w-full" value={periodicForm.amount} onChange={val => setPeriodicForm(f => ({ ...f, amount: val }))} />
            </div>
            <div>
              <label className="label">Periodicidad</label>
              <select className="input w-full" value={periodicForm.periodicity} onChange={e => setPeriodicForm(f => ({ ...f, periodicity: e.target.value as any }))}>
                <option value="quarterly">Trimestral (cada 3 meses)</option>
                <option value="semi_annual">Semestral (cada 6 meses)</option>
                <option value="annual">Anual (cada 12 meses)</option>
              </select>
            </div>
            <div>
              <label className="label">Integrante familiar (opcional)</label>
              <select className="input w-full" value={periodicForm.member_id} onChange={e => setPeriodicForm(f => ({ ...f, member_id: e.target.value }))}>
                <option value="">Ninguno</option>
                {familyMembers.map((m: any) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Mes de inicio</label>
              <select className="input w-full" value={periodicForm.start_month} onChange={e => setPeriodicForm(f => ({ ...f, start_month: Number(e.target.value) }))}>
                {MONTH_NAMES.map((name, idx) => (
                  <option key={name} value={idx + 1}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Año de inicio</label>
              <input type="number" className="input w-full" value={periodicForm.start_year} onChange={e => setPeriodicForm(f => ({ ...f, start_year: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="label">Día del mes (opcional)</label>
              <input type="number" min={1} max={31} className="input w-full" placeholder="Ej: 15" value={periodicForm.due_day} onChange={e => setPeriodicForm(f => ({ ...f, due_day: e.target.value ? Number(e.target.value) : '' }))} />
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <button type="button" className="btn-ghost" onClick={() => { setShowPeriodicForm(false); setPeriodicForm(EMPTY_PERIODIC_FORM); }}>
              Cancelar
            </button>
            <button type="button" className="btn-primary" disabled={!periodicForm.label.trim() || periodicForm.amount <= 0 || createPeriodicIncome.isPending} onClick={() => createPeriodicIncome.mutate()}>
              {createPeriodicIncome.isPending ? 'Guardando...' : 'Crear plantilla'}
            </button>
          </div>
        </div>
      )}

      {/* Listas según pestaña */}
      {activeTab !== 'templates' && (
        <>
          {isLoading && <div className="card text-center text-slate-500 py-8">Cargando...</div>}
          {!isLoading && filteredItems.length === 0 && (
            <div className="card text-center py-10 space-y-2">
              <TrendingUp className="text-emerald-400/40 mx-auto" size={36} />
              <p className="text-slate-400 font-medium">Sin ingresos registrados</p>
              <p className="text-slate-500 text-sm">Agrega los ingresos esperados de este mes.</p>
            </div>
          )}
          <div className="space-y-3">
            {filteredItems.map(item => {
              const displayName = periodicLabelsMap.get(item.id) || item.label
              return (
                <IncomeCard 
                  key={item.id} 
                  item={{ ...item, label: displayName }} 
                  internalAccounts={accounts.filter(a => a.is_internal)}
                  onMarkReceived={(amount, accountId) => markReceived.mutate({ id: item.id, amount, netExpected: item.net_expected, accountId, label: displayName })} 
                  onEdit={() => handleEdit({ ...item, label: displayName })}
                />
              )
            })}
          </div>
        </>
      )}

      {activeTab === 'templates' && (
        <div className="space-y-3">
          {isLoading && <div className="card text-center text-slate-500 py-8">Cargando...</div>}
          {!isLoading && periodicIncomes.length === 0 && (
            <div className="card text-center py-10 space-y-2">
              <TrendingUp className="text-emerald-400/40 mx-auto" size={36} />
              <p className="text-slate-400 font-medium">Sin plantillas de ingresos periódicos</p>
              <p className="text-slate-500 text-sm">Agrega ingresos que ocurran trimestral, semestral o anualmente.</p>
            </div>
          )}
          {!isLoading && periodicIncomes.map((item: any) => {
            const isExpanded = expandedPeriodicId === item.id
            const mult = item.periodicity === 'quarterly' ? 4 : item.periodicity === 'semi_annual' ? 2 : 1
            const annualCost = item.amount * mult
            const nextDates = getNextDueDates(item.start_month, item.start_year, item.periodicity)
            const badgeColor = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'

            return (
              <div key={item.id} className="card p-0 overflow-hidden bg-slate-900/30 border-slate-850">
                {/* Header del card */}
                <div
                  className="flex items-center gap-4 px-4 py-3.5 cursor-pointer hover:bg-slate-800/35 transition-colors"
                  onClick={() => {
                    if (!isExpanded) {
                      setEditPeriodicForm(prev => ({
                        ...prev,
                        [item.id]: {
                          label: item.label,
                          amount: item.amount,
                          periodicity: item.periodicity,
                          member_id: item.member_id || '',
                          start_month: item.start_month,
                          start_year: item.start_year,
                          due_day: item.due_day || '',
                        }
                      }))
                    }
                    setExpandedPeriodicId(isExpanded ? null : item.id)
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
                      {item.member_id && (() => {
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
                    <p className="font-semibold text-sm text-emerald-400">{formatCOP(item.amount)}</p>
                    <p className="text-slate-500 text-xs">por pago</p>
                  </div>
                  <ChevronDown size={15} className={clsx('text-slate-500 transition-transform flex-shrink-0', isExpanded && 'rotate-180')} />
                </div>

                {/* Panel de edición inline */}
                {isExpanded && editPeriodicForm[item.id] && (
                  <div className="border-t border-slate-800 px-4 py-4 bg-slate-950/40 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="sm:col-span-2">
                        <label className="label">Nombre</label>
                        <input
                          className="input w-full"
                          value={editPeriodicForm[item.id].label}
                          onChange={e => setEditPeriodicForm(prev => ({
                            ...prev,
                            [item.id]: { ...prev[item.id], label: e.target.value }
                          }))}
                        />
                      </div>
                      <div>
                        <label className="label">Monto por pago</label>
                        <CurrencyInput
                          className="input w-full"
                          value={editPeriodicForm[item.id].amount}
                          onChange={val => setEditPeriodicForm(prev => ({
                            ...prev,
                            [item.id]: { ...prev[item.id], amount: val }
                          }))}
                        />
                      </div>
                      <div>
                        <label className="label">Periodicidad</label>
                        <select
                          className="input w-full"
                          value={editPeriodicForm[item.id].periodicity}
                          onChange={e => setEditPeriodicForm(prev => ({
                            ...prev,
                            [item.id]: { ...prev[item.id], periodicity: e.target.value as any }
                          }))}
                        >
                          <option value="quarterly">Trimestral (cada 3 meses)</option>
                          <option value="semi_annual">Semestral (cada 6 meses)</option>
                          <option value="annual">Anual (cada 12 meses)</option>
                        </select>
                      </div>
                      <div>
                        <label className="label">Integrante familiar (opcional)</label>
                        <select
                          className="input w-full"
                          value={editPeriodicForm[item.id].member_id}
                          onChange={e => setEditPeriodicForm(prev => ({
                            ...prev,
                            [item.id]: { ...prev[item.id], member_id: e.target.value }
                          }))}
                        >
                          <option value="">Ninguno</option>
                          {familyMembers.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label">Mes de inicio</label>
                        <select
                          className="input w-full"
                          value={editPeriodicForm[item.id].start_month}
                          onChange={e => setEditPeriodicForm(prev => ({
                            ...prev,
                            [item.id]: { ...prev[item.id], start_month: Number(e.target.value) }
                          }))}
                        >
                          {MONTH_NAMES.map((name, idx) => (
                            <option key={name} value={idx + 1}>{name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="label">Año de inicio</label>
                        <input
                          type="number"
                          className="input w-full"
                          value={editPeriodicForm[item.id].start_year}
                          onChange={e => setEditPeriodicForm(prev => ({
                            ...prev,
                            [item.id]: { ...prev[item.id], start_year: Number(e.target.value) }
                          }))}
                        />
                      </div>
                      <div>
                        <label className="label">Día del mes (opcional)</label>
                        <input
                          type="number"
                          min={1}
                          max={31}
                          className="input w-full"
                          placeholder="Ej: 15"
                          value={editPeriodicForm[item.id].due_day}
                          onChange={e => setEditPeriodicForm(prev => ({
                            ...prev,
                            [item.id]: { ...prev[item.id], due_day: e.target.value ? Number(e.target.value) : '' }
                          }))}
                        />
                      </div>
                    </div>

                    <div className="flex justify-between items-center pt-1 mt-2 border-t border-slate-800/40">
                      <button
                        className="text-xs flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors"
                        onClick={() => { if (confirm(`¿Eliminar "${item.label}"?`)) deletePeriodicIncome.mutate(item.id) }}
                        disabled={deletePeriodicIncome.isPending}
                      >
                        <Trash2 size={13} />
                        Eliminar plantilla
                      </button>
                      <div className="flex gap-2">
                        <button
                          className="btn-ghost py-1 px-3 text-xs"
                          onClick={() => setExpandedPeriodicId(null)}
                        >
                          Cancelar
                        </button>
                        <button
                          className="btn-primary py-1 px-3 text-xs"
                          disabled={updatePeriodicIncome.isPending}
                          onClick={() => updatePeriodicIncome.mutate({ id: item.id, data: editPeriodicForm[item.id] })}
                        >
                          {updatePeriodicIncome.isPending ? 'Guardando...' : 'Guardar cambios'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function IncomeCard({ 
  item, 
  internalAccounts, 
  onMarkReceived,
  onEdit
}: { 
  item: MonthlyIncomeItem; 
  internalAccounts: Account[]; 
  onMarkReceived: (amount: number, accountId: string) => void;
  onEdit: () => void;
}) {
  const [receiving, setReceiving] = useState(false)
  const [amount, setAmount] = useState(item.net_expected)
  const [accountId, setAccountId] = useState('')

  const statusIcon = item.status === 'received'
    ? <CheckCircle size={16} className="text-emerald-400" />
    : item.status === 'partial'
      ? <Clock size={16} className="text-amber-400" />
      : <Clock size={16} className="text-slate-400" />

  const pct = item.net_expected > 0 ? Math.min((item.received_amount / item.net_expected) * 100, 100) : 0

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3.5 flex items-center gap-4">
        {statusIcon}
        <div className="flex-1 min-w-0">
          <p className="text-slate-200 text-sm font-medium">{item.label}</p>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 bg-slate-800 rounded-full h-1 overflow-hidden">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-slate-500 text-xs">{Math.round(pct)}%</span>
          </div>
          {item.expected_date && <p className="text-slate-500 text-xs mt-0.5">Esperado: {item.expected_date}</p>}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-emerald-400 font-semibold text-sm">{formatCOP(item.net_expected)}</p>
          <p className="text-slate-500 text-xs">Bruto: {formatCOP(item.gross_amount)}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {item.status !== 'received' && (
            <button className="btn-ghost text-xs py-1.5 px-3 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/10" onClick={() => setReceiving(r => !r)}>
              Recibido
            </button>
          )}
          <button 
            type="button"
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
            onClick={onEdit}
            title="Editar ingreso esperado"
          >
            <Pencil size={15} />
          </button>
        </div>
      </div>
      {receiving && (
        <div className="border-t border-slate-800 px-4 py-3 bg-slate-900/50 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">Monto recibido neto</label>
              <CurrencyInput className="input w-full py-1.5 h-9 bg-slate-800 border-slate-700 text-xs text-white" value={amount} onChange={val => setAmount(val)} />
            </div>
            <div>
              <label className="label text-xs">Cuenta destino</label>
              <select className="input w-full py-1.5 h-9 bg-slate-800 border-slate-700 text-xs text-white" value={accountId} onChange={e => setAccountId(e.target.value)}>
                <option value="">Seleccionar cuenta...</option>
                {internalAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button className="btn-ghost text-xs py-1.5 px-3" onClick={() => setReceiving(false)}>Cancelar</button>
            <button className="btn-primary text-xs py-1.5 px-3" disabled={!accountId} onClick={() => { onMarkReceived(amount, accountId); setReceiving(false) }}>Confirmar</button>
          </div>
        </div>
      )}
    </div>
  )
}
