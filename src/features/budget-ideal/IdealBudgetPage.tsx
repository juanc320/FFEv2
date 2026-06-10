import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useAuth } from '@/features/auth/AuthContext'
import { useActiveMonth } from '@/features/months/MonthsPage'
import {
  SlidersHorizontal,
  Save,
  Search,
  AlertTriangle,
  CheckCircle,
  TrendingUp,
  TrendingDown,
  Info,
  Lock,
  CheckSquare,
  Square,
  RefreshCw,
  Plus
} from 'lucide-react'
import { formatCOP } from '@/shared/utils/calculations'
import { CurrencyInput } from '@/shared/components/CurrencyInput'
import clsx from 'clsx'
import type { MonthlyIncomeItem } from '@/shared/types/database'

const CRITICALITY_LABELS = {
  critical: 'Crítico',
  necessary: 'Necesario',
  desirable: 'Deseable',
  optional: 'Opcional',
}

const CRITICALITY_COLORS = {
  critical: 'bg-red-500/15 text-red-400 border border-red-500/20',
  necessary: 'bg-amber-500/15 text-amber-400 border border-amber-500/20',
  desirable: 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/20',
  optional: 'bg-slate-500/15 text-slate-400 border border-slate-700/50',
}

const TYPE_LABELS = {
  fixed: 'Fijo',
  variable: 'Variable',
  sporadic: 'Esporádico',
}

const TYPE_COLORS = {
  fixed: 'bg-blue-500/10 text-blue-400 border border-blue-500/25',
  variable: 'bg-violet-500/10 text-violet-400 border border-violet-500/25',
  sporadic: 'bg-orange-500/10 text-orange-400 border border-orange-500/25',
}

