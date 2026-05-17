import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useAuth } from '@/features/auth/AuthContext'
import { Plus, Wallet, Edit2, Trash2, Check, X, AlertTriangle } from 'lucide-react'
import type { Account, AccountType } from '@/shared/types/database'
import { formatCOP } from '@/shared/utils/calculations'
import clsx from 'clsx'
import { CurrencyInput } from '@/shared/components/CurrencyInput'

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: 'Banco',
  cash: 'Efectivo',
  pocket: 'Bolsillo',
  external: 'Externa',
  pending_income: 'Ing. pendiente',
}

const ACCOUNT_TYPE_COLORS: Record<AccountType, string> = {
  bank: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  cash: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  pocket: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  external: 'bg-slate-600/20 text-slate-400 border-slate-600/30',
  pending_income: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
}

function useAccounts() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['accounts', profile?.family_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('accounts')
        .select('*')
        .eq('family_id', profile!.family_id!)
        .order('type')
        .order('name')
      return (data ?? []) as Account[]
    },
    enabled: !!profile?.family_id,
  })
}

const EMPTY_FORM = {
  name: '',
  type: 'bank' as AccountType,
  is_internal: true,
  opening_balance: 0,
  applies_4x1000: false,
  is_4x1000_exempt: false,
}

export default function AccountsPage() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const { data: accounts = [], isLoading } = useAccounts()
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  const internalAccounts = accounts.filter(a => a.is_internal && a.active)
  const externalAccounts = accounts.filter(a => !a.is_internal && a.active)
  const totalBalance = internalAccounts.reduce((s, a) => s + a.current_balance_cached, 0)

  const saveAccount = useMutation({
    mutationFn: async () => {
      if (editId) {
        await db.from('accounts').update({
          name: form.name,
          type: form.type,
          applies_4x1000: form.applies_4x1000,
          is_4x1000_exempt: form.is_4x1000_exempt,
        }).eq('id', editId)
      } else {
        await db.from('accounts').insert({
          family_id: profile!.family_id!,
          name: form.name,
          type: form.type,
          is_internal: form.type !== 'external',
          opening_balance: form.opening_balance,
          current_balance_cached: form.opening_balance,
          applies_4x1000: form.applies_4x1000,
          is_4x1000_exempt: form.is_4x1000_exempt,
          active: true,
        })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      setShowForm(false); setEditId(null); setForm(EMPTY_FORM)
    },
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      await db.from('accounts').update({ active }).eq('id', id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })

  function startEdit(a: Account) {
    setForm({ name: a.name, type: a.type, is_internal: a.is_internal, opening_balance: a.opening_balance, applies_4x1000: a.applies_4x1000, is_4x1000_exempt: a.is_4x1000_exempt })
    setEditId(a.id); setShowForm(true)
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Cuentas y bolsillos</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Saldo total: <span className="text-emerald-400 font-semibold">{formatCOP(totalBalance)}</span>
          </p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => { setShowForm(true); setEditId(null); setForm(EMPTY_FORM) }}>
          <Plus size={16} /> Nueva cuenta
        </button>
      </div>

      {/* Formulario */}
      {showForm && (
        <div className="card border-indigo-500/30 space-y-4">
          <h2 className="text-white font-semibold">{editId ? 'Editar cuenta' : 'Nueva cuenta'}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="label">Nombre</label>
              <input className="input w-full" placeholder="Ej: Bancolombia ahorros" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="label">Tipo</label>
              <select className="input w-full" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as AccountType, is_internal: e.target.value !== 'external' }))}>
                {Object.entries(ACCOUNT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            {!editId && (
              <div>
                <label className="label">Saldo inicial</label>
                <CurrencyInput className="input w-full" value={form.opening_balance} onChange={val => setForm(f => ({ ...f, opening_balance: val }))} />
              </div>
            )}
          </div>
          {/* 4x1000 solo para cuentas bancarias */}
          {form.type === 'bank' && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-amber-300 text-sm font-medium">
                <AlertTriangle size={15} /> Configuración 4×1000
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 rounded accent-indigo-500" checked={form.applies_4x1000} onChange={e => setForm(f => ({ ...f, applies_4x1000: e.target.checked }))} />
                <span className="text-slate-300 text-sm">Esta cuenta está sujeta / no exenta al 4×1000</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 rounded accent-indigo-500" checked={form.is_4x1000_exempt} onChange={e => setForm(f => ({ ...f, is_4x1000_exempt: e.target.checked }))} />
                <span className="text-slate-300 text-sm">Cuenta exenta del 4×1000</span>
              </label>
            </div>
          )}
          <div className="flex gap-3 justify-end">
            <button className="btn-ghost" onClick={() => { setShowForm(false); setEditId(null) }}>Cancelar</button>
            <button className="btn-primary" disabled={!form.name.trim() || saveAccount.isPending} onClick={() => saveAccount.mutate()}>
              {saveAccount.isPending ? 'Guardando...' : editId ? 'Guardar cambios' : 'Crear cuenta'}
            </button>
          </div>
        </div>
      )}

      {/* Cuentas internas */}
      <AccountGroup title="Cuentas internas" accounts={internalAccounts} isLoading={isLoading} onEdit={startEdit} onToggle={id => toggleActive.mutate({ id, active: false })} />

      {/* Cuentas externas */}
      {externalAccounts.length > 0 && (
        <AccountGroup title="Cuentas externas (referencia)" accounts={externalAccounts} isLoading={false} onEdit={startEdit} onToggle={id => toggleActive.mutate({ id, active: false })} />
      )}
    </div>
  )
}

function AccountGroup({ title, accounts, isLoading, onEdit, onToggle }: {
  title: string; accounts: Account[]; isLoading: boolean
  onEdit: (a: Account) => void; onToggle: (id: string) => void
}) {
  return (
    <div className="card space-y-3">
      <h2 className="text-white font-semibold">{title}</h2>
      {isLoading && <p className="text-slate-500 text-sm">Cargando...</p>}
      {!isLoading && accounts.length === 0 && (
        <p className="text-slate-500 text-sm text-center py-6">Sin cuentas. Crea la primera con el botón de arriba.</p>
      )}
      {accounts.map(a => (
        <div key={a.id} className="flex items-center gap-4 px-4 py-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
          <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border', ACCOUNT_TYPE_COLORS[a.type])}>
            <Wallet size={17} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-slate-200 text-sm font-medium truncate">{a.name}</p>
              <span className={clsx('text-xs px-2 py-0.5 rounded-full border', ACCOUNT_TYPE_COLORS[a.type])}>
                {ACCOUNT_TYPE_LABELS[a.type]}
              </span>
              {a.applies_4x1000 && !a.is_4x1000_exempt && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">4×1000</span>
              )}
            </div>
            {a.is_internal && (
              <p className="text-slate-400 text-sm font-semibold mt-0.5">{formatCOP(a.current_balance_cached)}</p>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button className="icon-btn text-slate-400 hover:text-white hover:bg-slate-700" onClick={() => onEdit(a)}><Edit2 size={14} /></button>
            <button className="icon-btn text-slate-400 hover:text-red-400 hover:bg-red-400/10" onClick={() => onToggle(a.id)}><Trash2 size={14} /></button>
          </div>
        </div>
      ))}
    </div>
  )
}
