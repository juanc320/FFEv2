import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useAuth } from '@/features/auth/AuthContext'
import type { BudgetMonth } from '@/shared/types/database'
import { monthName } from '@/shared/utils/calculations'
import { Calendar, Plus, Lock, ChevronRight } from 'lucide-react'
import clsx from 'clsx'

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

  const activeMonth = months.find(m => m.status === 'active')

  const createMonth = useMutation({
    mutationFn: async () => {
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

      if (prevMonthId && newMonth) {
        // Fetch items from prev month
        const { data: prevItems } = await db.from('monthly_expense_items')
          .select('*')
          .eq('month_id', prevMonthId)
          .eq('active_in_month', true)
        
        if (prevItems && prevItems.length > 0) {
          const newItems = prevItems.map((item: any) => {
            const executed = item.executed_amount_cached || 0
            const deferred = item.deferred_amount || 0
            const target = (item.budget_amount || 0) + (item.arrears_amount || 0)
            const shortfall = Math.max(0, target - executed - deferred)
            
            // RN-mora: only critical and necessary carry over arrears automatically
            const carriesArrears = ['critical', 'necessary'].includes(item.criticality)
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
              budget_amount: item.budget_amount,
              arrears_amount: newArrears,
              executed_amount_cached: 0,
              deferred_amount: 0,
              status: 'pending',
              active_in_month: true
            }
          })
          
          await db.from('monthly_expense_items').insert(newItems)
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

      {/* Formulario nuevo mes */}
      {showForm && (
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
            <button className="btn-primary" disabled={createMonth.isPending} onClick={() => createMonth.mutate()}>
              {createMonth.isPending ? 'Creando...' : 'Crear mes'}
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