export default function IdealBudgetPage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const { data: activeMonth, isLoading: isLoadingMonth } = useActiveMonth()
  const [selectedExpenses, setSelectedExpenses] = useState<Record<string, boolean>>({})
  const [selectedIncomes, setSelectedIncomes] = useState<Record<string, boolean>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [activeTab, setActiveTab] = useState<'expenses' | 'incomes'>('expenses')
  const [showConfirm, setShowConfirm] = useState(false)
  const [groupBy, setGroupBy] = useState<'criticality' | 'category'>('criticality')
  // Fetch all monthly expenses (both active and inactive in the month)
  const { data: expenses = [] as any[], isLoading: isLoadingExpenses } = useQuery({
    queryKey: ['simulator_expense_items', activeMonth?.id],
    queryFn: async (): Promise<any[]> => {
      const { data, error } = await supabase
        .from('monthly_expense_items')
        .select('*, categories(name), concepts(name)')
        .eq('month_id', activeMonth!.id)
      if (error) throw error
      return (data ?? []) as any[]
    },
    enabled: !!activeMonth?.id
  })

  // Fetch monthly incomes
  const { data: incomes = [], isLoading: isLoadingIncomes } = useQuery({
    queryKey: ['simulator_income_items', activeMonth?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('monthly_income_items')
        .select('*')
        .eq('month_id', activeMonth!.id)
      if (error) throw error
      return (data ?? []) as MonthlyIncomeItem[]
    },
    enabled: !!activeMonth?.id
  })

  const [saveSimulationSuccess, setSaveSimulationSuccess] = useState(false)
  const [simulatedAmounts, setSimulatedAmounts] = useState<Record<string, number>>({})

  // Initialize selected values from DB configuration
  useEffect(() => {
    if (expenses.length > 0) {
      const initialMap: Record<string, boolean> = {}
      const initialAmounts: Record<string, number> = {}
      expenses.forEach((item: any) => {
        // Fallback to active_in_month if in_ideal_budget is not yet defined
        initialMap[item.id] = item.in_ideal_budget !== undefined && item.in_ideal_budget !== null
          ? item.in_ideal_budget
          : item.active_in_month

        initialAmounts[item.id] = item.ideal_budget_amount !== undefined && item.ideal_budget_amount !== null
          ? Number(item.ideal_budget_amount)
          : Number(item.budget_amount || 0)
      })
      setSelectedExpenses(initialMap)
      setSimulatedAmounts(initialAmounts)
    }
  }, [expenses])

  useEffect(() => {
    if (incomes.length > 0) {
      const initialMap: Record<string, boolean> = {}
      incomes.forEach((item: MonthlyIncomeItem) => {
        initialMap[item.id] = true // Default: include all active incomes in simulation
      })
      setSelectedIncomes(initialMap)
    }
  }, [incomes])

  // Save only simulation parameters (without applying to real budget)
  const saveSimulationMutation = useMutation({
    mutationFn: async () => {
      const updates = expenses.map((item: any) => {
        const isSelected = !!selectedExpenses[item.id]
        const simulatedAmt = simulatedAmounts[item.id] !== undefined
          ? simulatedAmounts[item.id]
          : Number(item.budget_amount || 0)

        const needsIdealUpdate = isSelected !== item.in_ideal_budget
        const needsIdealAmtUpdate = simulatedAmt !== item.ideal_budget_amount

        if (needsIdealUpdate || needsIdealAmtUpdate) {
          const payload: any = {}
          if (needsIdealUpdate) payload.in_ideal_budget = isSelected
          if (needsIdealAmtUpdate) payload.ideal_budget_amount = simulatedAmt

          return db.from('monthly_expense_items')
            .update(payload)
            .eq('id', item.id)
        }
        return null
      }).filter(Boolean)

      if (updates.length > 0) {
        await Promise.all(updates)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['simulator_expense_items'] })
      setSaveSimulationSuccess(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      setTimeout(() => setSaveSimulationSuccess(false), 5000)
    },
    onError: (err: any) => {
      const errorMsg = err.message || err
      if (errorMsg.includes('column "ideal_budget_amount" of relation "monthly_expense_items" does not exist') || errorMsg.includes('ideal_budget_amount') || errorMsg.includes('in_ideal_budget')) {
        alert('Error: Falta alguna columna en la base de datos para soportar esta funcionalidad. Por favor, ejecuta el script SQL en supabase/add_ideal_budget_amount_column.sql en tu Supabase SQL Editor.')
      } else {
        alert('Error al guardar la simulación: ' + errorMsg)
      }
    }
  })

  // Apply to real budget mutation (and keep ideal in sync)
  const applyBudgetMutation = useMutation({
    mutationFn: async () => {
      const updates = expenses.map((item: any) => {
        const isSelected = !!selectedExpenses[item.id]
        const simulatedAmt = simulatedAmounts[item.id] !== undefined
          ? simulatedAmounts[item.id]
          : Number(item.budget_amount || 0)

        const needsActiveUpdate = isSelected !== item.active_in_month
        const needsIdealUpdate = isSelected !== item.in_ideal_budget
        const needsAmountUpdate = simulatedAmt !== Number(item.budget_amount || 0)
        const needsIdealAmtUpdate = simulatedAmt !== item.ideal_budget_amount

        if (needsActiveUpdate || needsIdealUpdate || needsAmountUpdate || needsIdealAmtUpdate) {
          const payload: any = {}
          if (needsActiveUpdate) payload.active_in_month = isSelected
          if (needsIdealUpdate) payload.in_ideal_budget = isSelected
          if (needsAmountUpdate) payload.budget_amount = simulatedAmt
          if (needsIdealAmtUpdate) payload.ideal_budget_amount = simulatedAmt

          return db.from('monthly_expense_items')
            .update(payload)
            .eq('id', item.id)
        }
        return null
      }).filter(Boolean)

      if (updates.length > 0) {
        await Promise.all(updates)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expense_items'] })
      queryClient.invalidateQueries({ queryKey: ['simulator_expense_items'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setSaveSuccess(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      setTimeout(() => setSaveSuccess(false), 5000)
    },
    onError: (err: any) => {
      const errorMsg = err.message || err
      if (errorMsg.includes('column "ideal_budget_amount" of relation "monthly_expense_items" does not exist') || errorMsg.includes('ideal_budget_amount') || errorMsg.includes('in_ideal_budget')) {
        alert('Error: Falta alguna columna en la base de datos para soportar esta funcionalidad. Por favor, ejecuta el script SQL en supabase/add_ideal_budget_amount_column.sql en tu Supabase SQL Editor.')
      } else {
        alert('Error al aplicar el presupuesto ideal: ' + errorMsg)
      }
    }
  })

  // Role Access Restriction check
  if (profile?.role !== 'admin') {
    return (
      <div className="max-w-md mx-auto my-12 text-center space-y-6">
        <div className="card border-red-500/20 bg-red-500/5 py-12 px-6 flex flex-col items-center gap-4">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center text-red-400">
            <Lock size={32} />
          </div>
          <h1 className="text-xl font-bold text-white">Acceso Restringido</h1>
          <p className="text-slate-400 text-sm leading-relaxed">
            Esta sección contiene configuraciones de planificación estratégica del hogar. 
            Solo los usuarios con el rol de **Administrador** pueden acceder y simular el presupuesto ideal.
          </p>
          <a href="/dashboard" className="btn-primary mt-2">Volver al Dashboard</a>
        </div>
      </div>
    )
  }

  const isLoading = isLoadingMonth || isLoadingExpenses || isLoadingIncomes

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 text-sm">Cargando simulador...</p>
      </div>
    )
  }

  if (!activeMonth) {
    return (
      <div className="max-w-xl mx-auto space-y-6 text-center my-12">
        <div className="card py-12 px-6 space-y-4">
          <Info size={40} className="text-indigo-400 mx-auto" />
          <h2 className="text-xl font-bold text-white">No hay mes presupuestal activo</h2>
          <p className="text-slate-400 text-sm">
            Para simular tu presupuesto ideal, debes tener un mes activo en curso. 
            Crea o activa el mes actual para iniciar el plan.
          </p>
          <a href="/months" className="btn-primary inline-block">Configurar Mes Presupuestal</a>
        </div>
      </div>
    )
  }

  // Calculations for simulated budget
  const totalIncomesSimulated = incomes.reduce((sum, item) => {
    const isChecked = selectedIncomes[item.id] !== false
    return isChecked ? sum + Number(item.net_expected || 0) : sum
  }, 0)

  const totalExpensesSimulated = expenses.reduce((sum, item) => {
    const isChecked = !!selectedExpenses[item.id]
    const amount = simulatedAmounts[item.id] !== undefined
      ? simulatedAmounts[item.id]
      : Number(item.budget_amount || 0)
    return isChecked ? sum + (amount + Number(item.arrears_amount || 0)) : sum
  }, 0)

  const simulatedBalance = totalIncomesSimulated - totalExpensesSimulated
  const isBalanced = simulatedBalance >= 0

  // Filter expenses based on search query
  const filteredExpenses = expenses.filter((item: any) => {
    const name = item.concepts?.name || item.categories?.name || 'Gasto'
    const matchesSearch = name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.categories?.name || '').toLowerCase().includes(searchQuery.toLowerCase())
    return matchesSearch
  })

  const criticalities: ('critical' | 'necessary' | 'desirable' | 'optional')[] = ['critical', 'necessary', 'desirable', 'optional']

  // Group filtered expenses by criticality
  const groupedExpenses = criticalities.reduce((acc, crit) => {
    acc[crit] = filteredExpenses.filter((item: any) => item.criticality === crit)
    return acc
  }, {} as Record<string, any[]>)

  // Group filtered expenses by category name
  const uniqueCategories = Array.from(new Set(filteredExpenses.map((item: any) => item.categories?.name || 'Otros Gastos'))).sort()

  const groupedByCategory = uniqueCategories.reduce((acc, catName) => {
    acc[catName] = filteredExpenses.filter((item: any) => (item.categories?.name || 'Otros Gastos') === catName)
    return acc
  }, {} as Record<string, any[]>)

  const handleToggleAll = (checked: boolean) => {
    const newMap: Record<string, boolean> = {}
    expenses.forEach((item: any) => {
      newMap[item.id] = checked
    })
    setSelectedExpenses(newMap)
  }

  const handleToggleOptional = (checked: boolean) => {
    const newMap = { ...selectedExpenses }
    expenses.forEach((item: any) => {
      if (item.criticality === 'optional') {
        newMap[item.id] = checked
      }
    })
    setSelectedExpenses(newMap)
  }

  const handleToggleDesirable = (checked: boolean) => {
    const newMap = { ...selectedExpenses }
    expenses.forEach((item: any) => {
      if (item.criticality === 'desirable') {
        newMap[item.id] = checked
      }
    })
    setSelectedExpenses(newMap)
  }

  const handleToggleSporadic = (checked: boolean) => {
    const newMap = { ...selectedExpenses }
    expenses.forEach((item: any) => {
      if (item.expense_type === 'sporadic') {
        newMap[item.id] = checked
      }
    })
    setSelectedExpenses(newMap)
  }

  const toggleExpense = (id: string) => {
    setSelectedExpenses(prev => ({
      ...prev,
      [id]: !prev[id]
    }))
  }

  const toggleIncome = (id: string) => {
    setSelectedIncomes(prev => ({
      ...prev,
      [id]: prev[id] === false ? true : false
    }))
  }

  const renderExpenseCard = (item: any) => {
    const isChecked = !!selectedExpenses[item.id]
    const label = item.concepts?.name || item.categories?.name || 'Gasto'
    
    return (
      <div
        key={item.id}
        onClick={() => toggleExpense(item.id)}
        className={clsx(
          'flex items-center gap-4 px-4 py-3 rounded-xl border transition-all cursor-pointer select-none',
          isChecked 
            ? 'bg-indigo-600/5 border-indigo-500/30' 
            : 'bg-slate-900/40 border-slate-800/80 opacity-55 hover:opacity-75'
        )}
      >
        {/* Custom checkbox */}
        <div className="flex-shrink-0 text-indigo-400">
          {isChecked ? <CheckSquare size={19} className="text-indigo-400" /> : <Square size={19} className="text-slate-600" />}
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-2">
            <p className="text-slate-200 text-sm font-medium leading-tight truncate">{label}</p>
            {groupBy === 'criticality' && item.categories?.name && (
              <span className="text-slate-500 text-[10px]">· {item.categories.name}</span>
            )}
            {groupBy === 'category' && (
              <span className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase', CRITICALITY_COLORS[item.criticality as keyof typeof CRITICALITY_COLORS])}>
                {CRITICALITY_LABELS[item.criticality as keyof typeof CRITICALITY_LABELS]}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase', TYPE_COLORS[item.expense_type as keyof typeof TYPE_COLORS])}>
              {TYPE_LABELS[item.expense_type as keyof typeof TYPE_LABELS]}
            </span>
            {Number(item.arrears_amount) > 0 && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase bg-red-500/10 text-red-400 border-red-500/25">
                Mora
              </span>
            )}
          </div>
        </div>

        {/* Amount */}
        <div className="text-right flex-shrink-0 flex flex-col items-end gap-1" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1 bg-slate-950/40 border border-slate-850 rounded-lg px-2 py-0.5 focus-within:border-indigo-500/50 transition-colors">
            <span className="text-slate-500 text-[10px] font-semibold">$</span>
            <CurrencyInput
              value={simulatedAmounts[item.id] !== undefined ? simulatedAmounts[item.id] : (Number(item.budget_amount) || 0)}
              onChange={(val) => {
                setSimulatedAmounts(prev => ({
                  ...prev,
                  [item.id]: val
                }))
              }}
              className="w-20 text-right bg-transparent border-0 outline-none p-0 text-[11px] text-white font-semibold placeholder-slate-600 focus:ring-0 focus:ring-offset-0"
            />
          </div>
          {Number(item.arrears_amount) > 0 && (
            <p className="text-[10px] text-slate-500">Mora: {formatCOP(Number(item.arrears_amount))}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Success alert banner */}
      {saveSuccess && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-5 py-4 flex items-start gap-3 animate-fade-in">
          <CheckCircle size={18} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-emerald-300 text-sm font-semibold">¡Presupuesto Ideal Aplicado!</p>
            <p className="text-emerald-400/80 text-xs mt-0.5">
              Los gastos seleccionados se han activado/desactivado correctamente en tu presupuesto real del mes. 
              Los cambios ya son visibles en el Dashboard y en el Plan de Gastos.
            </p>
          </div>
        </div>
      )}

      {/* Simulation success alert banner */}
      {saveSimulationSuccess && (
        <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl px-5 py-4 flex items-start gap-3 animate-fade-in">
          <CheckCircle size={18} className="text-indigo-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-indigo-300 text-sm font-semibold">¡Plan de Simulación Guardado!</p>
            <p className="text-indigo-400/80 text-xs mt-0.5">
              Tu simulación de presupuesto ideal ha sido guardada. Podrás consultarla o editarla en el futuro 
              sin que afecte tu presupuesto real ni las estadísticas del Dashboard.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <SlidersHorizontal className="text-indigo-400" size={24} />
            Simulador de Presupuesto Ideal
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Analiza, activa o desactiva tus gastos mensuales para encontrar tu presupuesto ideal equilibrado.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
          <Lock size={12} /> Rol: Administrador
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Side: Simulation Lists and Filters */}
        <div className="lg:col-span-2 space-y-4">
          
          {/* Tabs Navigation */}
          <div className="flex gap-2 p-1 bg-slate-900 border border-slate-800 rounded-xl">
            <button
              onClick={() => setActiveTab('expenses')}
              className={clsx(
                'flex-1 text-center py-2 text-xs font-semibold rounded-lg transition-all',
                activeTab === 'expenses'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              )}
            >
              Gastos del Mes ({expenses.length})
            </button>
            <button
              onClick={() => setActiveTab('incomes')}
              className={clsx(
                'flex-1 text-center py-2 text-xs font-semibold rounded-lg transition-all',
                activeTab === 'incomes'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              )}
            >
              Ingresos del Mes ({incomes.length})
            </button>
          </div>

          {activeTab === 'expenses' ? (
            <div className="space-y-4">
              {/* Quick Filters Panel & Group By Toggle */}
              <div className="card space-y-3 bg-slate-900/60 border-slate-800 py-3 px-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2.5 border-b border-slate-800/60">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Visualización y Acciones</span>
                  <div className="flex items-center gap-1.5 p-0.5 bg-slate-950/60 rounded-lg border border-slate-850">
                    <button
                      onClick={() => setGroupBy('criticality')}
                      className={clsx(
                        'px-2.5 py-1 text-[10px] font-semibold rounded-md transition-all',
                        groupBy === 'criticality'
                          ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                          : 'text-slate-400 hover:text-slate-200 border border-transparent'
                      )}
                    >
                      Por Criticidad
                    </button>
                    <button
                      onClick={() => setGroupBy('category')}
                      className={clsx(
                        'px-2.5 py-1 text-[10px] font-semibold rounded-md transition-all',
                        groupBy === 'category'
                          ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                          : 'text-slate-400 hover:text-slate-200 border border-transparent'
                      )}
                    >
                      Por Categoría
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => handleToggleAll(true)} className="btn-ghost-sm text-[10px] uppercase font-semibold text-slate-350">
                    Marcar todos
                  </button>
                  <button onClick={() => handleToggleAll(false)} className="btn-ghost-sm text-[10px] uppercase font-semibold text-slate-350">
                    Desmarcar todos
                  </button>
                  <button onClick={() => handleToggleOptional(false)} className="btn-ghost-sm text-[10px] uppercase font-semibold text-red-400/80 hover:text-red-400">
                    Desmarcar opcionales
                  </button>
                  <button onClick={() => handleToggleDesirable(false)} className="btn-ghost-sm text-[10px] uppercase font-semibold text-indigo-400/80 hover:text-indigo-400">
                    Desmarcar deseables
                  </button>
                  <button onClick={() => handleToggleSporadic(false)} className="btn-ghost-sm text-[10px] uppercase font-semibold text-orange-400/80 hover:text-orange-400">
                    Desmarcar esporádicos
                  </button>
                </div>
              </div>

              {/* Expense list */}
              <div className="space-y-6 max-h-[65vh] overflow-y-auto pr-1">
                {filteredExpenses.length === 0 ? (
                  <div className="card text-center py-12 border-slate-800 bg-slate-900/40">
                    <p className="text-slate-500 text-sm">No se encontraron gastos para simular.</p>
                  </div>
                ) : groupBy === 'criticality' ? (
                  criticalities.map(crit => {
                    const list = groupedExpenses[crit] || []
                    if (list.length === 0) return null

                    return (
                      <div key={crit} className="space-y-2.5">
                        <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5 pt-2">
                          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                            <span className={clsx('w-2 h-2 rounded-full', 
                              crit === 'critical' ? 'bg-red-500 animate-pulse' :
                              crit === 'necessary' ? 'bg-amber-500' :
                              crit === 'desirable' ? 'bg-indigo-500' : 'bg-slate-400'
                            )} />
                            {CRITICALITY_LABELS[crit]} ({list.length})
                          </h3>
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                          {list.map((item: any) => renderExpenseCard(item))}
                        </div>
                      </div>
                    )
                  })
                ) : (
                  uniqueCategories.map(catName => {
                    const list = groupedByCategory[catName] || []
                    if (list.length === 0) return null

                    return (
                      <div key={catName} className="space-y-2.5">
                        <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5 pt-2">
                          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-indigo-500" />
                            {catName} ({list.length})
                          </h3>
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                          {list.map((item: any) => renderExpenseCard(item))}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          ) : (
            // Incomes panel
            <div className="space-y-3">
              <div className="bg-slate-900/30 border border-slate-800/80 rounded-xl p-4 flex gap-3 mb-2">
                <Info size={16} className="text-indigo-400 flex-shrink-0 mt-0.5" />
                <p className="text-slate-400 text-xs leading-normal">
                  Puedes incluir o excluir fuentes de ingresos en la simulación para analizar escenarios alternativos 
                  (por ejemplo, si un ingreso variable o un bono no llegara a recibirse). 
                  *Nota: Toggles de ingresos solo afectan a la simulación actual y no se guardan en base de datos.*
                </p>
              </div>

              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                {incomes.length === 0 ? (
                  <div className="card text-center py-12 border-slate-800 bg-slate-900/40">
                    <p className="text-slate-500 text-sm">No hay ingresos registrados en el mes.</p>
                  </div>
                ) : (
                  incomes.map(item => {
                    const isChecked = selectedIncomes[item.id] !== false
                    return (
                      <div
                        key={item.id}
                        onClick={() => toggleIncome(item.id)}
                        className={clsx(
                          'flex items-center gap-4 px-4 py-3 rounded-xl border transition-all cursor-pointer select-none',
                          isChecked 
                            ? 'bg-emerald-500/5 border-emerald-500/30' 
                            : 'bg-slate-900/40 border-slate-800/80 opacity-55 hover:opacity-75'
                        )}
                      >
                        <div className="flex-shrink-0 text-emerald-400">
                          {isChecked ? <CheckSquare size={19} className="text-emerald-450" /> : <Square size={19} className="text-slate-600" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-slate-200 text-sm font-medium leading-tight truncate">{item.label}</p>
                          <p className="text-slate-500 text-[10px] mt-0.5">
                            {item.income_type === 'sporadic' ? 'Esporádico' : 'Fijo/Recurrente'} · Neto esperado
                          </p>
                        </div>
                        <p className="text-emerald-400 text-sm font-semibold flex-shrink-0">
                          {formatCOP(item.net_expected)}
                        </p>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}

        </div>

        {/* Right Side: Simulation Results & Actions */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:h-fit">
          
          {/* Search box on the side */}
          {activeTab === 'expenses' && (
            <div className="card p-4 bg-slate-900/80 border-slate-800 space-y-2">
              <label className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block">Buscar en gastos</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={13} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Ej: arriendo, comida..."
                  className="input w-full pl-8 py-1.5 text-xs bg-slate-950/50 border-slate-850"
                />
              </div>
            </div>
          )}

          {/* Sandbox Status Card */}
          <div className="card bg-slate-900/80 border-slate-800 space-y-5">
            <h2 className="text-white font-semibold flex items-center gap-2 border-b border-slate-800/80 pb-3">
              Resumen de Simulación
            </h2>

            {/* Calculations metrics */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs font-medium">Ingresos simulados:</span>
                <span className="text-emerald-400 text-sm font-bold">{formatCOP(totalIncomesSimulated)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs font-medium">Gastos simulados:</span>
                <span className="text-red-400 text-sm font-bold">-{formatCOP(totalExpensesSimulated)}</span>
              </div>
              <div className="border-t border-slate-850 pt-3 flex items-center justify-between">
                <span className="text-white text-xs font-bold">Balance ideal:</span>
                <span className={clsx('text-base font-bold', isBalanced ? 'text-emerald-400' : 'text-red-400')}>
                  {isBalanced ? '' : '-'}{formatCOP(Math.abs(simulatedBalance))}
                </span>
              </div>
            </div>

            {/* Visual Indicators Banner */}
            <div className={clsx(
              'rounded-xl border p-4 flex gap-3 items-start',
              isBalanced 
                ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-400' 
                : 'bg-red-500/10 border-red-500/35 text-red-400'
            )}>
              {isBalanced ? (
                <CheckCircle size={18} className="flex-shrink-0 mt-0.5 text-emerald-400" />
              ) : (
                <AlertTriangle size={18} className="flex-shrink-0 mt-0.5 text-red-400" />
              )}
              <div className="space-y-1">
                <p className="text-xs font-bold">
                  {isBalanced ? '¡Presupuesto Equilibrado!' : 'Presupuesto Deficitario'}
                </p>
                <p className="text-[10px] text-slate-350 leading-relaxed">
                  {isBalanced 
                    ? 'Los gastos seleccionados no superan tus ingresos mensuales. Esta planificación es viable para tu economía familiar.' 
                    : `Los gastos superan los ingresos simulados por ${formatCOP(Math.abs(simulatedBalance))}. Desmarca algunos gastos adicionales o reduce montos.`}
                </p>
              </div>
            </div>

            {/* Save Simulation Button */}
            <button
              onClick={() => saveSimulationMutation.mutate()}
              disabled={saveSimulationMutation.isPending || applyBudgetMutation.isPending}
              className="btn-ghost w-full flex items-center justify-center gap-2 py-2.5 border border-slate-700 hover:border-slate-600 hover:bg-slate-800/50 text-xs font-semibold"
            >
              {saveSimulationMutation.isPending ? (
                <>
                  <RefreshCw className="animate-spin" size={15} />
                  <span>Guardando simulación...</span>
                </>
              ) : (
                <>
                  <SlidersHorizontal size={15} className="text-indigo-400" />
                  <span>Guardar Plan de Simulación</span>
                </>
              )}
            </button>

            {/* Apply Button */}
            <button
              onClick={() => setShowConfirm(true)}
              disabled={applyBudgetMutation.isPending || saveSimulationMutation.isPending}
              className="btn-primary w-full flex items-center justify-center gap-2 py-3"
            >
              {applyBudgetMutation.isPending ? (
                <>
                  <RefreshCw className="animate-spin" size={16} />
                  <span>Aplicando presupuesto...</span>
                </>
              ) : (
                <>
                  <Save size={16} />
                  <span>Aplicar al Presupuesto Real</span>
                </>
              )}
            </button>
            <p className="text-[10px] text-slate-500 text-center leading-normal">
              Al guardar en el plan real, se actualizará tu plan de gastos real del mes, activando/desactivando los sobres en tu dashboard.
            </p>
          </div>

        </div>

      </div>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="card max-w-sm w-full bg-slate-900 border border-slate-800 space-y-4 p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-amber-400">
              <AlertTriangle size={22} className="flex-shrink-0" />
              <h3 className="text-white font-bold text-base">¿Aplicar presupuesto real?</h3>
            </div>
            <p className="text-slate-450 text-xs leading-normal">
              Esta acción modificará la visibilidad y activación de tus gastos en el plan real de este mes según los elementos que seleccionaste en el simulador. 
              Esto afectará el Dashboard y tu proyección.
            </p>
            <div className="flex gap-3 justify-end pt-2 border-t border-slate-800/80">
              <button
                className="btn-ghost py-2 px-4 text-xs font-semibold"
                onClick={() => setShowConfirm(false)}
              >
                Cancelar
              </button>
              <button
                className="btn-primary py-2 px-4 text-xs font-semibold opacity-90 hover:opacity-100"
                onClick={() => {
                  setShowConfirm(false)
                  applyBudgetMutation.mutate()
                }}
              >
                Sí, aplicar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
