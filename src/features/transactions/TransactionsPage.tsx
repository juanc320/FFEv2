import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useAuth } from '@/features/auth/AuthContext'
import { useActiveMonth } from '@/features/months/MonthsPage'
import type { Transaction, Account, MonthlyExpenseItem, Category, Concept } from '@/shared/types/database'
import { formatCOP, calc4x1000, calcEnvelopeAvailable } from '@/shared/utils/calculations'
import { Plus, ArrowLeftRight, TrendingUp, TrendingDown, AlertTriangle, Zap, Trash2, ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import { CurrencyInput } from '@/shared/components/CurrencyInput'

type TxMode = 'expense' | 'income' | 'transfer_internal' | 'transfer_external_in' | 'transfer_external_out' | 'adjustment'

const MODE_LABELS: Record<TxMode, string> = {
  expense: 'Gasto',
  income: 'Ingreso recibido',
  transfer_internal: 'Transferencia interna',
  transfer_external_in: 'Entrada externa',
  transfer_external_out: 'Salida externa',
  adjustment: 'Ajuste manual',
}

const TX_ICON: Record<string, React.ReactNode> = {
  expense: <TrendingDown size={15} className="text-red-400" />,
  income: <TrendingUp size={15} className="text-emerald-400" />,
  transfer_internal: <ArrowLeftRight size={15} className="text-indigo-400" />,
  transfer_external_in: <TrendingUp size={15} className="text-violet-400" />,
  transfer_external_out: <TrendingDown size={15} className="text-amber-400" />,
  adjustment: <Zap size={15} className="text-slate-400" />,
  tax_4x1000: <AlertTriangle size={15} className="text-amber-400" />,
  reallocation: <ArrowLeftRight size={15} className="text-blue-400" />,
}

function useTransactions() {
  const { data: activeMonth } = useActiveMonth()
  return useQuery({
    queryKey: ['transactions', activeMonth?.id],
    queryFn: async (): Promise<Transaction[]> => {
      const { data } = await supabase
        .from('transactions')
        .select('*')
        .eq('month_id', activeMonth!.id)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
      return (data ?? []) as Transaction[]
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

function useExpenseItems() {
  const { data: activeMonth } = useActiveMonth()
  return useQuery({
    queryKey: ['expense_items', activeMonth?.id],
    queryFn: async (): Promise<MonthlyExpenseItem[]> => {
      const { data } = await supabase.from('monthly_expense_items').select('*').eq('month_id', activeMonth!.id).eq('active_in_month', true)
      return (data ?? []) as MonthlyExpenseItem[]
    },
    enabled: !!activeMonth?.id,
  })
}

const EMPTY_FORM = {
  mode: 'expense' as TxMode,
  amount: 0,
  date: new Date().toISOString().split('T')[0],
  source_account_id: '',
  destination_account_id: '',
  external_party_label: '',
  category_id: '',
  concept_id: '',
  expense_item_id: '',
  note: '',
}

export default function TransactionsPage() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const { data: activeMonth } = useActiveMonth()
  const { data: transactions = [], isLoading } = useTransactions()
  const { data: accounts = [] } = useAccounts()
  const { data: expenseItems = [] } = useExpenseItems()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [envelopeAlert, setEnvelopeAlert] = useState<{ shortfall: number; itemId: string } | null>(null)
  const [filterType, setFilterType] = useState<string>('all')
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null)

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', profile?.family_id],
    queryFn: async () => { const { data } = await supabase.from('categories').select('*').eq('family_id', profile!.family_id!); return (data ?? []) as Category[] },
    enabled: !!profile?.family_id,
  })
  const { data: concepts = [] } = useQuery({
    queryKey: ['concepts', profile?.family_id],
    queryFn: async () => { const { data } = await supabase.from('concepts').select('*').eq('family_id', profile!.family_id!); return (data ?? []) as Concept[] },
    enabled: !!profile?.family_id,
  })

  const internalAccounts = accounts.filter(a => a.is_internal)
  const sourceAccount = accounts.find(a => a.id === form.source_account_id)
  const taxAmount = sourceAccount?.applies_4x1000 && !sourceAccount?.is_4x1000_exempt ? calc4x1000(form.amount) : 0
  const selectedItem = expenseItems.find(i => i.id === form.expense_item_id)
  const itemAvailable = selectedItem
    ? calcEnvelopeAvailable(selectedItem.budget_amount, selectedItem.arrears_amount, 0, 0, selectedItem.executed_amount_cached, selectedItem.deferred_amount)
    : null

  const filteredConcepts = concepts.filter(c => c.category_id === form.category_id)
  const filteredExpenseItems = expenseItems.filter(i =>
    (!form.concept_id || i.concept_id === form.concept_id) &&
    (!form.category_id || i.category_id === form.category_id)
  )

  const saveTransaction = useMutation({
    mutationFn: async () => {
      if (!activeMonth) throw new Error('No active month')
      const familyId = profile!.family_id!
      const userId = profile!.id

      // RN-07: Validate envelope
      if (form.mode === 'expense' && selectedItem) {
        const avail = calcEnvelopeAvailable(selectedItem.budget_amount, selectedItem.arrears_amount, 0, 0, selectedItem.executed_amount_cached, selectedItem.deferred_amount)
        if (form.amount > avail) {
          setEnvelopeAlert({ shortfall: form.amount - avail, itemId: selectedItem.id })
          throw new Error('envelope_insufficient')
        }
      }

      // Main transaction
      const { data: tx, error } = await db.from('transactions').insert({
        family_id: familyId,
        month_id: activeMonth.id,
        type: form.mode,
        amount: form.amount,
        tax_amount: taxAmount,
        source_account_id: form.source_account_id || null,
        destination_account_id: form.destination_account_id || null,
        external_party_label: form.external_party_label || null,
        category_id: form.category_id || null,
        concept_id: form.concept_id || null,
        expense_item_id: form.expense_item_id || null,
        date: form.date,
        note: form.note || null,
        created_by: userId,
        is_automatic: false,
      }).select().single()
      if (error) throw error

      // RN-15: Auto 4x1000 for bank exits
      if (taxAmount > 0 && tx) {
        await db.from('transactions').insert({
          family_id: familyId,
          month_id: activeMonth.id,
          type: 'tax_4x1000',
          amount: taxAmount,
          tax_amount: 0,
          source_account_id: form.source_account_id,
          destination_account_id: null,
          is_automatic: true,
          parent_transaction_id: tx.id,
          date: form.date,
          note: `4×1000 automático por salida de ${formatCOP(form.amount)}`,
          created_by: userId,
        })
      }

      // Update account balances (cached)
      if (form.source_account_id) {
        const src = accounts.find(a => a.id === form.source_account_id)
        if (src) await db.from('accounts').update({ current_balance_cached: src.current_balance_cached - form.amount - taxAmount }).eq('id', src.id)
      }
      if (form.destination_account_id && form.mode === 'transfer_internal') {
        const dst = accounts.find(a => a.id === form.destination_account_id)
        if (dst) await db.from('accounts').update({ current_balance_cached: dst.current_balance_cached + form.amount }).eq('id', dst.id)
      }
      if (form.mode === 'income' && form.destination_account_id) {
        const dst = accounts.find(a => a.id === form.destination_account_id)
        if (dst) await db.from('accounts').update({ current_balance_cached: dst.current_balance_cached + form.amount }).eq('id', dst.id)
      }

      // Update expense item executed cache
      if (form.expense_item_id && form.mode === 'expense' && selectedItem) {
        await db.from('monthly_expense_items').update({
          executed_amount_cached: selectedItem.executed_amount_cached + form.amount,
        }).eq('id', form.expense_item_id)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['expense_items'] })
      setShowForm(false)
      setForm(EMPTY_FORM)
      setEnvelopeAlert(null)
    },
    onError: (e) => { if ((e as Error).message !== 'envelope_insufficient') alert('Error: ' + (e as Error).message) },
  })

  const updateTx = useMutation({
    mutationFn: async ({ id, note, date }: { id: string; note: string; date: string }) => {
      await db.from('transactions').update({ note: note || null, date }).eq('id', id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions'] })
  })

  const deleteTx = useMutation({
    mutationFn: async (tx: Transaction) => {
      if (tx.source_account_id) {
        const src = accounts.find(a => a.id === tx.source_account_id)
        if (src) await db.from('accounts').update({ current_balance_cached: src.current_balance_cached + tx.amount + tx.tax_amount }).eq('id', src.id)
      }
      if (tx.destination_account_id) {
        const dst = accounts.find(a => a.id === tx.destination_account_id)
        if (dst) {
          if (tx.type === 'transfer_internal' || tx.type === 'income') {
             await db.from('accounts').update({ current_balance_cached: dst.current_balance_cached - tx.amount }).eq('id', dst.id)
          }
        }
      }
      if (tx.expense_item_id && tx.type === 'expense') {
        const item = expenseItems.find(i => i.id === tx.expense_item_id)
        if (item) await db.from('monthly_expense_items').update({ executed_amount_cached: item.executed_amount_cached - tx.amount }).eq('id', item.id)
      }
      if (tx.tax_amount > 0) {
        await db.from('transactions').delete().eq('parent_transaction_id', tx.id)
      }
      await db.from('transactions').delete().eq('id', tx.id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['expense_items'] })
    }
  })

  const filtered = filterType === 'all' ? transactions : transactions.filter(t => t.type === filterType)

  if (!activeMonth) {
    return (
      <div className="max-w-2xl mx-auto mt-16 card text-center space-y-3">
        <AlertTriangle className="text-amber-400 mx-auto" size={32} />
        <p className="text-white font-semibold">No hay un mes activo</p>
        <p className="text-slate-400 text-sm">Ve a <a href="/months" className="text-indigo-400 underline">Mes presupuestal</a> primero.</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Movimientos</h1>
          <p className="text-slate-400 text-sm mt-0.5">{transactions.length} transacciones este mes</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => { setShowForm(true); setEnvelopeAlert(null) }}>
          <Plus size={16} /> Registrar
        </button>
      </div>

      {/* FORM */}
      {showForm && (
        <div className="card border-indigo-500/30 space-y-4">
          <h2 className="text-white font-semibold">Nuevo movimiento</h2>

          {/* Type selector */}
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(MODE_LABELS) as TxMode[]).map(m => (
              <button key={m} onClick={() => setForm(f => ({ ...f, mode: m }))}
                className={clsx('text-xs py-2 px-2 rounded-xl border font-medium transition-all text-center', form.mode === m ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-white')}>
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Monto</label>
              <CurrencyInput className="input w-full" value={form.amount} onChange={val => setForm(f => ({ ...f, amount: val }))} />
            </div>
            <div>
              <label className="label">Fecha</label>
              <input type="date" className="input w-full" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>

            {/* Source account */}
            {['expense', 'transfer_internal', 'transfer_external_out', 'adjustment'].includes(form.mode) && (
              <div>
                <label className="label">Cuenta origen</label>
                <select className="input w-full" value={form.source_account_id} onChange={e => setForm(f => ({ ...f, source_account_id: e.target.value }))}>
                  <option value="">Seleccionar...</option>
                  {internalAccounts.map(a => <option key={a.id} value={a.id}>{a.name} ({formatCOP(a.current_balance_cached)})</option>)}
                </select>
              </div>
            )}

            {/* Destination account */}
            {['income', 'transfer_internal', 'transfer_external_in'].includes(form.mode) && (
              <div>
                <label className="label">Cuenta destino</label>
                <select className="input w-full" value={form.destination_account_id} onChange={e => setForm(f => ({ ...f, destination_account_id: e.target.value }))}>
                  <option value="">Seleccionar...</option>
                  {internalAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}

            {/* External party */}
            {['transfer_external_in', 'transfer_external_out'].includes(form.mode) && (
              <div>
                <label className="label">Origen/destino externo</label>
                <input className="input w-full" placeholder="Ej: Banco ABC" value={form.external_party_label} onChange={e => setForm(f => ({ ...f, external_party_label: e.target.value }))} />
              </div>
            )}

            {/* Category + Concept (for expenses) */}
            {form.mode === 'expense' && (
              <>
                <div>
                  <label className="label">Categoría</label>
                  <select className="input w-full" value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value, concept_id: '', expense_item_id: '' }))}>
                    <option value="">Seleccionar...</option>
                    {categories.filter(c => c.type === 'expense').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Concepto</label>
                  <select className="input w-full" value={form.concept_id} onChange={e => setForm(f => ({ ...f, concept_id: e.target.value, expense_item_id: '' }))} disabled={!form.category_id}>
                    <option value="">Seleccionar...</option>
                    {filteredConcepts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                {filteredExpenseItems.length > 0 && (
                  <div className="sm:col-span-2">
                    <label className="label">Sobre presupuestal</label>
                    <select className="input w-full" value={form.expense_item_id} onChange={e => setForm(f => ({ ...f, expense_item_id: e.target.value }))}>
                      <option value="">Seleccionar sobre...</option>
                      {filteredExpenseItems.map(i => {
                        const avail = calcEnvelopeAvailable(i.budget_amount, i.arrears_amount, 0, 0, i.executed_amount_cached, i.deferred_amount)
                        return <option key={i.id} value={i.id}>Disponible: {formatCOP(avail)}</option>
                      })}
                    </select>
                  </div>
                )}
              </>
            )}

            {/* Adjustment note */}
            {form.mode === 'adjustment' && (
              <div className="sm:col-span-2">
                <label className="label">Nota (obligatoria para ajustes)</label>
                <input className="input w-full" placeholder="Motivo del ajuste" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
              </div>
            )}

            {form.mode !== 'adjustment' && (
              <div className="sm:col-span-2">
                <label className="label">Nota (opcional)</label>
                <input className="input w-full" placeholder="Descripción adicional" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
              </div>
            )}
          </div>

          {/* 4x1000 preview */}
          {taxAmount > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle size={15} className="text-amber-400" />
                <span className="text-amber-300 text-sm">Se generará 4×1000 automático</span>
              </div>
              <span className="text-amber-400 font-semibold">{formatCOP(taxAmount)}</span>
            </div>
          )}

          {/* Envelope alert */}
          {envelopeAlert && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
              <p className="text-red-300 text-sm font-semibold">⚠️ Sobre insuficiente</p>
              <p className="text-red-400/80 text-xs mt-1">Faltan {formatCOP(envelopeAlert.shortfall)} en el sobre. Ajusta el monto o reasigna presupuesto desde otro sobre.</p>
            </div>
          )}

          {/* Envelope info */}
          {itemAvailable !== null && form.amount > 0 && (
            <div className={clsx('rounded-xl px-4 py-3 border flex items-center justify-between',
              form.amount > itemAvailable ? 'bg-red-500/10 border-red-500/30' : 'bg-emerald-500/10 border-emerald-500/30')}>
              <span className="text-sm text-slate-300">Disponible en sobre</span>
              <span className={clsx('font-semibold', form.amount > itemAvailable ? 'text-red-400' : 'text-emerald-400')}>{formatCOP(itemAvailable)}</span>
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <button className="btn-ghost" onClick={() => { setShowForm(false); setEnvelopeAlert(null) }}>Cancelar</button>
            <button
              className="btn-primary"
              disabled={form.amount <= 0 || saveTransaction.isPending || (form.mode === 'adjustment' && !form.note.trim())}
              onClick={() => saveTransaction.mutate()}
            >
              {saveTransaction.isPending ? 'Guardando...' : 'Registrar movimiento'}
            </button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {['all', 'expense', 'income', 'transfer_internal', 'tax_4x1000'].map(t => (
          <button key={t} onClick={() => setFilterType(t)}
            className={clsx('text-xs px-3 py-1.5 rounded-full border transition-all', filterType === t ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-slate-700 text-slate-400 hover:text-white')}>
            {t === 'all' ? 'Todos' : t === 'tax_4x1000' ? '4×1000' : MODE_LABELS[t as TxMode] ?? t}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading && <div className="card text-center text-slate-500 py-8">Cargando...</div>}
      <div className="space-y-2">
        {filtered.map(tx => {
          const catName = categories.find(c => c.id === tx.category_id)?.name
          const conName = concepts.find(c => c.id === tx.concept_id)?.name
          const srcAcc = accounts.find(a => a.id === tx.source_account_id)?.name
          const dstAcc = accounts.find(a => a.id === tx.destination_account_id)?.name
          const isDebit = ['expense', 'transfer_external_out', 'tax_4x1000', 'adjustment'].includes(tx.type)
          return (
            <div key={tx.id} className="card p-0 overflow-hidden">
              <div 
                className={clsx('flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-slate-800/30 transition-colors', tx.is_automatic ? 'bg-amber-500/5' : '')}
                onClick={() => setExpandedTxId(expandedTxId === tx.id ? null : tx.id)}
              >
                <div className="flex-shrink-0">{TX_ICON[tx.type]}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-slate-200 text-sm font-medium">
                      {tx.note ?? conName ?? MODE_LABELS[tx.type as TxMode] ?? tx.type}
                    </p>
                    {tx.is_automatic && <span className="text-xs px-1.5 py-0.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded">Auto</span>}
                  </div>
                  <p className="text-slate-500 text-xs mt-0.5">
                    {tx.date} {srcAcc && `· ${srcAcc}`}{dstAcc && ` → ${dstAcc}`}{catName && ` · ${catName}`}
                  </p>
                </div>
                <div className="text-right flex-shrink-0 flex items-center gap-3">
                  <p className={clsx('font-semibold text-sm', isDebit ? 'text-red-400' : 'text-emerald-400')}>
                    {isDebit ? '-' : '+'}{formatCOP(tx.amount)}
                  </p>
                  <ChevronDown size={15} className={clsx('text-slate-500 transition-transform', expandedTxId === tx.id && 'rotate-180')} />
                </div>
              </div>

              {expandedTxId === tx.id && (
                <div className="border-t border-slate-800 px-4 py-3 bg-slate-900/50 space-y-3">
                  {!tx.is_automatic ? (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs text-slate-500 block mb-1">Fecha</label>
                          <input type="date" className="input w-full px-2 py-1.5 text-xs h-8 bg-slate-800 border-slate-700 text-slate-300" 
                            defaultValue={tx.date} 
                            onChange={(e) => updateTx.mutate({ id: tx.id, note: tx.note || '', date: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-500 block mb-1">Nota</label>
                          <input type="text" className="input w-full px-2 py-1.5 text-xs h-8 bg-slate-800 border-slate-700 text-slate-300" 
                            defaultValue={tx.note || ''} 
                            onBlur={(e) => updateTx.mutate({ id: tx.id, note: e.target.value, date: tx.date })}
                          />
                        </div>
                      </div>
                      <div className="flex justify-end pt-1">
                        <button 
                          className="text-xs flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm('¿Seguro que deseas eliminar este movimiento?\nEl dinero será devuelto a tu cuenta y sobre correspondiente.')) {
                              deleteTx.mutate(tx)
                            }
                          }}
                        >
                          <Trash2 size={14} /> Eliminar movimiento
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-amber-400/80 italic text-center">Los movimientos automáticos (como el 4x1000) no se pueden editar directamente. Se eliminarán si eliminas el movimiento original que los generó.</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {!isLoading && filtered.length === 0 && (
          <div className="card text-center text-slate-500 py-10">
            <p>No hay movimientos{filterType !== 'all' ? ' de este tipo' : ''}.</p>
          </div>
        )}
      </div>
    </div>
  )
}
