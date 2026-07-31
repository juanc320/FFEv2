import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useAuth } from '@/features/auth/AuthContext'
import { useActiveMonth } from '@/features/months/MonthsPage'
import type { MonthlyExpenseItem, Category, Concept, Account } from '@/shared/types/database'
import { formatCOP } from '@/shared/utils/calculations'
import { CurrencyInput } from '@/shared/components/CurrencyInput'
import {
  Bell,
  ChevronDown,
  ChevronUp,
  Search,
  X,
  CheckCircle2,
  Calendar as CalendarIcon,
  Tag as TagIcon,
  CreditCard,
  Building2,
  Receipt,
  LayoutDashboard,
  BarChart3,
  User,
  Check,
  AlertCircle,
  Clock,
  ArrowUpRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Trash2,
  Pencil,
  GripVertical,
} from 'lucide-react'
import clsx from 'clsx'

// Type helpers for status
function getObligationStatus(item: MonthlyExpenseItem) {
  const totalDue = item.budget_amount + item.arrears_amount
  const executed = item.executed_amount_cached
  const remaining = Math.max(totalDue - executed - item.deferred_amount, 0)

  if (totalDue === 0) {
    return { key: 'none', label: 'Sin asignar', dotColor: 'bg-slate-400', textColor: 'text-slate-400', badgeBg: 'bg-slate-800/60 border-slate-700/50' }
  }
  if (item.postponed) {
    return { key: 'postponed', label: 'Pospuesto', dotColor: 'bg-slate-500', textColor: 'text-slate-400', badgeBg: 'bg-slate-800/60 border-slate-700/50' }
  }
  if (executed >= totalDue) {
    return { key: 'paid', label: 'Pagado', dotColor: 'bg-emerald-500', textColor: 'text-emerald-400', badgeBg: 'bg-emerald-500/10 border-emerald-500/30' }
  }
  if (executed > 0) {
    return { key: 'partial', label: 'Parcial', dotColor: 'bg-amber-500', textColor: 'text-amber-400', badgeBg: 'bg-amber-500/10 border-amber-500/30' }
  }
  return { key: 'pending', label: 'Pendiente', dotColor: 'bg-red-500', textColor: 'text-red-400', badgeBg: 'bg-red-500/10 border-red-500/30' }
}

