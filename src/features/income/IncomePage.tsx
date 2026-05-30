import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useAuth } from '@/features/auth/AuthContext'
import { useActiveMonth } from '@/features/months/MonthsPage'
import type { MonthlyIncomeItem, DeductionType, Account } from '@/shared/types/database'
import { formatCOP, calcNetIncome } from '@/shared/utils/calculations'
import { Plus, TrendingUp, AlertTriangle, CheckCircle, Clock, Pencil, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { CurrencyInput } from '@/shared/components/CurrencyInput'

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
}

const EMPTY_FORM: IncomeForm = {
  label: '',
  gross_amount: 0,
  deduction_type: 'none',
  deduction_rate: 0,
  deduction_amount: 0,
  expected_date: '',
  is_recurring: false,
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
        is_recurring: form.is_recurring,
      })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['income_items'] }); setShowForm(false); setForm(EMPTY_FORM) },
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
        is_recurring: form.is_recurring,
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

  const totalExpected = items.reduce((s, i) => s + i.net_expected, 0)
  const totalReceived = items.reduce((s, i) => s + i.received_amount, 0)

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
          <h1 className="text-2xl font-bold text-white">Ingresos esperados</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Recibido: <span className="text-emerald-400 font-semibold">{formatCOP(totalReceived)}</span>
            {' '}/ Esperado: <span className="text-indigo-400 font-medium">{formatCOP(totalExpected)}</span>
          </p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => { setEditingItem(null); setForm(EMPTY_FORM); setShowForm(true); }}>
          <Plus size={16} /> Nuevo ingreso
        </button>
      </div>

      {showForm && (
        <div className="card border-emerald-500/30 space-y-4">
          <h2 className="text-white font-semibold">
            {editingItem ? 'Editar ingreso esperado' : 'Nuevo ingreso esperado'}
          </h2>
          
          {/* Conceptos prediseñados rápidos (solo para creación) */}
          {!editingItem && (
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
              <input className="input w-full" placeholder="Ej: Salario junio" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
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
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-indigo-500 rounded" checked={form.is_recurring} onChange={e => setForm(f => ({ ...f, is_recurring: e.target.checked }))} />
            <span className="text-slate-300 text-sm">Ingreso recurrente (se copiará al siguiente mes)</span>
          </label>
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

      {/* Lista */}
      {isLoading && <div className="card text-center text-slate-500 py-8">Cargando...</div>}
      {!isLoading && items.length === 0 && (
        <div className="card text-center py-10 space-y-2">
          <TrendingUp className="text-emerald-400/40 mx-auto" size={36} />
          <p className="text-slate-400 font-medium">Sin ingresos registrados</p>
          <p className="text-slate-500 text-sm">Agrega los ingresos esperados del mes.</p>
        </div>
      )}
      <div className="space-y-3">
        {items.map(item => (
          <IncomeCard 
            key={item.id} 
            item={item} 
            internalAccounts={accounts.filter(a => a.is_internal)}
            onMarkReceived={(amount, accountId) => markReceived.mutate({ id: item.id, amount, netExpected: item.net_expected, accountId, label: item.label })} 
            onEdit={() => handleEdit(item)}
          />
        ))}
      </div>
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
