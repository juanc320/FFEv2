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
    return { key: 'paid', label: 'Pagada', dotColor: 'bg-emerald-500', textColor: 'text-emerald-400', badgeBg: 'bg-emerald-500/10 border-emerald-500/30' }
  }
  if (executed > 0) {
    return { key: 'partial', label: 'Pagada Parcialmente', dotColor: 'bg-amber-500', textColor: 'text-amber-400', badgeBg: 'bg-amber-500/10 border-amber-500/30' }
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

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<string>('all')

  // Bottom sheet filter modals for mobile
  const [activeBottomSheet, setActiveBottomSheet] = useState<'category' | 'status' | 'account' | null>(null)

  // Accordion card expanded state
  const [expandedId, setExpandedId] = useState<string | null>(null)

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
    return items.filter(item => {
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
  }, [items, activeTab, selectedCategory, selectedStatus, searchQuery, categoryMap, conceptMap])

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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-24 lg:pb-10">
      {/* Ultra-compact container: px-1 en móvil para máxima área útil casi borde a borde */}
      <div className="max-w-3xl mx-auto px-1 sm:px-3 pt-1.5 sm:pt-3 space-y-2.5">
        
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

        {/* 2. Filters & Search Bar */}
        <div className="space-y-1.5">
          {/* Search box */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar obligación o categoría..."
              className="w-full bg-slate-900/80 border border-slate-800 text-white rounded-xl pl-8 pr-7 py-1.5 text-xs sm:text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
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

          {/* Quick Filter Chips (Category & Date/Status) */}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
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
                  : '🟢 Pagada'}
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

            {/* Reset Filters button if active */}
            {(selectedCategory !== 'all' || selectedStatus !== 'all' || searchQuery) && (
              <button
                onClick={() => {
                  setSelectedCategory('all')
                  setSelectedStatus('all')
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
                  className={clsx(
                    'bg-slate-900/90 border rounded-xl transition-all duration-200 overflow-hidden shadow-xs',
                    isExpanded ? 'border-indigo-500/50 ring-1 ring-indigo-500/30' : 'border-slate-800/80 hover:border-slate-700',
                    status.key === 'paid' && !isExpanded && 'opacity-75',
                  )}
                >
                  {/* Collapsed Header View: Padding ultra compacto px-2.5 py-2.5 */}
                  <div
                    onClick={() => handleCardToggle(item)}
                    className="px-2.5 py-2.5 sm:px-3.5 sm:py-3 cursor-pointer space-y-2 select-none"
                  >
                    {/* Top Row: Icon + Full Title (en 2 renglones si es largo) + Status Badge */}
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        <div className="w-7 h-7 rounded-lg bg-slate-800/80 border border-slate-700/80 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <CreditCard className="w-3.5 h-3.5 text-indigo-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          {/* NOMBRE COMPLETO SIN TRUNCAR */}
                          <h3 className="text-white font-semibold text-xs sm:text-sm leading-tight break-words whitespace-normal">
                            {title}
                          </h3>
                          <p className="text-slate-400 text-[10px] sm:text-[11px] mt-0.5 flex items-center gap-1 flex-wrap">
                            <span>{categoryObj?.name}</span>
                            <span>•</span>
                            <span className="text-slate-400 flex items-center gap-0.5">
                              <Clock size={10} className="text-slate-500" />
                              {item.due_date ? `Vence: ${item.due_date}` : 'Sin fecha'}
                            </span>
                          </p>
                        </div>
                      </div>

                      {/* Badge de Estado Ultra-Compacto */}
                      <span className={clsx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border flex-shrink-0', status.badgeBg)}>
                        <span className={clsx('w-1 h-1 rounded-full', status.dotColor)} />
                        <span className={status.textColor}>{status.label}</span>
                      </span>
                    </div>

                    {/* Bottom Row: Pendiente por pagar + Botón Marcar Pagado directo + Chevron Toggle */}
                    <div className="flex items-center justify-between pt-1.5 border-t border-slate-800/60">
                      <div>
                        <p className="text-slate-400 text-[10px]">Pendiente por pagar</p>
                        <p className="text-white font-bold text-sm sm:text-base tracking-tight">{formatCOP(remaining)}</p>
                      </div>

                      <div className="flex items-center gap-1">
                        {/* Botón directo de Marcar Pagado (1-tap sin necesidad de desplegar) */}
                        {remaining > 0 ? (
                          <button
                            type="button"
                            disabled={isItemSubmitting}
                            onClick={e => handleDirectFullPayment(e, item)}
                            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-[11px] px-2.5 py-1 rounded-lg shadow-xs shadow-indigo-600/30 flex items-center gap-1 transition-all"
                            title="Marcar como Pagado directamente"
                          >
                            <span>{isItemSubmitting ? 'Guardando...' : 'Marcar Pagado'}</span>
                            <ArrowUpRight size={13} />
                          </button>
                        ) : (
                          <span className="text-emerald-400 text-[10px] font-medium flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                            <CheckCircle2 size={12} /> Pagada
                          </span>
                        )}

                        {/* Chevron toggle para ver u ocultar formulario parcial */}
                        <div className="text-slate-400 hover:text-white p-1 rounded-md bg-slate-800/40">
                          {isExpanded ? <ChevronUp size={15} className="text-indigo-400" /> : <ChevronDown size={15} />}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Inline Expanded Details (Accordion Inline) */}
                  {isExpanded && (
                    <div className="border-t border-slate-800 bg-slate-900/95 p-2.5 sm:p-3.5 space-y-2.5 animate-fadeIn">
                      {/* Cifras de Transparencia */}
                      <div className="grid grid-cols-2 gap-2 bg-slate-950/60 p-2 rounded-lg border border-slate-800/80 text-[10px] sm:text-[11px]">
                        <div>
                          <p className="text-slate-400">Valor inicial (presupuesto):</p>
                          <p className="text-slate-200 font-semibold mt-0.5">{formatCOP(totalDue)}</p>
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
                      <div className="flex items-center justify-between pt-1.5 border-t border-slate-800">
                        <button
                          type="button"
                          onClick={() => setExpandedId(null)}
                          className="text-[11px] text-slate-400 hover:text-white font-medium px-2 py-1 rounded-lg transition-colors"
                        >
                          Cerrar Detalles
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
                  { key: 'partial', label: '🟡 Pagada Parcialmente' },
                  { key: 'paid', label: '🟢 Pagada' },
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
