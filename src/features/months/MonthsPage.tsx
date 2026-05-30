import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useAuth } from '@/features/auth/AuthContext'
import type { BudgetMonth, Category, Concept } from '@/shared/types/database'
import { monthName } from '@/shared/utils/calculations'
import { Calendar, Plus, Lock, ChevronRight, ChevronDown, Tag, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { CurrencyInput } from '@/shared/components/CurrencyInput'

export function useBudgetMonths() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['budget_months', profile?.family_id],
    queryFn: async (): Promise<BudgetMonth[]> => {
      const { data } = await supabase
        .from('budget_months')
        .select('*')
        .eq('family_id', profile!.family_id!)
        .order('year', { ascending: false })
        .order('month', { ascending: false })
      return (data ?? []) as BudgetMonth[]
    },
    enabled: !!profile?.family_id,
  })
}

export function useActiveMonth() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['active_month', profile?.family_id],
    queryFn: async (): Promise<BudgetMonth | null> => {
      const { data } = await supabase
        .from('budget_months')
        .select('*')
        .eq('family_id', profile!.family_id!)
        .eq('status', 'active')
        .single()
      return data as BudgetMonth | null
    },
    enabled: !!profile?.family_id,
  })
}

export default function MonthsPage() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const { data: months = [], isLoading } = useBudgetMonths()
  const [showForm, setShowForm] = useState(false)
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  
  // Asistente de creación de mes
  const [step, setStep] = useState<'config' | 'preview' | 'onboarding_incomes'>('config')
  const [prevItemsToCopy, setPrevItemsToCopy] = useState<any[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Plantillas de ingresos recurrentes iniciales (onboarding)
  const INITIAL_INCOME_TEMPLATES = [
    { id: 'template-juan', label: 'Salario básico Juan', gross_amount: 3088000, checked: true },
    { id: 'template-diana', label: 'Salario básico Diana', gross_amount: 5808000, checked: true },
    { id: 'template-argo', label: 'Arriendo Argo', gross_amount: 1112500, checked: true },
  ]
  const [onboardingIncomes, setOnboardingIncomes] = useState<any[]>(INITIAL_INCOME_TEMPLATES)

  // Resetear estados al cerrar/abrir formulario
  useEffect(() => {
    if (!showForm) {
      setStep('config')
      setPrevItemsToCopy([])
      setExpandedId(null)
      setOnboardingIncomes(INITIAL_INCOME_TEMPLATES)
    }
  }, [showForm])

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', profile?.family_id],
    queryFn: async () => {
      const { data } = await supabase.from('categories').select('*').eq('family_id', profile!.family_id!)
      return (data ?? []) as Category[]
    },
    enabled: !!profile?.family_id,
  })

  const { data: concepts = [] } = useQuery({
    queryKey: ['concepts', profile?.family_id],
    queryFn: async () => {
      const { data } = await supabase.from('concepts').select('*').eq('family_id', profile!.family_id!)
      return (data ?? []) as Concept[]
    },
    enabled: !!profile?.family_id,
  })

  const activeMonth = months.find(m => m.status === 'active')

  const handleProceedToPreview = async () => {
    // 1. Obtener mes anterior
    const { data: prevMonths } = await db.from('budget_months')
      .select('id')
      .eq('family_id', profile!.family_id!)
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(1)
    
    const prevMonthId = prevMonths?.[0]?.id

    if (prevMonthId) {
      // 2. Traer gastos activos no pospuestos de ese mes
      const { data: prevItems } = await db.from('monthly_expense_items')
        .select('*')
        .eq('month_id', prevMonthId)
        .eq('active_in_month', true)
        .eq('postponed', false)
      
      if (prevItems && prevItems.length > 0) {
        // Enriquecer con estados de edición temporal
        setPrevItemsToCopy(prevItems.map((item: any) => ({
          ...item,
          checked: true,
          temp_budget: item.budget_amount,
        })))
        setStep('preview')
        return
      } else {
        // Si hay mes anterior pero no tiene gastos, crear de inmediato (copiando ingresos recurrentes)
        createMonth.mutate({ customItems: [] })
      }
    } else {
      // Si no hay mes anterior (es el primer mes / onboarding)
      // Mostrar paso de onboarding de ingresos recurrentes
      setStep('onboarding_incomes')
    }
  }

  const createMonth = useMutation({
    mutationFn: async ({ customItems, initialIncomes }: { customItems?: any[]; initialIncomes?: any[] } = {}) => {
      // Find previous month (usually the most recent one)
      const { data: prevMonths } = await db.from('budget_months')
        .select('id')
        .eq('family_id', profile!.family_id!)
        .order('year', { ascending: false })
        .order('month', { ascending: false })
        .limit(1)
      
      const prevMonthId = prevMonths?.[0]?.id

      const { data: newMonth, error } = await db.from('budget_months').insert({
        family_id: profile!.family_id!,
        year,
        month,
        status: 'active',
        currency: 'COP',
        copied_from_month_id: prevMonthId || null,
      }).select().single()

      if (error) throw error

      // 1. Si hay un mes anterior, copiar automáticamente ingresos recurrentes (is_recurring = true)
      if (prevMonthId && newMonth) {
        const { data: prevIncomes } = await db.from('monthly_income_items')
          .select('*')
          .eq('month_id', prevMonthId)
          .eq('is_recurring', true)

        if (prevIncomes && prevIncomes.length > 0) {
          const newIncomesToInsert = prevIncomes.map((inc: any) => {
            let newExpectedDate = null
            if (inc.expected_date) {
              const day = parseInt(inc.expected_date.split('-')[2], 10)
              const lastDayOfMonth = new Date(year, month, 0).getDate()
              const validDay = Math.min(day, lastDayOfMonth)
              newExpectedDate = `${year}-${String(month).padStart(2, '0')}-${String(validDay).padStart(2, '0')}`
            }

            return {
              month_id: newMonth.id,
              family_id: profile!.family_id!,
              label: inc.label,
              gross_amount: inc.gross_amount,
              deduction_type: inc.deduction_type,
              deduction_rate: inc.deduction_rate,
              deduction_amount: inc.deduction_amount,
              expected_date: newExpectedDate,
              received_amount: 0,
              status: 'pending',
              is_recurring: true,
            }
          })
          await db.from('monthly_income_items').insert(newIncomesToInsert)
        }
      }

      // 2. Si se pasaron ingresos iniciales (onboarding primer mes)
      if (newMonth && initialIncomes && initialIncomes.length > 0) {
        const incomesToInsert = initialIncomes.map((inc: any) => ({
          month_id: newMonth.id,
          family_id: profile!.family_id!,
          label: inc.label,
          gross_amount: Number(inc.gross_amount) || 0,
          deduction_type: 'none',
          deduction_rate: 0,
          deduction_amount: 0,
          expected_date: null,
          received_amount: 0,
          status: 'pending',
          is_recurring: true,
        }))
        await db.from('monthly_income_items').insert(incomesToInsert)
      }

      // 3. Copiar gastos si hay mes anterior
      if (prevMonthId && newMonth) {
        // Usar los ítems seleccionados y personalizados por el usuario
        const itemsToInsert = customItems
          ? customItems.filter(i => i.checked)
          : []
        
        if (itemsToInsert.length > 0) {
          const newItems = itemsToInsert.map((item: any) => {
            const executed = item.executed_amount_cached || 0
            const deferred = item.deferred_amount || 0
            const target = (item.budget_amount || 0) + (item.arrears_amount || 0)
            const shortfall = Math.max(0, target - executed - deferred)
            
            // RN-mora v2: Solo los gastos Variables son ahorro (no generan mora).
            // Fijos y Esporádicos siempre generan mora si quedan sin pagar.
            const carriesArrears = item.expense_type !== 'variable'
            const newArrears = carriesArrears ? shortfall : 0

            let newDueDate = item.due_date
            if (item.due_date) {
              const day = parseInt(item.due_date.split('-')[2], 10)
              const lastDayOfMonth = new Date(year, month, 0).getDate()
              const validDay = Math.min(day, lastDayOfMonth)
              newDueDate = `${year}-${String(month).padStart(2, '0')}-${String(validDay).padStart(2, '0')}`
            }

            return {
              family_id: profile!.family_id!,
              month_id: newMonth.id,
              category_id: item.category_id,
              concept_id: item.concept_id,
              expense_type: item.expense_type,
              criticality: item.criticality,
              due_mode: item.due_mode,
              due_date: newDueDate,
              budget_amount: Number(item.temp_budget) || 0, // Monto personalizado ingresado en el wizard
              arrears_amount: newArrears,
              executed_amount_cached: 0,
              deferred_amount: 0,
              status: 'pending',
              active_in_month: true,
              postponed: false,
              is_mora_item: false,
            }
          })
          
          await db.from('monthly_expense_items').insert(newItems)
        }

        // Gastos pospuestos: crear ítem "- Mora" separado en el nuevo mes
        const { data: postponedItems } = await db.from('monthly_expense_items')
          .select('*')
          .eq('month_id', prevMonthId)
          .eq('active_in_month', true)
          .eq('postponed', true)

        if (postponedItems && postponedItems.length > 0) {
          const moraItems = postponedItems.map((item: any) => {
            const unpaid = Math.max(0, (item.budget_amount + item.arrears_amount) - item.executed_amount_cached)
            const dueDate = `${year}-${String(month).padStart(2, '0')}-01`
            return {
              family_id: profile!.family_id!,
              month_id: newMonth.id,
              category_id: item.category_id,
              concept_id: item.concept_id,
              expense_type: 'fixed',
              criticality: 'critical',
              due_mode: 'exact',
              due_date: dueDate,
              budget_amount: unpaid,
              arrears_amount: 0,
              executed_amount_cached: 0,
              deferred_amount: 0,
              status: 'pending',
              active_in_month: true,
              postponed: false,
              is_mora_item: true,
            }
          }).filter((i: any) => i.budget_amount > 0)

          if (moraItems.length > 0) {
            await db.from('monthly_expense_items').insert(moraItems)
          }
        }
      }

      // 4. Inyección automática de gastos periódicos
      if (newMonth) {
        const { data: periodicItems } = await db.from('periodic_expenses')
          .select('*')
          .eq('family_id', profile!.family_id!)
          .eq('active', true)

        if (periodicItems && periodicItems.length > 0) {
          const periodicToInject = periodicItems.filter((p: any) => {
            const intervalMonths = p.periodicity === 'quarterly' ? 3 : p.periodicity === 'semi_annual' ? 6 : 12
            // Calcular meses de diferencia desde el inicio hasta el mes a crear
            const diffMonths = (year - p.start_year) * 12 + (month - p.start_month)
            // Corresponde si diffMonths >= 0 y es múltiplo del intervalo
            return diffMonths >= 0 && diffMonths % intervalMonths === 0
          })

          if (periodicToInject.length > 0) {
            const periodicExpenseItems = periodicToInject.map((p: any) => {
              const lastDayOfMonth = new Date(year, month, 0).getDate()
              const dueDay = p.due_day ? Math.min(p.due_day, lastDayOfMonth) : null
              const dueDate = dueDay ? `${year}-${String(month).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}` : null
              return {
                family_id: profile!.family_id!,
                month_id: newMonth.id,
                category_id: p.category_id,
                concept_id: p.concept_id,
                expense_type: 'sporadic',
                criticality: p.criticality,
                due_mode: 'exact',
                due_date: dueDate,
                budget_amount: p.amount,
                arrears_amount: 0,
                executed_amount_cached: 0,
                deferred_amount: 0,
                status: 'pending',
                active_in_month: true,
              }
            })
            await db.from('monthly_expense_items').insert(periodicExpenseItems)
          }
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget_months'] })
      qc.invalidateQueries({ queryKey: ['active_month'] })
      setShowForm(false)
    },
  })

  const closeMonth = useMutation({
    mutationFn: async (id: string) => {
      await db.from('budget_months').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget_months'] })
      qc.invalidateQueries({ queryKey: ['active_month'] })
    },
  })

  const yearOptions = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1)

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Mes presupuestal</h1>
          <p className="text-slate-400 text-sm mt-0.5">Controla el mes financiero de tu familia</p>
        </div>
        <button
          className="btn-primary flex items-center gap-2"
          disabled={!!activeMonth}
          onClick={() => setShowForm(true)}
          title={activeMonth ? 'Cierra el mes activo antes de crear uno nuevo' : ''}
        >
          <Plus size={16} /> Nuevo mes
        </button>
      </div>

      {/* Mes activo banner */}
      {activeMonth && (
        <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
              <Calendar className="text-indigo-400" size={18} />
            </div>
            <div>
              <p className="text-indigo-300 text-xs font-medium uppercase tracking-wide">Mes activo</p>
              <p className="text-white font-semibold capitalize">
                {monthName(activeMonth.month)} {activeMonth.year}
              </p>
            </div>
          </div>
          <button
            className="text-xs text-slate-400 hover:text-red-400 border border-slate-700 hover:border-red-400/40 px-3 py-1.5 rounded-lg transition-all"
            onClick={() => { if (confirm('¿Cerrar el mes? Esta acción generará la mora para el siguiente mes.')) closeMonth.mutate(activeMonth.id) }}
          >
            <Lock size={12} className="inline mr-1" /> Cerrar mes
          </button>
        </div>
      )}

      {/* Formulario nuevo mes (Wizard Paso 1 y Paso 2) */}
      {showForm && step === 'config' && (
        <div className="card border-indigo-500/30 space-y-4">
          <h2 className="text-white font-semibold">Crear nuevo mes</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Año</label>
              <select className="input w-full" value={year} onChange={e => setYear(Number(e.target.value))}>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Mes</label>
              <select className="input w-full" value={month} onChange={e => setMonth(Number(e.target.value))}>
                {monthOptions.map(m => (
                  <option key={m} value={m}>{monthName(m)}</option>
                ))}
              </select>
            </div>
          </div>
          {createMonth.isError && (
            <p className="text-red-400 text-sm bg-red-400/10 p-3 rounded-lg mt-2">
              Error al crear el mes: {createMonth.error?.message || 'Error desconocido'}. 
              <br/>Intenta recargar la página.
            </p>
          )}
          <div className="flex gap-3 justify-end">
            <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancelar</button>
            <button className="btn-primary" onClick={handleProceedToPreview}>
              Siguiente (Ajustar plan) →
            </button>
          </div>
        </div>
      )}

      {showForm && step === 'preview' && (
        <div className="card border-indigo-500/30 space-y-4 max-h-[85vh] flex flex-col">
          <div className="flex-shrink-0">
            <h2 className="text-white font-semibold">Personalizar Plan de Gastos ({monthName(month)} {year})</h2>
            <p className="text-slate-400 text-xs mt-1">
              Desmarca los gastos que no aplican para este nuevo mes o ajusta sus presupuestos iniciales directamente.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto pr-1 space-y-2.5 max-h-[50vh] min-h-[150px] scrollbar-thin">
            {prevItemsToCopy.map((item, index) => {
              const catName = categories.find(c => c.id === item.category_id)?.name ?? 'Sin Categoría'
              const conName = concepts.find(c => c.id === item.concept_id)?.name ?? 'Gasto'
              
              return (
                <div 
                  key={item.id} 
                  className={clsx(
                    "flex items-center gap-3 p-3 rounded-xl border transition-all",
                    item.checked 
                      ? "bg-slate-800/40 border-slate-700/60" 
                      : "bg-slate-900/10 border-slate-850/40 opacity-40"
                  )}
                >
                  <input 
                    type="checkbox" 
                    className="rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900 w-5 h-5 cursor-pointer accent-indigo-500"
                    checked={item.checked}
                    onChange={e => {
                      const updated = [...prevItemsToCopy]
                      updated[index].checked = e.target.checked
                      setPrevItemsToCopy(updated)
                    }}
                  />
                  
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{catName}</p>
                    <p className="text-sm font-medium text-slate-200 truncate mt-0.5">{conName}</p>
                    <span className={clsx(
                      "text-[9px] px-1.5 py-0.5 rounded border uppercase tracking-wide font-medium mt-1 inline-block",
                      item.expense_type === 'variable' 
                        ? "bg-emerald-500/10 text-emerald-455 border-emerald-500/20" 
                        : "bg-orange-500/10 text-orange-400 border-orange-500/20"
                    )}>
                      {item.expense_type === 'variable' ? 'Sobre / Bolsillo' : 'Obligación'}
                    </span>
                  </div>

                  <div className="w-28 flex-shrink-0">
                    <label className="text-[10px] text-slate-500 block mb-0.5 text-right font-medium">Monto</label>
                    <CurrencyInput 
                      className="input w-full text-right py-1 h-8 bg-slate-800 border-slate-700 text-xs font-semibold text-white focus:border-indigo-500"
                      disabled={!item.checked}
                      value={item.temp_budget}
                      onChange={val => {
                        const updated = [...prevItemsToCopy]
                        updated[index].temp_budget = val
                        setPrevItemsToCopy(updated)
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {createMonth.isError && (
            <p className="text-red-400 text-sm bg-red-400/10 p-3 rounded-lg mt-2 flex-shrink-0">
              Error al crear el mes: {createMonth.error?.message || 'Error desconocido'}.
            </p>
          )}

          <div className="flex gap-3 justify-end pt-3 border-t border-slate-800/80 flex-shrink-0">
            <button className="btn-ghost" onClick={() => setStep('config')}>Atrás</button>
            <button 
              className="btn-primary" 
              disabled={createMonth.isPending} 
              onClick={() => createMonth.mutate({ customItems: prevItemsToCopy })}
            >
              {createMonth.isPending ? 'Creando...' : 'Confirmar y Crear Mes'}
            </button>
          </div>
        </div>
      )}

      {showForm && step === 'onboarding_incomes' && (
        <div className="card border-indigo-500/30 space-y-4 max-h-[85vh] flex flex-col">
          <div className="flex-shrink-0">
            <h2 className="text-white font-semibold">Configuración de Ingresos Recurrentes</h2>
            <p className="text-slate-400 text-xs mt-1">
              Establece las fuentes de ingresos mensuales de tu hogar. Se crearán como plantillas que se copiarán mes a mes.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto pr-1 space-y-2.5 max-h-[50vh] min-h-[150px] scrollbar-thin">
            {onboardingIncomes.map((item, index) => (
              <div 
                key={item.id} 
                className={clsx(
                  "flex items-center gap-3 p-3 rounded-xl border transition-all",
                  item.checked 
                    ? "bg-slate-800/40 border-slate-700/60" 
                    : "bg-slate-900/10 border-slate-850/40 opacity-40"
                )}
              >
                <input 
                  type="checkbox" 
                  className="rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900 w-5 h-5 cursor-pointer accent-indigo-500"
                  checked={item.checked}
                  onChange={e => {
                    const updated = [...onboardingIncomes]
                    updated[index].checked = e.target.checked
                    setOnboardingIncomes(updated)
                  }}
                />
                
                <div className="flex-1 min-w-0">
                  <label className="text-[10px] text-slate-500 block mb-0.5 font-medium">Concepto</label>
                  <input 
                    type="text" 
                    className="input w-full py-1 h-8 bg-slate-800 border-slate-700 text-xs font-semibold text-white focus:border-indigo-500"
                    disabled={!item.checked}
                    value={item.label}
                    onChange={e => {
                      const updated = [...onboardingIncomes]
                      updated[index].label = e.target.value
                      setOnboardingIncomes(updated)
                    }}
                    placeholder="Nombre del ingreso"
                  />
                </div>

                <div className="w-32 flex-shrink-0">
                  <label className="text-[10px] text-slate-500 block mb-0.5 text-right font-medium">Monto Esperado</label>
                  <CurrencyInput 
                    className="input w-full text-right py-1 h-8 bg-slate-800 border-slate-700 text-xs font-semibold text-white focus:border-indigo-500"
                    disabled={!item.checked}
                    value={item.gross_amount}
                    onChange={val => {
                      const updated = [...onboardingIncomes]
                      updated[index].gross_amount = val
                      setOnboardingIncomes(updated)
                    }}
                  />
                </div>

                <button
                  type="button"
                  className="p-1.5 mt-4 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all self-center"
                  onClick={() => {
                    setOnboardingIncomes(onboardingIncomes.filter(i => i.id !== item.id))
                  }}
                  title="Eliminar ingreso"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-medium text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 hover:border-indigo-500/30 rounded-xl transition-all self-start mt-2"
            onClick={() => {
              setOnboardingIncomes([
                ...onboardingIncomes,
                { id: `custom-${Date.now()}`, label: '', gross_amount: 0, checked: true }
              ])
            }}
          >
            <Plus size={14} /> Agregar otro ingreso
          </button>

          {createMonth.isError && (
            <p className="text-red-400 text-sm bg-red-400/10 p-3 rounded-lg mt-2 flex-shrink-0">
              Error al crear el mes: {createMonth.error?.message || 'Error desconocido'}.
            </p>
          )}

          <div className="flex gap-3 justify-end pt-3 border-t border-slate-800/80 flex-shrink-0">
            <button className="btn-ghost" onClick={() => setStep('config')}>Atrás</button>
            <button 
              className="btn-primary" 
              disabled={createMonth.isPending} 
              onClick={() => {
                const validIncomes = onboardingIncomes.filter(i => i.checked && i.label.trim() !== '')
                createMonth.mutate({ initialIncomes: validIncomes })
              }}
            >
              {createMonth.isPending ? 'Creando...' : 'Confirmar y Crear Mes'}
            </button>
          </div>
        </div>
      )}

      {/* Historial de meses */}
      <div className="card space-y-2">
        <h2 className="text-white font-semibold">Historial de meses</h2>
        {isLoading && <p className="text-slate-500 text-sm">Cargando...</p>}
        {!isLoading && months.length === 0 && (
          <p className="text-slate-500 text-sm text-center py-8">No hay meses aún. Crea el primero.</p>
        )}
        {months.map(m => (
          <div key={m.id} className={clsx(
            'flex items-center gap-4 px-4 py-3 rounded-xl border transition-all',
            m.status === 'active'
              ? 'bg-indigo-500/10 border-indigo-500/30'
              : 'bg-slate-800/40 border-slate-700/40'
          )}>
            <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
              m.status === 'active' ? 'bg-indigo-500/20' : 'bg-slate-700/50')}>
              <Calendar size={16} className={m.status === 'active' ? 'text-indigo-400' : 'text-slate-400'} />
            </div>
            <div className="flex-1">
              <p className="text-slate-200 text-sm font-medium capitalize">{monthName(m.month)} {m.year}</p>
              <p className="text-xs text-slate-500">{m.status === 'active' ? 'Mes activo' : `Cerrado ${m.closed_at ? new Date(m.closed_at).toLocaleDateString('es-CO') : ''}`}</p>
            </div>
            <span className={clsx('text-xs px-2.5 py-1 rounded-full border',
              m.status === 'active'
                ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                : 'bg-slate-700/30 text-slate-500 border-slate-700/30'
            )}>
              {m.status === 'active' ? 'Activo' : 'Cerrado'}
            </span>
            <ChevronRight size={15} className="text-slate-600" />
          </div>
        ))}
      </div>
    </div>
  )
}
