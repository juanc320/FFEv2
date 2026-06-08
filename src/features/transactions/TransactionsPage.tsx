import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useAuth } from '@/features/auth/AuthContext'
import { useActiveMonth } from '@/features/months/MonthsPage'
import type { Transaction, Account, MonthlyExpenseItem, MonthlyIncomeItem, Category, Concept } from '@/shared/types/database'
import { formatCOP, calc4x1000, calcEnvelopeAvailable } from '@/shared/utils/calculations'
import { Plus, ArrowLeftRight, TrendingUp, TrendingDown, AlertTriangle, Zap, Trash2, ChevronDown, Search, ArrowLeft } from 'lucide-react'
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

function useIncomeItems() {
  const { data: activeMonth } = useActiveMonth()
  return useQuery({
    queryKey: ['income_items', activeMonth?.id],
    queryFn: async (): Promise<MonthlyIncomeItem[]> => {
      const { data } = await supabase.from('monthly_income_items').select('*').eq('month_id', activeMonth!.id)
      return (data ?? []) as MonthlyIncomeItem[]
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
  income_item_id: '',
  note: '',
}

export default function TransactionsPage() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const { data: activeMonth } = useActiveMonth()
  const { data: transactions = [], isLoading } = useTransactions()
  const { data: accounts = [] } = useAccounts()
  const { data: expenseItems = [] } = useExpenseItems()
  const { data: incomeItems = [] } = useIncomeItems()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [envelopeAlert, setEnvelopeAlert] = useState<{ shortfall: number; itemId: string } | null>(null)
  const [filterType, setFilterType] = useState<string>('all')
  const [accountFilter, setAccountFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<any>(null)
  const [prefilledFields, setPrefilledFields] = useState<Record<string, boolean>>({})
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [showNewConceptInput, setShowNewConceptInput] = useState(false)
  const [newConceptName, setNewConceptName] = useState('')
  const [cameFromExpenses, setCameFromExpenses] = useState(false)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    if (location.state?.filterSearchQuery) {
      setSearchQuery(location.state.filterSearchQuery)
      setCameFromExpenses(true)
      window.history.replaceState({}, document.title)
      window.scrollTo(0, 0)
    } else if (location.state?.prefillExpenseId) {
      setShowForm(true)
      setForm(f => ({
        ...f,
        mode: 'expense',
        category_id: location.state.prefillCategoryId,
        concept_id: location.state.prefillConceptId,
        expense_item_id: location.state.prefillExpenseId,
        amount: location.state.prefillAmount || 0,
      }))
      setPrefilledFields({
        category_id: !!location.state.prefillCategoryId,
        concept_id: !!location.state.prefillConceptId,
        expense_item_id: !!location.state.prefillExpenseId,
        amount: !!location.state.prefillAmount,
      })
      setCameFromExpenses(true)
      window.history.replaceState({}, document.title)
      window.scrollTo(0, 0)
    } else if (location.state?.prefillIncomeId) {
      setShowForm(true)
      setForm(f => ({
        ...f,
        mode: 'income',
        income_item_id: location.state.prefillIncomeId,
        amount: location.state.prefillAmount || 0,
      }))
      setPrefilledFields({
        income_item_id: !!location.state.prefillIncomeId,
        amount: !!location.state.prefillAmount,
      })
      window.history.replaceState({}, document.title)
      window.scrollTo(0, 0)
    } else if (location.state?.prefillAccountId) {
      setShowForm(true)
      setForm(f => ({
        ...f,
        source_account_id: location.state.prefillAccountId
      }))
      setPrefilledFields({})
      window.history.replaceState({}, document.title)
      window.scrollTo(0, 0)
    }
  }, [location.state])

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

      // Note: We now allow transactions to go over the budget (pockets can go in red).
      // We only show a warning in the UI instead of throwing and blocking registration.

      let finalCategoryId = form.category_id
      let finalConceptId = form.concept_id
      let finalExpenseItemId = form.expense_item_id

      if (form.mode === 'expense') {
        // 1. Crear categoría rápida si es necesario
        if (showNewCategoryInput && newCategoryName.trim()) {
          const { data: newCat, error: catErr } = await db
            .from('categories')
            .insert({
              family_id: familyId,
              name: newCategoryName.trim(),
              type: 'expense',
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
              family_id: familyId,
              category_id: finalCategoryId,
              name: newConceptName.trim(),
              active: true
            })
            .select()
            .single()
          if (conErr) throw conErr
          finalConceptId = newConcept.id
        }

        // 3. Crear bolsillo mensual de $0 si es categoría o concepto nuevo
        if (showNewCategoryInput || showNewConceptInput) {
          const { data: newItem, error: itemErr } = await db
            .from('monthly_expense_items')
            .insert({
              month_id: activeMonth.id,
              family_id: familyId,
              category_id: finalCategoryId,
              concept_id: finalConceptId,
              expense_type: 'variable',
              criticality: 'necessary',
              due_mode: 'once',
              budget_amount: 0,
              arrears_amount: 0,
              deferred_amount: 0,
              executed_amount_cached: form.amount, // Registrar monto consumido
              status: 'pending',
              active_in_month: true,
            })
            .select()
            .single()
          if (itemErr) throw itemErr
          finalExpenseItemId = newItem.id
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
        category_id: finalCategoryId || null,
        concept_id: finalConceptId || null,
        expense_item_id: finalExpenseItemId || null,
        income_item_id: form.mode === 'income' ? (form.income_item_id || null) : null,
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
      if (form.destination_account_id && ['income', 'transfer_internal', 'transfer_external_in'].includes(form.mode)) {
        const dst = accounts.find(a => a.id === form.destination_account_id)
        if (dst) await db.from('accounts').update({ current_balance_cached: dst.current_balance_cached + form.amount }).eq('id', dst.id)
      }

      // Update expense item executed cache
      if (form.expense_item_id && form.mode === 'expense' && selectedItem) {
        await db.from('monthly_expense_items').update({
          executed_amount_cached: selectedItem.executed_amount_cached + form.amount,
        }).eq('id', form.expense_item_id)
      }

      // Update income item received cache
      if (form.income_item_id && form.mode === 'income') {
        const { data: incItem } = await db.from('monthly_income_items')
          .select('*')
          .eq('id', form.income_item_id)
          .single()
        
        if (incItem) {
          const newReceived = (Number(incItem.received_amount) || 0) + form.amount
          const netExpected = Number(incItem.net_expected) || 0
          const newStatus = newReceived >= netExpected ? 'received' : 'partial'
          await db.from('monthly_income_items').update({
            received_amount: newReceived,
            status: newStatus
          }).eq('id', form.income_item_id)
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['expense_items'] })
      qc.invalidateQueries({ queryKey: ['income_items'] })
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['concepts'] })
      setShowForm(false)
      setForm(EMPTY_FORM)
      setEnvelopeAlert(null)
      setPrefilledFields({})
      setShowNewCategoryInput(false)
      setNewCategoryName('')
      setShowNewConceptInput(false)
      setNewConceptName('')
    },
    onError: (e) => { if ((e as Error).message !== 'envelope_insufficient') alert('Error: ' + (e as Error).message) },
  })

  const updateTxFull = useMutation({
    mutationFn: async ({ oldTx, newValues }: { oldTx: Transaction; newValues: typeof editForm }) => {
      // 1. Revert old account balances
      if (oldTx.source_account_id) {
        const src = accounts.find(a => a.id === oldTx.source_account_id)
        if (src) await db.from('accounts').update({ current_balance_cached: src.current_balance_cached + Number(oldTx.amount) + Number(oldTx.tax_amount || 0) }).eq('id', src.id)
      }
      if (oldTx.destination_account_id) {
        const dst = accounts.find(a => a.id === oldTx.destination_account_id)
        if (dst && ['income', 'transfer_internal', 'transfer_external_in'].includes(oldTx.type)) {
          await db.from('accounts').update({ current_balance_cached: dst.current_balance_cached - Number(oldTx.amount) }).eq('id', dst.id)
        }
      }

      // 2. Revert old executed cache
      if (oldTx.expense_item_id && oldTx.type === 'expense') {
        const item = expenseItems.find(i => i.id === oldTx.expense_item_id)
        if (item) await db.from('monthly_expense_items').update({ executed_amount_cached: item.executed_amount_cached - Number(oldTx.amount) }).eq('id', item.id)
      }

      // Revert old received cache for income
      if (oldTx.income_item_id && oldTx.type === 'income') {
        const { data: oldIncItem } = await db.from('monthly_income_items').select('*').eq('id', oldTx.income_item_id).single()
        if (oldIncItem) {
          const newReceived = Math.max(0, (Number(oldIncItem.received_amount) || 0) - Number(oldTx.amount))
          const netExpected = Number(oldIncItem.net_expected) || 0
          const newStatus = newReceived >= netExpected ? 'received' : newReceived > 0 ? 'partial' : 'pending'
          await db.from('monthly_income_items').update({ received_amount: newReceived, status: newStatus }).eq('id', oldTx.income_item_id)
        }
      }

      // 3. Delete old 4x1000 tax transaction if it existed
      if (oldTx.tax_amount > 0) {
        await db.from('transactions').delete().eq('parent_transaction_id', oldTx.id)
      }

      // 4. Calculate new 4x1000 tax amount
      const newSourceAccount = accounts.find(a => a.id === newValues.source_account_id)
      const newTaxAmount = newSourceAccount?.applies_4x1000 && !newSourceAccount?.is_4x1000_exempt ? calc4x1000(Number(newValues.amount)) : 0

      // 5. Update main transaction row
      const { data: updatedTx, error } = await db.from('transactions').update({
        amount: Number(newValues.amount),
        tax_amount: newTaxAmount,
        source_account_id: newValues.source_account_id || null,
        destination_account_id: newValues.destination_account_id || null,
        external_party_label: newValues.external_party_label || null,
        category_id: newValues.category_id || null,
        concept_id: newValues.concept_id || null,
        expense_item_id: newValues.expense_item_id || null,
        income_item_id: oldTx.type === 'income' ? (newValues.income_item_id || null) : null,
        date: newValues.date,
        note: newValues.note || null,
      }).eq('id', oldTx.id).select().single()
      if (error) throw error

      // 6. Insert new 4x1000 tax transaction if newTaxAmount > 0
      if (newTaxAmount > 0 && updatedTx) {
        await db.from('transactions').insert({
          family_id: oldTx.family_id,
          month_id: oldTx.month_id,
          type: 'tax_4x1000',
          amount: newTaxAmount,
          tax_amount: 0,
          source_account_id: newValues.source_account_id,
          destination_account_id: null,
          is_automatic: true,
          parent_transaction_id: updatedTx.id,
          date: newValues.date,
          note: `4×1000 automático por salida de ${formatCOP(Number(newValues.amount))}`,
          created_by: oldTx.created_by,
        })
      }

      // 7. Apply new account balances
      if (newValues.source_account_id) {
        const src = accounts.find(a => a.id === newValues.source_account_id)
        if (src) {
          const baseBalance = src.id === oldTx.source_account_id ? src.current_balance_cached + Number(oldTx.amount) + Number(oldTx.tax_amount || 0) : src.current_balance_cached
          await db.from('accounts').update({ current_balance_cached: baseBalance - Number(newValues.amount) - newTaxAmount }).eq('id', src.id)
        }
      }
      if (newValues.destination_account_id && ['income', 'transfer_internal', 'transfer_external_in'].includes(oldTx.type)) {
        const dst = accounts.find(a => a.id === newValues.destination_account_id)
        if (dst) {
          const baseBalance = dst.id === oldTx.destination_account_id ? dst.current_balance_cached - Number(oldTx.amount) : dst.current_balance_cached
          await db.from('accounts').update({ current_balance_cached: baseBalance + Number(newValues.amount) }).eq('id', dst.id)
        }
      }

      // 8. Apply new executed cache
      if (newValues.expense_item_id && oldTx.type === 'expense') {
        const item = expenseItems.find(i => i.id === newValues.expense_item_id)
        if (item) {
          const baseExecuted = item.id === oldTx.expense_item_id ? item.executed_amount_cached - Number(oldTx.amount) : item.executed_amount_cached
          await db.from('monthly_expense_items').update({ executed_amount_cached: baseExecuted + Number(newValues.amount) }).eq('id', item.id)
        }
      }

      // 9. Apply new received cache for income
      if (newValues.income_item_id && oldTx.type === 'income') {
        const { data: newIncItem } = await db.from('monthly_income_items').select('*').eq('id', newValues.income_item_id).single()
        if (newIncItem) {
          const newReceived = (Number(newIncItem.received_amount) || 0) + Number(newValues.amount)
          const netExpected = Number(newIncItem.net_expected) || 0
          const newStatus = newReceived >= netExpected ? 'received' : 'partial'
          await db.from('monthly_income_items').update({ received_amount: newReceived, status: newStatus }).eq('id', newValues.income_item_id)
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['expense_items'] })
      qc.invalidateQueries({ queryKey: ['income_items'] })
      setExpandedTxId(null)
      setEditForm(null)
    },
    onError: (e) => alert('Error al actualizar: ' + (e as Error).message)
  })

  const deleteTx = useMutation({
    mutationFn: async (tx: Transaction) => {
      if (tx.source_account_id) {
        const src = accounts.find(a => a.id === tx.source_account_id)
        if (src) await db.from('accounts').update({ current_balance_cached: src.current_balance_cached + tx.amount + tx.tax_amount }).eq('id', src.id)
      }
      if (tx.destination_account_id) {
        const dst = accounts.find(a => a.id === tx.destination_account_id)
        if (dst && ['income', 'transfer_internal', 'transfer_external_in'].includes(tx.type)) {
          await db.from('accounts').update({ current_balance_cached: dst.current_balance_cached - tx.amount }).eq('id', dst.id)
        }
      }
      if (tx.expense_item_id && tx.type === 'expense') {
        const item = expenseItems.find(i => i.id === tx.expense_item_id)
        if (item) await db.from('monthly_expense_items').update({ executed_amount_cached: item.executed_amount_cached - tx.amount }).eq('id', item.id)
      }
      if (tx.income_item_id && tx.type === 'income') {
        const { data: incItem } = await db.from('monthly_income_items').select('*').eq('id', tx.income_item_id).single()
        if (incItem) {
          const newReceived = Math.max(0, (Number(incItem.received_amount) || 0) - tx.amount)
          const netExpected = Number(incItem.net_expected) || 0
          const newStatus = newReceived >= netExpected ? 'received' : newReceived > 0 ? 'partial' : 'pending'
          await db.from('monthly_income_items').update({ received_amount: newReceived, status: newStatus }).eq('id', tx.income_item_id)
        }
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
      qc.invalidateQueries({ queryKey: ['income_items'] })
    }
  })

  const filtered = transactions.filter(t => {
    // Apply transaction type filter
    if (filterType !== 'all') {
      if (filterType === 'unbudgeted') {
        if (!(t.type === 'expense' && !t.expense_item_id)) return false
      } else {
        if (t.type !== filterType) return false
      }
    }
    // Apply bank account filter
    if (accountFilter !== 'all') {
      if (t.source_account_id !== accountFilter && t.destination_account_id !== accountFilter) {
        return false
      }
    }
    // Apply search query filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      const catName = categories.find(c => c.id === t.category_id)?.name?.toLowerCase() || ''
      const conName = concepts.find(c => c.id === t.concept_id)?.name?.toLowerCase() || ''
      const srcAcc = accounts.find(a => a.id === t.source_account_id)?.name?.toLowerCase() || ''
      const dstAcc = accounts.find(a => a.id === t.destination_account_id)?.name?.toLowerCase() || ''
      const note = t.note?.toLowerCase() || ''
      const amountStr = String(t.amount)
      const formattedAmount = formatCOP(t.amount).toLowerCase()

      const match = 
        catName.includes(query) ||
        conName.includes(query) ||
        srcAcc.includes(query) ||
        dstAcc.includes(query) ||
        note.includes(query) ||
        amountStr.includes(query) ||
        formattedAmount.includes(query)

      if (!match) return false
    }
    return true
  })

  const filteredTotal = filtered.reduce((sum, t) => sum + Number(t.amount), 0)

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
      {cameFromExpenses && (
        <button 
          onClick={() => navigate('/expenses')}
          className="flex items-center gap-1.5 text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors w-fit -mb-2 bg-indigo-500/10 border border-indigo-500/20 px-3 py-1.5 rounded-lg"
        >
          <ArrowLeft size={14} /> Volver a Plan de gastos
        </button>
      )}

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Movimientos</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {filtered.length} {filtered.length === 1 ? 'transacción' : 'transacciones'}
            {filterType !== 'all' && filterType !== 'transfer_internal' && (
              <span className="text-indigo-400 font-medium"> · Total: {formatCOP(filteredTotal)}</span>
            )}
          </p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => { setShowForm(true); setEnvelopeAlert(null); setPrefilledFields({}); }}>
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
              <CurrencyInput 
                className={clsx("input w-full", prefilledFields.amount && "opacity-60 border-slate-700/50 bg-slate-800/40 text-slate-450 hover:opacity-85 focus:opacity-100 transition-opacity")} 
                value={form.amount} 
                onChange={val => {
                  setForm(f => ({ ...f, amount: val }))
                  if (prefilledFields.amount) setPrefilledFields(prev => ({ ...prev, amount: false }))
                }} 
              />
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
                  <label className="label">Categoría (opcional)</label>
                  <select 
                    className={clsx("input w-full", prefilledFields.category_id && "opacity-60 border-slate-700/50 bg-slate-800/40 text-slate-450 hover:opacity-85 focus:opacity-100 transition-opacity")} 
                    value={showNewCategoryInput ? 'CREATE_NEW' : form.category_id} 
                    onChange={e => {
                      if (e.target.value === 'CREATE_NEW') {
                        setShowNewCategoryInput(true)
                        setShowNewConceptInput(true) // Forzar concepto nuevo para nueva categoría
                        setForm(f => ({ ...f, category_id: '', concept_id: '', expense_item_id: '' }))
                        setPrefilledFields(prev => ({ ...prev, category_id: false, concept_id: false, expense_item_id: false }))
                      } else {
                        setShowNewCategoryInput(false)
                        const catId = e.target.value
                        const matchingConcepts = concepts.filter(c => c.category_id === catId)
                        let nextConceptId = ''
                        let nextExpenseItemId = ''

                        if (matchingConcepts.length === 1) {
                          nextConceptId = matchingConcepts[0].id
                          const matchingItem = expenseItems.find(i => i.concept_id === nextConceptId)
                          if (matchingItem) {
                            nextExpenseItemId = matchingItem.id
                          }
                        }

                        setForm(f => ({ 
                          ...f, 
                          category_id: catId, 
                          concept_id: nextConceptId, 
                          expense_item_id: nextExpenseItemId 
                        }))
                        setPrefilledFields(prev => ({ ...prev, category_id: false, concept_id: false, expense_item_id: false }))
                        setShowNewConceptInput(false)
                      }
                    }}
                  >
                    <option value="">Todas las categorías</option>
                    {categories.filter(c => c.type === 'expense').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    <option value="CREATE_NEW">+ Crear nueva categoría...</option>
                  </select>
                </div>
                <div>
                  <label className="label">Concepto (opcional)</label>
                  <select 
                    className={clsx("input w-full", prefilledFields.concept_id && "opacity-60 border-slate-700/50 bg-slate-800/40 text-slate-450 hover:opacity-85 focus:opacity-100 transition-opacity")} 
                    value={showNewConceptInput ? 'CREATE_NEW' : form.concept_id} 
                    onChange={e => {
                      if (e.target.value === 'CREATE_NEW') {
                        setShowNewConceptInput(true)
                        setForm(f => ({ ...f, concept_id: '', expense_item_id: '' }))
                        setPrefilledFields(prev => ({ ...prev, concept_id: false, expense_item_id: false }))
                      } else {
                        setShowNewConceptInput(false)
                        const cid = e.target.value
                        const matching = expenseItems.find(i => i.concept_id === cid)
                        setForm(f => ({ ...f, concept_id: cid, expense_item_id: matching ? matching.id : '' }))
                        setPrefilledFields(prev => ({ ...prev, concept_id: false, expense_item_id: false }))
                      }
                    }} 
                    disabled={!form.category_id && !showNewCategoryInput}
                  >
                    <option value="">Todos los conceptos</option>
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
                      placeholder="Ej: Salud Familiar"
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
                      placeholder="Ej: Otros (o Medicinas)"
                      value={newConceptName}
                      onChange={e => setNewConceptName(e.target.value)}
                    />
                  </div>
                )}

                {!showNewCategoryInput && !showNewConceptInput && filteredExpenseItems.length > 0 && (
                  <div className="sm:col-span-2">
                    <label className="label">Gasto presupuestal</label>
                    <select 
                      className={clsx("input w-full", prefilledFields.expense_item_id && "opacity-60 border-slate-700/50 bg-slate-800/40 text-slate-450 hover:opacity-85 focus:opacity-100 transition-opacity")} 
                      value={form.expense_item_id} 
                      onChange={e => {
                        setForm(f => ({ ...f, expense_item_id: e.target.value }))
                        if (prefilledFields.expense_item_id) setPrefilledFields(prev => ({ ...prev, expense_item_id: false }))
                      }}
                    >
                      <option value="">Ninguno / Gasto no presupuestado (Otros)</option>
                      {filteredExpenseItems.map(i => {
                        const conceptName = concepts.find(c => c.id === i.concept_id)?.name || 'Desconocido'
                        if (i.expense_type === 'variable') {
                          const avail = calcEnvelopeAvailable(i.budget_amount, i.arrears_amount, 0, 0, i.executed_amount_cached, i.deferred_amount)
                          return <option key={i.id} value={i.id}>{conceptName} — Disponible: {formatCOP(avail)}</option>
                        } else {
                          const pending = Math.max(0, i.budget_amount + i.arrears_amount - i.executed_amount_cached - i.deferred_amount)
                          return <option key={i.id} value={i.id}>{conceptName} — Pendiente: {formatCOP(pending)}</option>
                        }
                      })}
                    </select>
                  </div>
                )}
              </>
            )}

            {/* Ingreso esperado */}
            {form.mode === 'income' && (
              <div className="sm:col-span-2">
                <label className="label">Ingreso esperado (opcional)</label>
                <select 
                  className={clsx("input w-full", prefilledFields.income_item_id && "opacity-60 border-slate-700/50 bg-slate-800/40 text-slate-450 hover:opacity-85 focus:opacity-100 transition-opacity")} 
                  value={form.income_item_id} 
                  onChange={e => {
                    setForm(f => ({ ...f, income_item_id: e.target.value }))
                    if (prefilledFields.income_item_id) setPrefilledFields(prev => ({ ...prev, income_item_id: false }))
                  }}
                >
                  <option value="">Ninguno / Ingreso no previsto</option>
                  {incomeItems.map(i => (
                    <option key={i.id} value={i.id}>{i.label} (Esperado: {formatCOP(i.net_expected)})</option>
                  ))}
                </select>
              </div>
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

          {/* Envelope live alert */}
          {itemAvailable !== null && selectedItem && form.amount > itemAvailable && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
              <p className="text-red-300 text-sm font-semibold">
                {selectedItem.expense_type === 'variable' ? '⚠️ Presupuesto insuficiente' : '⚠️ Pago excede el saldo'}
              </p>
              <p className="text-red-400/80 text-xs mt-1">
                {selectedItem.expense_type === 'variable'
                  ? `Faltan ${formatCOP(form.amount - itemAvailable)} en el bolsillo. El movimiento se registrará y el bolsillo quedará en rojo.`
                  : `El pago ingresado supera por ${formatCOP(form.amount - itemAvailable)} el saldo pendiente de esta obligación.`}
              </p>
            </div>
          )}

          {/* Envelope info */}
          {itemAvailable !== null && selectedItem && form.amount > 0 && (
            <div className={clsx('rounded-xl px-4 py-3 border flex items-center justify-between',
              form.amount > itemAvailable
                ? 'bg-red-500/10 border-red-500/30'
                : selectedItem.expense_type === 'variable'
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : 'bg-orange-500/10 border-orange-500/30'
            )}>
              <span className="text-sm text-slate-300">
                {selectedItem.expense_type === 'variable' ? 'Disponible en el bolsillo' : 'Pendiente de pago'}
              </span>
              <span className={clsx('font-semibold',
                form.amount > itemAvailable
                  ? 'text-red-400'
                  : selectedItem.expense_type === 'variable'
                    ? 'text-emerald-400'
                    : 'text-orange-400'
              )}>
                {formatCOP(itemAvailable)}
              </span>
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <button className="btn-ghost" onClick={() => { setShowForm(false); setEnvelopeAlert(null); setPrefilledFields({}); }}>Cancelar</button>
            <button
              className="btn-primary"
              disabled={
                form.amount <= 0 || 
                saveTransaction.isPending || 
                (form.mode === 'adjustment' && !form.note.trim()) ||
                (form.mode === 'expense' && showNewCategoryInput && !newCategoryName.trim()) ||
                (form.mode === 'expense' && showNewConceptInput && !newConceptName.trim())
              }
              onClick={() => saveTransaction.mutate()}
            >
              {saveTransaction.isPending ? 'Guardando...' : 'Registrar movimiento'}
            </button>
          </div>
        </div>
      )}

      {/* Search Bar */}
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input 
          type="text"
          placeholder="Buscar por concepto, categoría, nota o valor (ej: 47.600)..."
          className="input pl-10 pr-4 py-2 w-full bg-slate-800/50 border-slate-750 text-white placeholder-slate-500 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm transition-all"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex gap-2 flex-wrap">
          {['all', 'expense', 'unbudgeted', 'income', 'transfer_internal', 'tax_4x1000'].map(t => (
            <button key={t} onClick={() => setFilterType(t)}
              className={clsx('text-xs px-3 py-1.5 rounded-full border transition-all', filterType === t ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-slate-700 text-slate-400 hover:text-white')}>
              {t === 'all' ? 'Todos' : t === 'tax_4x1000' ? '4×1000' : t === 'unbudgeted' ? 'No presupuestados (Otros)' : MODE_LABELS[t as TxMode] ?? t}
            </button>
          ))}
        </div>
        <div>
          <select 
            className="input py-1.5 px-3 text-xs w-full sm:w-48 bg-slate-800 border-slate-700 text-white rounded-full focus:ring-indigo-500 focus:border-indigo-500"
            value={accountFilter}
            onChange={e => setAccountFilter(e.target.value)}
          >
            <option value="all">Todas las cuentas</option>
            {accounts.map(acc => (
              <option key={acc.id} value={acc.id}>{acc.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* List */}
      {isLoading && <div className="card text-center text-slate-500 py-8">Cargando...</div>}
      <div className="space-y-2">
        {filtered.map(tx => {
          const catName = categories.find(c => c.id === tx.category_id)?.name
          const conName = concepts.find(c => c.id === tx.concept_id)?.name
          const srcAcc = accounts.find(a => a.id === tx.source_account_id)?.name
          const dstAcc = accounts.find(a => a.id === tx.destination_account_id)?.name
          // Determine sign and color based on perspective (selected account)
          let sign = ''
          let colorClass = 'text-slate-300'
          if (tx.type === 'transfer_internal') {
            if (accountFilter === tx.source_account_id) {
              sign = '-'
              colorClass = 'text-red-400'
            } else if (accountFilter === tx.destination_account_id) {
              sign = '+'
              colorClass = 'text-emerald-400'
            } else {
              // Neutral if no account is filtered
              sign = ''
              colorClass = 'text-slate-400'
            }
          } else {
            const isDebit = ['expense', 'transfer_external_out', 'tax_4x1000', 'adjustment'].includes(tx.type)
            sign = isDebit ? '-' : '+'
            colorClass = isDebit ? 'text-red-400' : 'text-emerald-400'
          }

          return (
            <div key={tx.id} className="card p-0 overflow-hidden">
              <div 
                className={clsx('flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-slate-800/30 transition-colors', tx.is_automatic ? 'bg-amber-500/5' : '')}
                onClick={() => {
                  if (expandedTxId === tx.id) {
                    setExpandedTxId(null)
                    setEditForm(null)
                  } else {
                    setExpandedTxId(tx.id)
                    setEditForm({
                      id: tx.id,
                      amount: tx.amount,
                      date: tx.date,
                      note: tx.note || '',
                      category_id: tx.category_id || '',
                      concept_id: tx.concept_id || '',
                      expense_item_id: tx.expense_item_id || '',
                      source_account_id: tx.source_account_id || '',
                      destination_account_id: tx.destination_account_id || '',
                      external_party_label: tx.external_party_label || '',
                      income_item_id: tx.income_item_id || '',
                    })
                  }
                }}
              >
                <div className="flex-shrink-0">{TX_ICON[tx.type]}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-slate-200 text-sm font-medium">
                      {tx.note || conName || (catName ? `${catName} (Otros)` : MODE_LABELS[tx.type as TxMode] ?? tx.type)}
                    </p>
                    {tx.is_automatic && <span className="text-xs px-1.5 py-0.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded">Auto</span>}
                  </div>
                  <p className="text-slate-500 text-xs mt-0.5">
                    {tx.date} {srcAcc && `· ${srcAcc}`}{dstAcc && ` → ${dstAcc}`}{catName && ` · ${catName}`}
                  </p>
                </div>
                <div className="text-right flex-shrink-0 flex items-center gap-3">
                  <p className={clsx('font-semibold text-sm', colorClass)}>
                    {sign}{formatCOP(tx.amount)}
                  </p>
                  <ChevronDown size={15} className={clsx('text-slate-500 transition-transform', expandedTxId === tx.id && 'rotate-180')} />
                </div>
              </div>

              {expandedTxId === tx.id && editForm && (
                <div className="border-t border-slate-800 px-4 py-4 bg-slate-900/50 space-y-4">
                  {!tx.is_automatic ? (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs text-slate-400 block mb-1">Monto</label>
                          <CurrencyInput className="input w-full px-3 py-1.5 text-sm bg-slate-800 border-slate-700 text-white" 
                            value={editForm.amount} 
                            onChange={val => setEditForm({ ...editForm, amount: val })}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 block mb-1">Fecha</label>
                          <input type="date" className="input w-full px-3 py-1.5 text-sm bg-slate-800 border-slate-700 text-white" 
                            value={editForm.date} 
                            onChange={e => setEditForm({ ...editForm, date: e.target.value })}
                          />
                        </div>

                        {/* Cuenta origen */}
                        {['expense', 'transfer_internal', 'transfer_external_out', 'adjustment'].includes(tx.type) && (
                          <div>
                            <label className="text-xs text-slate-400 block mb-1">Cuenta origen</label>
                            <select className="input w-full px-3 py-1.5 text-sm bg-slate-800 border-slate-700 text-white" 
                              value={editForm.source_account_id} 
                              onChange={e => setEditForm({ ...editForm, source_account_id: e.target.value })}
                            >
                              <option value="">Seleccionar...</option>
                              {internalAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </select>
                          </div>
                        )}

                        {/* Cuenta destino */}
                        {['income', 'transfer_internal', 'transfer_external_in'].includes(tx.type) && (
                          <div>
                            <label className="text-xs text-slate-400 block mb-1">Cuenta destino</label>
                            <select className="input w-full px-3 py-1.5 text-sm bg-slate-800 border-slate-700 text-white" 
                              value={editForm.destination_account_id} 
                              onChange={e => setEditForm({ ...editForm, destination_account_id: e.target.value })}
                            >
                              <option value="">Seleccionar...</option>
                              {internalAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </select>
                          </div>
                        )}

                        {/* Ingreso esperado (solo para ingresos) */}
                        {tx.type === 'income' && (
                          <div className="sm:col-span-2">
                            <label className="text-xs text-slate-400 block mb-1">Ingreso esperado (opcional)</label>
                            <select className="input w-full px-3 py-1.5 text-sm bg-slate-800 border-slate-700 text-white" 
                              value={editForm.income_item_id} 
                              onChange={e => setEditForm({ ...editForm, income_item_id: e.target.value })}
                            >
                              <option value="">Ninguno / Ingreso no previsto</option>
                              {incomeItems.map(i => (
                                <option key={i.id} value={i.id}>{i.label} (Esperado: {formatCOP(i.net_expected)})</option>
                              ))}
                            </select>
                          </div>
                        )}

                        {/* Categoría + Concepto (solo para gastos) */}
                        {tx.type === 'expense' && (
                          <>
                            <div>
                              <label className="text-xs text-slate-400 block mb-1">Categoría (opcional)</label>
                              <select className="input w-full px-3 py-1.5 text-sm bg-slate-800 border-slate-700 text-white" 
                                value={editForm.category_id} 
                                onChange={e => {
                                  const catId = e.target.value
                                  const matchingConcepts = concepts.filter(c => c.category_id === catId)
                                  let nextConceptId = ''
                                  let nextExpenseItemId = ''

                                  if (matchingConcepts.length === 1) {
                                    nextConceptId = matchingConcepts[0].id
                                    const matchingItem = expenseItems.find(i => i.concept_id === nextConceptId)
                                    if (matchingItem) {
                                      nextExpenseItemId = matchingItem.id
                                    }
                                  }

                                  setEditForm({ 
                                    ...editForm, 
                                    category_id: catId, 
                                    concept_id: nextConceptId, 
                                    expense_item_id: nextExpenseItemId 
                                  })
                                }}
                              >
                                <option value="">Todas las categorías</option>
                                {categories.filter(c => c.type === 'expense').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-slate-400 block mb-1">Concepto (opcional)</label>
                              <select className="input w-full px-3 py-1.5 text-sm bg-slate-800 border-slate-700 text-white" 
                                value={editForm.concept_id} 
                                onChange={e => {
                                  const cid = e.target.value
                                  const matching = expenseItems.find(i => i.concept_id === cid)
                                  setEditForm({ ...editForm, concept_id: cid, expense_item_id: matching ? matching.id : '' })
                                }} 
                                disabled={!editForm.category_id}
                              >
                                <option value="">Todos los conceptos</option>
                                {concepts.filter(c => c.category_id === editForm.category_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                              </select>
                            </div>

                            <div className="sm:col-span-2">
                              <label className="text-xs text-slate-400 block mb-1">Gasto presupuestal</label>
                              <select className="input w-full px-3 py-1.5 text-sm bg-slate-800 border-slate-700 text-white" 
                                value={editForm.expense_item_id} 
                                onChange={e => setEditForm({ ...editForm, expense_item_id: e.target.value })}
                              >
                                <option value="">Ninguno / Gasto no presupuestado (Otros)</option>
                                {expenseItems.filter(i => 
                                  (!editForm.concept_id || i.concept_id === editForm.concept_id) &&
                                  (!editForm.category_id || i.category_id === editForm.category_id)
                                ).map(i => {
                                  const conceptName = concepts.find(c => c.id === i.concept_id)?.name || 'Desconocido'
                                  if (i.expense_type === 'variable') {
                                    const avail = calcEnvelopeAvailable(i.budget_amount, i.arrears_amount, 0, 0, i.executed_amount_cached, i.deferred_amount)
                                    return <option key={i.id} value={i.id}>{conceptName} — Disponible: {formatCOP(avail)}</option>
                                  } else {
                                    const pending = Math.max(0, i.budget_amount + i.arrears_amount - i.executed_amount_cached - i.deferred_amount)
                                    return <option key={i.id} value={i.id}>{conceptName} — Pendiente: {formatCOP(pending)}</option>
                                  }
                                })}
                              </select>
                            </div>
                          </>
                        )}

                        <div className="sm:col-span-2">
                          <label className="text-xs text-slate-400 block mb-1">Nota (opcional)</label>
                          <input type="text" className="input w-full px-3 py-1.5 text-sm bg-slate-800 border-slate-700 text-white" 
                            value={editForm.note} 
                            onChange={e => setEditForm({ ...editForm, note: e.target.value })}
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 mt-4">
                        <button 
                          className="text-xs flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm('¿Seguro que deseas eliminar este movimiento?\nEl dinero será devuelto a tu cuenta y gasto correspondiente.')) {
                              deleteTx.mutate(tx)
                            }
                          }}
                        >
                          <Trash2 size={14} /> Eliminar movimiento
                        </button>

                        <div className="flex items-center gap-2">
                          <button className="btn-ghost text-xs py-1.5 px-3" onClick={() => { setExpandedTxId(null); setEditForm(null) }}>Cancelar</button>
                          <button className="btn-primary text-xs py-1.5 px-4" disabled={updateTxFull.isPending} onClick={() => updateTxFull.mutate({ oldTx: tx, newValues: editForm })}>
                            {updateTxFull.isPending ? 'Guardando...' : 'Guardar cambios'}
                          </button>
                        </div>
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