export default function PaymentPlanCopyPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const qc = useQueryClient()
  const { data: activeMonth } = useActiveMonth()

  // Main Tab: 'obligations' (Fixed & Sporadic) or 'envelopes' (Variable)
  const [activeTab, setActiveTab] = useState<'obligations' | 'envelopes'>('obligations')

  // Search & Filter & Sort state
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<string>('all')
  const [dueDateSort, setDueDateSort] = useState<'auto' | 'asc' | 'desc' | 'none'>('auto')

  // Drag & drop state for custom reordering
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null)
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null)

  // Persist custom drag order to Supabase database (synced across all devices)
  async function saveCustomOrder(newOrderIds: string[]) {
    try {
      const updates = newOrderIds.map((id, index) =>
        db.from('monthly_expense_items').update({ sort_order: index + 1 }).eq('id', id)
      )
      await Promise.all(updates)
      qc.invalidateQueries({ queryKey: ['expense_items'] })
    } catch (err) {
      console.error('Error al guardar el orden en la base de datos:', err)
    }
  }

  function handleDragStart(e: React.DragEvent, id: string) {
    setDraggedItemId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (draggedItemId && draggedItemId !== id) {
      setDragOverItemId(id)
    }
  }

  async function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault()
    setDragOverItemId(null)

    if (!draggedItemId || draggedItemId === targetId) return

    const currentIds = filteredItems.map(i => i.id)
    const fromIndex = currentIds.indexOf(draggedItemId)
    const toIndex = currentIds.indexOf(targetId)

    if (fromIndex !== -1 && toIndex !== -1) {
      const updated = [...currentIds]
      const [moved] = updated.splice(fromIndex, 1)
      updated.splice(toIndex, 0, moved)

      await saveCustomOrder(updated)
      setDueDateSort('auto')
    }

    setDraggedItemId(null)
  }

  // Bottom sheet filter modals for mobile
  const [activeBottomSheet, setActiveBottomSheet] = useState<'category' | 'status' | 'account' | 'sort' | null>(null)

  // Accordion card expanded state
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Inline budget_amount editing state inside expanded card
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null)
  const [editingBudgetVal, setEditingBudgetVal] = useState<number>(0)

  // Payment form inside expanded card
  const [payAmountMode, setPayAmountMode] = useState<'full' | 'custom'>('full')
  const [payCustomAmount, setPayCustomAmount] = useState<number>(0)
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submittingItemId, setSubmittingItemId] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Queries
  const { data: items = [], isLoading } = useQuery({
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

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', profile?.family_id],
    queryFn: async () => {
      const { data } = await supabase.from('categories').select('*').eq('family_id', profile!.family_id!).eq('active', true)
      return (data ?? []) as Category[]
    },
    enabled: !!profile?.family_id,
  })

  const { data: concepts = [] } = useQuery({
    queryKey: ['concepts', profile?.family_id],
    queryFn: async () => {
      const { data } = await supabase.from('concepts').select('*').eq('family_id', profile!.family_id!).eq('active', true)
      return (data ?? []) as Concept[]
    },
    enabled: !!profile?.family_id,
  })

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', profile?.family_id],
    queryFn: async (): Promise<Account[]> => {
      const { data } = await supabase.from('accounts').select('*').eq('family_id', profile!.family_id!).eq('active', true).eq('is_internal', true)
      return (data ?? []) as Account[]
    },
    enabled: !!profile?.family_id,
  })



  // Category map helper
  const categoryMap = useMemo(() => {
    const map = new Map<string, Category>()
    categories.forEach(c => map.set(c.id, c))
    return map
  }, [categories])

  const conceptMap = useMemo(() => {
    const map = new Map<string, Concept>()
    concepts.forEach(c => map.set(c.id, c))
    return map
  }, [concepts])

  // Filter items by Tab, Search, Category, Status
  const filteredItems = useMemo(() => {
    const list = items.filter(item => {
      // Tab filter
      if (activeTab === 'obligations') {
        if (item.expense_type === 'variable') return false
      } else {
        if (item.expense_type !== 'variable') return false
      }

      // Category filter
      if (selectedCategory !== 'all' && item.category_id !== selectedCategory) {
        return false
      }

      // Status filter
      const status = getObligationStatus(item)
      if (selectedStatus !== 'all' && status.key !== selectedStatus) {
        return false
      }

      // Search query
      if (searchQuery.trim()) {
        const catName = categoryMap.get(item.category_id)?.name.toLowerCase() || ''
        const conName = conceptMap.get(item.concept_id)?.name.toLowerCase() || ''
        const query = searchQuery.toLowerCase()
        if (!catName.includes(query) && !conName.includes(query)) {
          return false
        }
      }

      return true
    })

    // Sort Logic: If 'auto', use DB sort_order if present, otherwise default to due_date asc
    const hasDbCustomOrder = list.some(item => typeof item.sort_order === 'number' && item.sort_order > 0)

    if (dueDateSort === 'auto') {
      if (hasDbCustomOrder) {
        list.sort((a, b) => {
          const orderA = typeof a.sort_order === 'number' && a.sort_order > 0 ? a.sort_order : 9999
          const orderB = typeof b.sort_order === 'number' && b.sort_order > 0 ? b.sort_order : 9999
          return orderA - orderB
        })
      } else {
        list.sort((a, b) => {
          if (!a.due_date) return 1
          if (!b.due_date) return -1
          return a.due_date.localeCompare(b.due_date)
        })
      }
    } else if (dueDateSort === 'asc') {
      list.sort((a, b) => {
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return a.due_date.localeCompare(b.due_date)
      })
    } else if (dueDateSort === 'desc') {
      list.sort((a, b) => {
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return b.due_date.localeCompare(a.due_date)
      })
    }

    return list
  }, [items, activeTab, selectedCategory, selectedStatus, searchQuery, dueDateSort, categoryMap, conceptMap])

  // Toggle card expansion
  function handleCardToggle(item: MonthlyExpenseItem) {
    if (expandedId === item.id) {
      setExpandedId(null)
    } else {
      const totalDue = item.budget_amount + item.arrears_amount
      const remaining = Math.max(totalDue - item.executed_amount_cached - item.deferred_amount, 0)
      setExpandedId(item.id)
      setPayAmountMode('full')
      setPayCustomAmount(remaining)
      setActionMessage(null)
    }
  }

  // 1-Tap Direct Full Payment from Collapsed Card
  async function handleDirectFullPayment(e: React.MouseEvent, item: MonthlyExpenseItem) {
    e.stopPropagation() // Don't expand/collapse card
    const accId = selectedAccountId || null

    const totalDue = item.budget_amount + item.arrears_amount
    const remaining = Math.max(totalDue - item.executed_amount_cached - item.deferred_amount, 0)

    if (remaining <= 0) return

    setSubmittingItemId(item.id)
    setIsSubmitting(true)

    try {
      const conceptObj = conceptMap.get(item.concept_id)
      const categoryObj = categoryMap.get(item.category_id)
      const noteLabel = `Pago Total ${conceptObj?.name || categoryObj?.name || 'Obligación'}`

      // 1. Create transaction (source_account_id is null if no account selected)
      const { error: txErr } = await db
        .from('transactions')
        .insert({
          family_id: profile!.family_id,
          month_id: activeMonth!.id,
          type: 'expense',
          amount: remaining,
          tax_amount: 0,
          source_account_id: accId,
          category_id: item.category_id,
          concept_id: item.concept_id,
          expense_item_id: item.id,
          date: new Date().toISOString().split('T')[0],
          note: noteLabel,
          created_by: profile!.id,
        })

      if (txErr) throw txErr

      // 2. Update account balance ONLY if a specific account was selected
      if (accId) {
        const accountObj = accounts.find(a => a.id === accId)
        if (accountObj) {
          const newBalance = accountObj.current_balance_cached - remaining
          await db.from('accounts').update({ current_balance_cached: newBalance }).eq('id', accId)
        }
      }

      // 3. Update expense item executed_amount_cached
      const newExecuted = item.executed_amount_cached + remaining
      await db.from('monthly_expense_items').update({ executed_amount_cached: newExecuted }).eq('id', item.id)

      // Invalidate queries
      qc.invalidateQueries({ queryKey: ['expense_items'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
    } catch (err: any) {
      alert(err.message || 'Error al procesar el pago.')
    } finally {
      setIsSubmitting(false)
      setSubmittingItemId(null)
    }
  }

  // Submit payment from Expanded View
  async function handleConfirmPayment(item: MonthlyExpenseItem) {
    const accId = selectedAccountId || null

    const totalDue = item.budget_amount + item.arrears_amount
    const remaining = Math.max(totalDue - item.executed_amount_cached - item.deferred_amount, 0)
    const amountToPay = payAmountMode === 'full' ? remaining : payCustomAmount

    if (amountToPay <= 0) {
      setActionMessage({ type: 'error', text: 'Ingresa un monto válido mayor a 0 COP.' })
      return
    }

    setIsSubmitting(true)
    setSubmittingItemId(item.id)
    setActionMessage(null)

    try {
      const conceptObj = conceptMap.get(item.concept_id)
      const categoryObj = categoryMap.get(item.category_id)
      const noteLabel = `Pago ${conceptObj?.name || categoryObj?.name || 'Obligación'}`

      // 1. Create transaction record (source_account_id is null if no account selected)
      const { error: txErr } = await db
        .from('transactions')
        .insert({
          family_id: profile!.family_id,
          month_id: activeMonth!.id,
          type: 'expense',
          amount: amountToPay,
          tax_amount: 0,
          source_account_id: accId,
          category_id: item.category_id,
          concept_id: item.concept_id,
          expense_item_id: item.id,
          date: new Date().toISOString().split('T')[0],
          note: noteLabel,
          created_by: profile!.id,
        })

      if (txErr) throw txErr

      // 2. Update account current_balance_cached ONLY if a specific account was selected
      if (accId) {
        const accountObj = accounts.find(a => a.id === accId)
        if (accountObj) {
          const newBalance = accountObj.current_balance_cached - amountToPay
          await db.from('accounts').update({ current_balance_cached: newBalance }).eq('id', accId)
        }
      }

      // 3. Update expense item executed_amount_cached
      const newExecuted = item.executed_amount_cached + amountToPay
      await db.from('monthly_expense_items').update({ executed_amount_cached: newExecuted }).eq('id', item.id)

      // Invalidate queries
      qc.invalidateQueries({ queryKey: ['expense_items'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })

      setActionMessage({ type: 'success', text: `¡Pago registrado exitosamente de ${formatCOP(amountToPay)}!` })
      setTimeout(() => {
        setExpandedId(null)
      }, 1200)
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Error al procesar el pago.' })
    } finally {
      setIsSubmitting(false)
      setSubmittingItemId(null)
    }
  }

  // Delete item from current month (limpiando transacciones y reasignaciones asociadas)
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // 1. Revertir saldo en cuentas bancarias si hubo transacciones asociadas
      const { data: itemTxList } = await db.from('transactions').select('*').eq('expense_item_id', id)

      if (itemTxList && itemTxList.length > 0) {
        for (const tx of itemTxList) {
          if (tx.source_account_id && Number(tx.amount) > 0) {
            const { data: accountObj } = await db.from('accounts').select('current_balance_cached').eq('id', tx.source_account_id).maybeSingle()
            if (accountObj) {
              const refundedBalance = (Number(accountObj.current_balance_cached) || 0) + Number(tx.amount)
              await db.from('accounts').update({ current_balance_cached: refundedBalance }).eq('id', tx.source_account_id)
            }
          }
        }
        // Eliminar las transacciones asociadas
        await db.from('transactions').delete().eq('expense_item_id', id)
      }

      // 2. Eliminar reasignaciones presupuestales dependientes
      await db.from('budget_reallocations').delete().or(`from_expense_item_id.eq.${id},to_expense_item_id.eq.${id}`)

      // 3. Eliminar la obligación / sobre de la tabla principal
      const { error } = await db.from('monthly_expense_items').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense_items'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      setExpandedId(null)
    },
    onError: (err: any) => {
      alert(err.message || 'Error al eliminar el ítem del plan de pagos.')
    },
  })

  function handleDeleteItem(item: MonthlyExpenseItem) {
    const conceptObj = conceptMap.get(item.concept_id)
    const categoryObj = categoryMap.get(item.category_id)
    const title = conceptObj?.name || categoryObj?.name || 'esta obligación'

    if (window.confirm(`¿Estás seguro de eliminar "${title}" del plan de pagos de este mes?`)) {
      deleteMutation.mutate(item.id)
    }
  }

  // Update budget_amount (valor inicial) for an item
  const updateBudgetMutation = useMutation({
    mutationFn: async ({ id, newAmount }: { id: string; newAmount: number }) => {
      const { error } = await db.from('monthly_expense_items').update({ budget_amount: newAmount }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense_items'] })
      setEditingBudgetId(null)
    },
    onError: (err: any) => {
      alert(err.message || 'Error al actualizar el valor inicial del presupuesto.')
    },
  })

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-24 lg:pb-10">
      {/* Contenedor amplio para PC (max-w-6xl) con márgenes equilibrados */}
      <div className="max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 pt-3 sm:pt-6 space-y-4">
        
        {/* 1. Segmented Control / Toggle Pills (Obligaciones vs. Sobres) */}
        <div className="bg-slate-900/90 p-1 rounded-xl border border-slate-800 flex gap-1 shadow-md backdrop-blur-md">
          <button
            onClick={() => {
              setActiveTab('obligations')
              setExpandedId(null)
            }}
            className={clsx(
              'flex-1 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-1.5',
              activeTab === 'obligations'
                ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50',
            )}
          >
            <Receipt size={15} />
            <span>Obligaciones</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('envelopes')
              setExpandedId(null)
            }}
            className={clsx(
              'flex-1 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-1.5',
              activeTab === 'envelopes'
                ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50',
            )}
          >
            <Building2 size={15} />
            <span>Sobres</span>
          </button>
        </div>

        {/* 2. Filters & Search Bar (Horizontal Toolbar en PC) */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          {/* Search box */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar obligación o categoría..."
              className="w-full bg-slate-900/80 border border-slate-800 text-white rounded-xl pl-8 pr-7 py-2 text-xs sm:text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Quick Filter Chips (Category & Date/Status & Account) */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 sm:pb-0 scrollbar-none flex-shrink-0">
            {/* Category Filter Button */}
            <button
              onClick={() => setActiveBottomSheet('category')}
              className={clsx(
                'flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-medium border transition-colors flex-shrink-0',
                selectedCategory !== 'all'
                  ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/50'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white',
              )}
            >
              <TagIcon size={12} />
              <span>
                {selectedCategory === 'all'
                  ? 'Categoría'
                  : categoryMap.get(selectedCategory)?.name || 'Categoría'}
              </span>
              <ChevronDown size={12} className="opacity-70" />
            </button>

            {/* Status Filter Button */}
            <button
              onClick={() => setActiveBottomSheet('status')}
              className={clsx(
                'flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-medium border transition-colors flex-shrink-0',
                selectedStatus !== 'all'
                  ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/50'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white',
              )}
            >
              <CalendarIcon size={12} />
              <span>
                {selectedStatus === 'all'
                  ? 'Estado'
                  : selectedStatus === 'pending'
                  ? '🔴 Pendiente'
                  : selectedStatus === 'partial'
                  ? '🟡 Parcial'
                  : '🟢 Pagado'}
              </span>
              <ChevronDown size={12} className="opacity-70" />
            </button>

            {/* Account Selector Filter Button */}
            <button
              onClick={() => setActiveBottomSheet('account')}
              className={clsx(
                'flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-medium border transition-colors flex-shrink-0',
                selectedAccountId !== ''
                  ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/50'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-white',
              )}
            >
              <CreditCard size={12} />
              <span>
                {selectedAccountId === ''
                  ? 'Sin cuenta (No descontar)'
                  : accounts.find(a => a.id === selectedAccountId)?.name || 'Cuenta'}
              </span>
              <ChevronDown size={12} className="opacity-70" />
            </button>

            {/* Date Sort Filter Button */}
            <button
              onClick={() => setActiveBottomSheet('sort')}
              className={clsx(
                'flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-medium border transition-colors flex-shrink-0',
                dueDateSort !== 'auto'
                  ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/50'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white',
              )}
            >
              {dueDateSort === 'auto' ? (
                <ArrowUp size={12} className="text-indigo-400" />
              ) : dueDateSort === 'asc' ? (
                <ArrowUp size={12} className="text-indigo-400" />
              ) : dueDateSort === 'desc' ? (
                <ArrowDown size={12} className="text-indigo-400" />
              ) : (
                <ArrowUpDown size={12} />
              )}
              <span>
                {dueDateSort === 'auto'
                  ? 'Predeterminado'
                  : dueDateSort === 'asc'
                  ? 'Fecha ⬆ (Próximos)'
                  : dueDateSort === 'desc'
                  ? 'Fecha ⬇ (Lejanos)'
                  : 'Orden Fecha'}
              </span>
              <ChevronDown size={12} className="opacity-70" />
            </button>

            {/* Reset Filters button if active */}
            {(selectedCategory !== 'all' || selectedStatus !== 'all' || searchQuery || dueDateSort !== 'asc') && (
              <button
                onClick={() => {
                  setSelectedCategory('all')
                  setSelectedStatus('all')
                  setDueDateSort('asc')
                  setSearchQuery('')
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-slate-400 hover:text-rose-400 hover:bg-slate-900 transition-colors flex-shrink-0"
              >
                <X size={11} />
                <span>Limpiar</span>
              </button>
            )}
          </div>
        </div>

        {/* 3. Obligation Cards List */}
        {isLoading ? (
          <div className="py-8 text-center text-slate-500 space-y-2">
            <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs">Cargando compromisos del mes...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 text-center space-y-2">
            <Receipt className="w-7 h-7 text-slate-600 mx-auto" />
            <p className="text-white font-medium text-xs sm:text-sm">No se encontraron compromisos</p>
            <p className="text-slate-400 text-[11px] max-w-sm mx-auto">
              {searchQuery || selectedCategory !== 'all' || selectedStatus !== 'all'
                ? 'Intenta ajustar los filtros o el término de búsqueda.'
                : 'No hay obligaciones o sobres registrados para este mes activo.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredItems.map(item => {
              const status = getObligationStatus(item)
              const conceptObj = conceptMap.get(item.concept_id)
              const categoryObj = categoryMap.get(item.category_id)
              const title = conceptObj?.name || categoryObj?.name || 'Obligación sin nombre'
              const totalDue = item.budget_amount + item.arrears_amount
              const executed = item.executed_amount_cached
              const remaining = Math.max(totalDue - executed - item.deferred_amount, 0)
              const isExpanded = expandedId === item.id
              const isItemSubmitting = isSubmitting && submittingItemId === item.id

              return (
                <div
                  key={item.id}
                  draggable
                  onDragStart={e => handleDragStart(e, item.id)}
                  onDragOver={e => handleDragOver(e, item.id)}
                  onDrop={e => handleDrop(e, item.id)}
                  onDragEnd={() => {
                    setDraggedItemId(null)
                    setDragOverItemId(null)
                  }}
                  className={clsx(
                    'bg-slate-900/90 border rounded-xl transition-all duration-200 overflow-hidden shadow-xs',
                    isExpanded ? 'border-indigo-500/50 ring-1 ring-indigo-500/30' : 'border-slate-800/80 hover:border-slate-700',
                    status.key === 'paid' && !isExpanded && 'opacity-75',
                    dragOverItemId === item.id && 'border-indigo-400 ring-2 ring-indigo-500/50 scale-[1.01]',
                    draggedItemId === item.id && 'opacity-40 border-dashed border-indigo-400',
                  )}
                >
                  {/* Collapsed Header View: Grilla estructurada de 12 columnas en PC (sm:grid-cols-12), vista compacta en móvil */}
                  <div
                    onClick={() => handleCardToggle(item)}
                    className="px-3 py-3 sm:px-4 sm:py-3.5 cursor-pointer select-none"
                  >
                    {/* PC View (sm:grid 12 columnas perfectamente distribuidas: 3-2-2-5) */}
                    <div className="hidden sm:grid sm:grid-cols-12 items-center gap-3 w-full">
                      {/* Col 1: Grip + Icon + Title + Category (3 cols) */}
                      <div className="col-span-3 flex items-center gap-2.5 min-w-0">
                        <div
                          className="cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-300 p-1 rounded transition-colors flex-shrink-0"
                          title="Arrastrar para reordenar"
                          onClick={e => e.stopPropagation()}
                        >
                          <GripVertical size={14} />
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-slate-800/80 border border-slate-700/80 flex items-center justify-center flex-shrink-0">
                          <CreditCard className="w-4 h-4 text-indigo-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-white font-semibold text-xs sm:text-sm leading-tight truncate" title={title}>
                            {title}
                          </h3>
                          <p className="text-slate-400 text-[11px] truncate mt-0.5">
                            {categoryObj?.name || 'Obligación'}
                          </p>
                        </div>
                      </div>

                      {/* Col 2: Vencimiento (2 cols) */}
                      <div className="col-span-2 text-left">
                        {remaining > 0 && item.due_date ? (
                          <div>
                            <p className="text-slate-500 text-[10px] uppercase font-medium tracking-wider">Vencimiento</p>
                            <p className="text-slate-300 text-xs font-medium flex items-center gap-1 mt-0.5">
                              <Clock size={11} className="text-slate-500" />
                              {item.due_date}
                            </p>
                          </div>
                        ) : (
                          <span className="text-slate-600 text-xs font-medium">-</span>
                        )}
                      </div>

                      {/* Col 3: Monto Pendiente (2 cols) */}
                      <div className="col-span-2 text-right">
                        {remaining > 0 ? (
                          <div>
                            <p className="text-slate-500 text-[10px] uppercase font-medium tracking-wider">Pendiente</p>
                            <p className="text-white font-bold text-sm tracking-tight">{formatCOP(remaining)}</p>
                          </div>
                        ) : (
                          <div>
                            <p className="text-slate-500 text-[10px] uppercase font-medium tracking-wider">Saldo</p>
                            <p className="text-slate-400 text-xs font-medium">{formatCOP(0)}</p>
                          </div>
                        )}
                      </div>

                      {/* Col 4 & 5: Estado Badge + Botón Marcar Pagado + Chevron (5 cols amplias sin solapamiento) */}
                      <div className="col-span-5 flex items-center justify-end gap-2.5 min-w-0">
                        <span className={clsx('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border flex-shrink-0 whitespace-nowrap', status.badgeBg)}>
                          <span className={clsx('w-1.5 h-1.5 rounded-full', status.dotColor)} />
                          <span className={status.textColor}>{status.label}</span>
                        </span>

                        {remaining > 0 && (
                          <button
                            type="button"
                            disabled={isItemSubmitting}
                            onClick={e => handleDirectFullPayment(e, item)}
                            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs px-3 py-1.5 rounded-lg shadow-xs shadow-indigo-600/30 flex items-center gap-1 transition-all flex-shrink-0 whitespace-nowrap"
                            title="Marcar como Pagado directamente"
                          >
                            <span>{isItemSubmitting ? 'Guardando...' : 'Marcar Pagado'}</span>
                            <ArrowUpRight size={13} />
                          </button>
                        )}

                        <div className="text-slate-400 hover:text-white p-1.5 rounded-lg bg-slate-800/40 border border-slate-700/50 flex-shrink-0">
                          {isExpanded ? <ChevronUp size={15} className="text-indigo-400" /> : <ChevronDown size={15} />}
                        </div>
                      </div>
                    </div>

                    {/* Mobile View (sm:hidden): Optimizado para toques y thumb-zone */}
                    <div className="sm:hidden space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0 flex-1">
                          <div
                            className="cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-300 p-0.5 mt-0.5 flex-shrink-0"
                            title="Arrastrar para reordenar"
                            onClick={e => e.stopPropagation()}
                          >
                            <GripVertical size={14} />
                          </div>
                          <div className="w-7 h-7 rounded-lg bg-slate-800/80 border border-slate-700/80 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <CreditCard className="w-3.5 h-3.5 text-indigo-400" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="text-white font-semibold text-xs leading-tight break-words">
                              {title}
                            </h3>
                            <p className="text-slate-400 text-[10px] mt-0.5 flex items-center gap-1 flex-wrap">
                              <span>{categoryObj?.name || 'Obligación'}</span>
                              {remaining > 0 && item.due_date && (
                                <>
                                  <span>•</span>
                                  <span className="text-slate-400 flex items-center gap-0.5">
                                    <Clock size={10} className="text-slate-500" />
                                    {`Vence: ${item.due_date}`}
                                  </span>
                                </>
                              )}
                            </p>
                          </div>
                        </div>

                        {/* Top Right: Status Badge + Chevron Toggle (acceso garantizado y libre de clics accidentales) */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className={clsx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border', status.badgeBg)}>
                            <span className={clsx('w-1 h-1 rounded-full', status.dotColor)} />
                            <span className={status.textColor}>{status.label}</span>
                          </span>
                          <div className="text-slate-400 hover:text-white p-1 rounded-md bg-slate-800/40">
                            {isExpanded ? <ChevronUp size={14} className="text-indigo-400" /> : <ChevronDown size={14} />}
                          </div>
                        </div>
                      </div>

                      {/* Bottom Row (Solo si hay saldo pendiente): Monto + Botón en zona amplia para el pulgar */}
                      {remaining > 0 && (
                        <div className="flex items-center justify-between pt-2 border-t border-slate-800/60">
                          <div>
                            <p className="text-slate-400 text-[10px]">Pendiente por pagar</p>
                            <p className="text-white font-bold text-sm tracking-tight">{formatCOP(remaining)}</p>
                          </div>

                          <button
                            type="button"
                            disabled={isItemSubmitting}
                            onClick={e => handleDirectFullPayment(e, item)}
                            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-[11px] px-3 py-1.5 rounded-lg shadow-xs shadow-indigo-600/30 flex items-center gap-1 transition-all"
                            title="Marcar como Pagado directamente"
                          >
                            <span>{isItemSubmitting ? 'Guardando...' : 'Marcar Pagado'}</span>
                            <ArrowUpRight size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Inline Expanded Details (Accordion Inline) */}
                  {isExpanded && (
                    <div className="border-t border-slate-800 bg-slate-900/95 p-2.5 sm:p-3.5 space-y-2.5 animate-fadeIn">
                      {/* Cifras de Transparencia (Valor Inicial Editable) */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 text-[10px] sm:text-[11px]">
                        <div>
                          <div className="flex items-center justify-between">
                            <p className="text-slate-400">Valor inicial (presupuesto):</p>
                            {editingBudgetId !== item.id && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingBudgetId(item.id)
                                  setEditingBudgetVal(item.budget_amount)
                                }}
                                className="text-[10px] text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-0.5"
                                title="Editar presupuesto inicial"
                              >
                                <Pencil size={11} />
                                <span>Editar</span>
                              </button>
                            )}
                          </div>

                          {editingBudgetId === item.id ? (
                            <div className="flex items-center gap-1.5 mt-1">
                              <div className="flex-1">
                                <CurrencyInput
                                  value={editingBudgetVal}
                                  onChange={val => setEditingBudgetVal(val)}
                                  className="w-full bg-slate-800 border border-slate-700 text-white rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                />
                              </div>
                              <button
                                type="button"
                                disabled={updateBudgetMutation.isPending}
                                onClick={() => {
                                  updateBudgetMutation.mutate({ id: item.id, newAmount: editingBudgetVal })
                                }}
                                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white p-1 rounded transition-colors"
                                title="Guardar valor inicial"
                              >
                                <Check size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingBudgetId(null)}
                                className="bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white p-1 rounded transition-colors"
                                title="Cancelar"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          ) : (
                            <p className="text-slate-200 font-semibold mt-0.5">
                              {formatCOP(item.budget_amount)}
                              {item.arrears_amount > 0 && (
                                <span className="text-rose-400 text-[10px] ml-1.5 font-normal">
                                  (+{formatCOP(item.arrears_amount)} mora)
                                </span>
                              )}
                            </p>
                          )}
                        </div>

                        <div>
                          <p className="text-slate-400">Ya abonado a la fecha:</p>
                          <p className="text-emerald-400 font-semibold mt-0.5">{formatCOP(executed)}</p>
                        </div>
                      </div>

                      {/* Action Feedback message */}
                      {actionMessage && (
                        <div
                          className={clsx(
                            'p-2 rounded-lg text-[11px] flex items-center gap-1.5 border',
                            actionMessage.type === 'success'
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                              : 'bg-rose-500/10 border-rose-500/30 text-rose-400',
                          )}
                        >
                          {actionMessage.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                          <span>{actionMessage.text}</span>
                        </div>
                      )}

                      {remaining <= 0 ? (
                        <div className="bg-emerald-500/10 border border-emerald-500/30 p-2 rounded-lg text-emerald-400 text-[11px] font-medium flex items-center justify-center gap-1.5">
                          <CheckCircle2 size={14} />
                          <span>Esta obligación ya ha sido pagada completamente.</span>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {/* Payment mode radio selection */}
                          <div className="flex gap-3 text-[11px]">
                            <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                              <input
                                type="radio"
                                name={`payMode-${item.id}`}
                                checked={payAmountMode === 'full'}
                                onChange={() => {
                                  setPayAmountMode('full')
                                  setPayCustomAmount(remaining)
                                }}
                                className="accent-indigo-500"
                              />
                              <span>Pago Total ({formatCOP(remaining)})</span>
                            </label>

                            <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                              <input
                                type="radio"
                                name={`payMode-${item.id}`}
                                checked={payAmountMode === 'custom'}
                                onChange={() => setPayAmountMode('custom')}
                                className="accent-indigo-500"
                              />
                              <span>Otro Valor / Abono</span>
                            </label>
                          </div>

                          {/* Custom Amount Input & Quick Fill */}
                          <div>
                            <label className="block text-[10px] font-medium text-slate-400 mb-0.5">
                              Monto a abonar (COP)
                            </label>
                            <div className="flex gap-1.5">
                              <div className="flex-1">
                                <CurrencyInput
                                  value={payAmountMode === 'full' ? remaining : payCustomAmount}
                                  onChange={val => {
                                    setPayAmountMode('custom')
                                    setPayCustomAmount(val)
                                  }}
                                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setPayAmountMode('full')
                                  setPayCustomAmount(remaining)
                                }}
                                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium rounded-lg border border-slate-700 transition-colors flex-shrink-0"
                              >
                                Rellenar Total
                              </button>
                            </div>
                          </div>

                          {/* Account selector */}
                          <div>
                            <label className="block text-[10px] font-medium text-slate-400 mb-0.5">
                              Pagar desde la cuenta:
                            </label>
                            <select
                              value={selectedAccountId}
                              onChange={e => setSelectedAccountId(e.target.value)}
                              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                              <option value="">Ninguna (Sin descontar de cuenta bancaria)</option>
                              {accounts.map(acc => (
                                <option key={acc.id} value={acc.id}>
                                  {acc.name} — Saldo: {formatCOP(acc.current_balance_cached)}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                        <button
                          type="button"
                          disabled={deleteMutation.isPending}
                          onClick={() => handleDeleteItem(item)}
                          className="text-[11px] text-rose-400 hover:text-rose-300 font-medium px-2.5 py-1 rounded-lg border border-rose-500/20 hover:bg-rose-500/10 transition-colors flex items-center gap-1"
                          title="Eliminar este ítem del plan de pagos del mes"
                        >
                          <Trash2 size={13} />
                          <span>{deleteMutation.isPending ? 'Eliminando...' : 'Eliminar del mes'}</span>
                        </button>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setExpandedId(null)}
                            className="text-[11px] text-slate-400 hover:text-white font-medium px-2 py-1 rounded-lg transition-colors"
                          >
                            Cerrar
                          </button>

                          {remaining > 0 && (
                            <button
                              type="button"
                              disabled={isSubmitting}
                              onClick={() => handleConfirmPayment(item)}
                              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold px-3.5 py-1.5 rounded-lg shadow-md shadow-indigo-600/30 flex items-center gap-1 transition-all"
                            >
                              <span>{isSubmitting ? 'Procesando...' : 'Confirmar Pago'}</span>
                              <Check size={13} />
                            </button>
                          )}
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

      {/* 4. Mobile Bottom Sheet Modal (for Category & Status filters) */}
      {activeBottomSheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-xs transition-opacity"
            onClick={() => setActiveBottomSheet(null)}
          />

          {/* Sheet Container */}
          <div className="relative w-full max-w-lg bg-slate-900 border-t border-slate-800 rounded-t-3xl p-4 shadow-2xl z-10 space-y-3 animate-slideUp">
            <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto" />

            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold text-sm sm:text-base">
                {activeBottomSheet === 'category' ? 'Filtrar por Categoría' : 'Filtrar por Estado'}
              </h3>
              <button
                onClick={() => setActiveBottomSheet(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X size={16} />
              </button>
            </div>

            {/* Content for Category Filter */}
            {activeBottomSheet === 'category' && (
              <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
                <button
                  onClick={() => {
                    setSelectedCategory('all')
                    setActiveBottomSheet(null)
                  }}
                  className={clsx(
                    'w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-between',
                    selectedCategory === 'all'
                      ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40'
                      : 'bg-slate-800/50 text-slate-300 hover:bg-slate-800',
                  )}
                >
                  <span>Todas las categorías</span>
                  {selectedCategory === 'all' && <Check size={14} />}
                </button>

                {categories.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => {
                      setSelectedCategory(cat.id)
                      setActiveBottomSheet(null)
                    }}
                    className={clsx(
                      'w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-between',
                      selectedCategory === cat.id
                        ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40'
                        : 'bg-slate-800/50 text-slate-300 hover:bg-slate-800',
                    )}
                  >
                    <span>{cat.name}</span>
                    {selectedCategory === cat.id && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}

            {/* Content for Status Filter */}
            {activeBottomSheet === 'status' && (
              <div className="space-y-1">
                {[
                  { key: 'all', label: 'Todos los estados' },
                  { key: 'pending', label: '🔴 Pendiente' },
                  { key: 'partial', label: '🟡 Pagado Parcialmente' },
                  { key: 'paid', label: '🟢 Pagado' },
                ].map(st => (
                  <button
                    key={st.key}
                    onClick={() => {
                      setSelectedStatus(st.key)
                      setActiveBottomSheet(null)
                    }}
                    className={clsx(
                      'w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-between',
                      selectedStatus === st.key
                        ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40'
                        : 'bg-slate-800/50 text-slate-300 hover:bg-slate-800',
                    )}
                  >
                    <span>{st.label}</span>
                    {selectedStatus === st.key && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}

            {/* Content for Account Selection Filter */}
            {activeBottomSheet === 'account' && (
              <div className="space-y-1">
                <button
                  onClick={() => {
                    setSelectedAccountId('')
                    setActiveBottomSheet(null)
                  }}
                  className={clsx(
                    'w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-between',
                    selectedAccountId === ''
                      ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40'
                      : 'bg-slate-800/50 text-slate-300 hover:bg-slate-800',
                  )}
                >
                  <div>
                    <p className="font-semibold">Ninguna (Sin descontar)</p>
                    <p className="text-[10px] text-slate-400">Registra el pago sin afectar el saldo de ninguna cuenta bancaria</p>
                  </div>
                  {selectedAccountId === '' && <Check size={14} />}
                </button>
                {accounts.map(acc => (
                  <button
                    key={acc.id}
                    onClick={() => {
                      setSelectedAccountId(acc.id)
                      setActiveBottomSheet(null)
                    }}
                    className={clsx(
                      'w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-between',
                      selectedAccountId === acc.id
                        ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40'
                        : 'bg-slate-800/50 text-slate-300 hover:bg-slate-800',
                    )}
                  >
                    <div>
                      <p className="font-semibold">{acc.name}</p>
                      <p className="text-[10px] text-slate-400">Saldo: {formatCOP(acc.current_balance_cached)}</p>
                    </div>
                    {selectedAccountId === acc.id && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}

            {/* Content for Date Sort Filter */}
            {activeBottomSheet === 'sort' && (
              <div className="space-y-1">
                {[
                  { key: 'auto', label: '⭐ Predeterminado (Orden personalizado de la BD o fecha más próxima)', icon: <ArrowUp size={14} /> },
                  { key: 'asc', label: '📅 Fecha Ascendente (Próximos a vencer)', icon: <ArrowUp size={14} /> },
                  { key: 'desc', label: '📅 Fecha Descendente (Más lejanos a vencer)', icon: <ArrowDown size={14} /> },
                ].map(st => (
                  <button
                    key={st.key}
                    onClick={() => {
                      setDueDateSort(st.key as any)
                      setActiveBottomSheet(null)
                    }}
                    className={clsx(
                      'w-full text-left px-3 py-2.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-between',
                      dueDateSort === st.key
                        ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40'
                        : 'bg-slate-800/50 text-slate-300 hover:bg-slate-800',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {st.icon}
                      <span>{st.label}</span>
                    </div>
                    {dueDateSort === st.key && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5. Sticky Mobile Bottom Navigation Bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-lg border-t border-slate-800 px-4 py-2 flex justify-around items-center z-40 shadow-2xl">
        <button
          onClick={() => navigate('/dashboard')}
          className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-white text-[10px] font-medium"
        >
          <LayoutDashboard size={18} />
          <span>Inicio</span>
        </button>

        <button
          onClick={() => navigate('/copia-plan-pagos')}
          className="flex flex-col items-center gap-0.5 text-indigo-400 text-[10px] font-semibold"
        >
          <Receipt size={18} />
          <span>Obligaciones</span>
        </button>

        <button
          onClick={() => navigate('/months')}
          className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-white text-[10px] font-medium"
        >
          <BarChart3 size={18} />
          <span>Métricas</span>
        </button>

        <button
          onClick={() => navigate('/family')}
          className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-white text-[10px] font-medium"
        >
          <User size={18} />
          <span>Perfil</span>
        </button>
      </nav>
    </div>
  )
}
