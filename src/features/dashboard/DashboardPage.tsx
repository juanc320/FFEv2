import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from '@/lib/db'
import { useAuth } from '@/features/auth/AuthContext'
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Clock, Wallet, Receipt, ArrowRightLeft, Shield, PiggyBank } from 'lucide-react'
import { formatCOP, monthName } from '@/shared/utils/calculations'
import { syncPeriodicExpenses } from '@/shared/utils/periodicSync'
import clsx from 'clsx'
import type { Account, BudgetMonth, MonthlyExpenseItem, MonthlyIncomeItem, Transaction } from '@/shared/types/database'

function StatCard({ label, value, sub, icon: Icon, color, id }: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; color: string; id: string
}) {
  return (
    <div id={id} className="card flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
      <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', color)}>
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-slate-400 text-xs font-medium uppercase tracking-wide leading-tight">{label}</p>
        <p className="text-white text-lg font-bold mt-0.5 leading-tight truncate">{value}</p>
        {sub && <p className="text-slate-500 text-xs mt-0.5 leading-tight">{sub}</p>}
      </div>
    </div>
  )
}

function useDashboardData() {
  const { profile } = useAuth()
  
  return useQuery({
    queryKey: ['dashboard', profile?.family_id],
    queryFn: async () => {
      const familyId = profile!.family_id!
      
      // 1. Get active month
      const { data: month } = await db.from('budget_months')
        .select('*')
        .eq('family_id', familyId)
        .eq('status', 'active')
        .maybeSingle()

      // 2. Get accounts
      const { data: accounts } = await db.from('accounts')
        .select('*')
        .eq('family_id', familyId)
        
      // 3. Get all transactions to calculate account balances
      const { data: allTransactions } = await db.from('transactions')
        .select('*')
        .eq('family_id', familyId)

      // 4. Get active month items if month exists
      let expenses: MonthlyExpenseItem[] = []
      let incomes: MonthlyIncomeItem[] = []
      
      if (month) {
        const [expRes, incRes] = await Promise.all([
          db.from('monthly_expense_items').select('*, categories(name), concepts(name)').eq('month_id', month.id).eq('active_in_month', true),
          db.from('monthly_income_items').select('*').eq('month_id', month.id)
        ])
        expenses = expRes.data || []
        incomes = incRes.data || []
      }

      // Calculate account balances
      const accountsWithBalance = (accounts || []).map((acc: Account) => {
        let balance = acc.opening_balance || 0
        ;(allTransactions || []).forEach((t: Transaction) => {
          if (t.destination_account_id === acc.id) balance += Number(t.amount)
          if (t.source_account_id === acc.id) balance -= (Number(t.amount) + Number(t.tax_amount || 0))
        })
        return { ...acc, current_balance: balance }
      }).sort((a: any, b: any) => b.current_balance - a.current_balance)

      const totalBalance = accountsWithBalance.reduce((sum: number, acc: Account & { current_balance: number }) => sum + acc.current_balance, 0)

      // Month specific stats
      let pendingIncome = 0
      let pendingExpenses = 0
      let arrears = 0
      let deferred = 0
      let totalBudgeted = 0
      let totalIncomeExpected = 0

      // Map and enrich all expenses
      const allExpenses = expenses.map(exp => {
        const budget = Number(exp.budget_amount) || 0
        const arr = Number(exp.arrears_amount) || 0
        const def = Number(exp.deferred_amount) || 0
        
        let executed = 0
        ;(allTransactions || []).forEach((t: Transaction) => {
          if (t.expense_item_id === exp.id && t.month_id === month?.id && t.type === 'expense') {
            executed += Number(t.amount)
          }
        })
        
        const available = budget + arr - executed - def
        const pct = budget > 0 ? (executed / budget) * 100 : 0
        
        pendingExpenses += Math.max(available, 0)
        arrears += arr
        deferred += def
        totalBudgeted += budget
        
        const name = (exp as any).concepts?.name || (exp as any).categories?.name || 'Gasto'
        return { ...exp, available, executed, pct, name }
      })

      // Separate into Envelopes (variable) and Obligations (fixed, sporadic)
      const envelopes = allExpenses
        .filter(e => e.expense_type === 'variable')
        .sort((a: any, b: any) => b.available - a.available)

      const obligations = allExpenses
        .filter(e => e.expense_type === 'fixed' || e.expense_type === 'sporadic')
        .sort((a: any, b: any) => {
          if (!a.due_date && !b.due_date) return 0
          if (!a.due_date) return 1
          if (!b.due_date) return -1
          return a.due_date.localeCompare(b.due_date)
        })

      // Income calculation
      const pendingIncomeItems = incomes.map(inc => {
        const expected = Number((inc as any).net_expected) || 0
        const received = Number(inc.received_amount) || 0
        
        totalIncomeExpected += expected
        const pending = Math.max(expected - received, 0)
        pendingIncome += pending
        
        return { ...inc, expected, received, pending, status: pending === 0 ? 'paid' : received > 0 ? 'partial' : 'pending' }
      }).filter(inc => inc.pending > 0)

      // Filter only pending obligations for the critical/obligations section
      const pendingObligations = obligations
        .filter(e => e.available > 0)
        .map(e => {
          let statusLabel = 'Pendiente'
          if (e.executed > 0) {
            statusLabel = `Abonado (${Math.round((e.executed / (e.budget_amount + e.arrears_amount)) * 100)}%)`
          }
          return {
            ...e,
            statusLabel
          }
        })
        .slice(0, 5)

      const projected = totalBalance + pendingIncome - pendingExpenses

      return {
        month,
        accounts: accountsWithBalance,
        totalBalance,
        pendingIncome,
        pendingExpenses,
        arrears,
        deferred,
        totalBudgeted,
        totalIncomeExpected,
        projected,
        envelopes,
        obligations,
        pendingIncomeItems,
        pendingObligations
      }
    },
    enabled: !!profile?.family_id
  })
}

export default function DashboardPage() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const { data, isLoading } = useDashboardData()

  // Correr la sincronización de gastos periódicos al montar el dashboard
  useEffect(() => {
    if (profile?.family_id) {
      syncPeriodicExpenses(profile.family_id).then(() => {
        qc.invalidateQueries({ queryKey: ['dashboard'] })
      })
    }
  }, [profile?.family_id, qc])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!data || !data.month) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-slate-400 text-sm mt-0.5">Estado financiero del mes familiar</p>
        </div>
        <div className="card text-center py-12">
          <p className="text-slate-400 mb-4">No hay un mes activo actualmente.</p>
          <a href="/months" className="btn-primary inline-block">Crear mes presupuestal</a>
        </div>
      </div>
    )
  }

  const {
    month, accounts, totalBalance, pendingIncome, pendingExpenses, arrears, deferred, 
    projected, envelopes, pendingIncomeItems, pendingObligations
  } = data

  const isRed = projected < 0
  const monthLabel = `${monthName(month.month)} ${month.year}`

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white capitalize">{monthLabel}</h1>
          <p className="text-slate-400 text-sm mt-0.5">Estado financiero del mes familiar</p>
        </div>
        <div className={clsx(
          'inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border',
          isRed
            ? 'bg-red-500/15 border-red-500/40 text-red-400'
            : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
        )}>
          {isRed ? <TrendingDown size={16} /> : <TrendingUp size={16} />}
          {isRed ? 'Mes en rojo' : 'Mes en negro'}
          <span className="font-bold">{formatCOP(Math.abs(projected))}</span>
          {isRed ? 'déficit' : 'proyectado'}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          id="kpiBalance"
          label="Saldo actual"
          value={formatCOP(totalBalance)}
          sub="En todas las cuentas"
          icon={Wallet}
          color="bg-indigo-500/15 text-indigo-400"
        />
        <StatCard
          id="kpiIncomePending"
          label="Ingresos pendientes"
          value={formatCOP(pendingIncome)}
          sub="Por recibir este mes"
          icon={TrendingUp}
          color="bg-emerald-500/15 text-emerald-400"
        />
        <StatCard
          id="kpiExpensesPending"
          label="Gastos pendientes"
          value={formatCOP(pendingExpenses)}
          sub="Sin incluir diferidos"
          icon={Receipt}
          color="bg-amber-500/15 text-amber-400"
        />
        <StatCard
          id="kpiArrears"
          label="Mora / diferidos"
          value={formatCOP(arrears + deferred)}
          sub={`Mora ${formatCOP(arrears)} · Diferido ${formatCOP(deferred)}`}
          icon={AlertTriangle}
          color="bg-red-500/15 text-red-400"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Cuentas */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-white font-semibold">Cuentas</h2>
            <a href="/accounts" className="text-indigo-400 text-xs hover:text-indigo-300 transition-colors">Ver todas →</a>
          </div>
          <div className="space-y-3">
            {accounts.length === 0 ? (
              <p className="text-slate-500 text-sm">No tienes cuentas. <a href="/accounts" className="text-indigo-400">Crear una.</a></p>
            ) : accounts.map((acc: Account & { current_balance: number }) => (
              <div key={acc.id} className="flex items-center justify-between py-2 border-b border-slate-800 last:border-0">
                <div className="flex items-center gap-3">
                  <div className={clsx(
                    'w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold',
                    acc.type === 'bank' ? 'bg-indigo-500/20 text-indigo-400'
                    : acc.type === 'cash' ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-slate-700 text-slate-300'
                  )}>
                    {acc.name.charAt(0)}
                  </div>
                  <div>
                    <p className="text-slate-200 text-sm font-medium leading-tight">{acc.name}</p>
                    {acc.applies_4x1000 && (
                      <span className="text-amber-400/70 text-xs">4×1000</span>
                    )}
                  </div>
                </div>
                <p className={clsx("font-semibold text-sm", acc.current_balance < 0 ? "text-red-400" : "text-white")}>
                  {formatCOP(acc.current_balance)}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Sobres / Envelopes */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-white font-semibold flex items-center gap-1.5">
              <PiggyBank size={16} className="text-indigo-400" />
              Tus Sobres (Consumo)
            </h2>
            <a href="/expenses" className="text-indigo-400 text-xs hover:text-indigo-300 transition-colors">Ver todos →</a>
          </div>
          <div className="space-y-3.5">
            {envelopes.length === 0 ? (
               <p className="text-slate-500 text-sm">No hay sobres activos. <a href="/expenses" className="text-indigo-400">Crear uno.</a></p>
            ) : envelopes.slice(0, 5).map(env => (
              <div key={env.id} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-slate-350 text-xs font-medium truncate max-w-[150px]">{env.name}</p>
                  <p className={clsx(
                    'text-xs font-semibold flex-shrink-0',
                    env.available <= 0 ? 'text-red-400' : env.pct >= 75 ? 'text-amber-400' : 'text-emerald-400'
                  )}>
                    {formatCOP(env.available)}
                  </p>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={clsx(
                      'h-full rounded-full transition-all duration-300',
                      env.available < 0 ? 'bg-red-500' : env.pct >= 75 ? 'bg-amber-500' : 'bg-emerald-550'
                    )}
                    style={{ width: `${env.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Cuentas por Pagar (Obligaciones) e Ingresos */}
        <div className="space-y-4">
          {/* Obligaciones */}
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-white font-semibold flex items-center gap-1.5">
                <Shield size={16} className="text-orange-400" />
                Cuentas por Pagar
              </h2>
              <a href="/expenses" className="text-indigo-400 text-xs hover:text-indigo-300 transition-colors">Ver todas →</a>
            </div>
            <div className="space-y-2">
              {pendingObligations.length === 0 ? (
                <p className="text-slate-500 text-sm py-2">No tienes obligaciones pendientes. ¡Excelente!</p>
              ) : pendingObligations.map(exp => (
                <div key={exp.id} className="flex items-center gap-3 py-2 border-b border-slate-800 last:border-0">
                  <Clock size={14} className={clsx("flex-shrink-0", exp.executed > 0 ? "text-sky-400" : "text-orange-400")} />
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-300 text-xs font-medium truncate">{exp.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {exp.due_date && (
                        <p className="text-slate-500 text-[10px] flex items-center gap-0.5">
                          <span>Vence:</span>
                          <span className="text-slate-400">{exp.due_date.split('-').reverse().slice(0, 2).join('/')}</span>
                        </p>
                      )}
                      <span className={clsx("text-[9px] px-1.5 py-0.5 rounded border uppercase tracking-wide font-medium", exp.executed > 0 ? "bg-sky-500/10 text-sky-400 border-sky-500/20" : "bg-orange-500/10 text-orange-400 border-orange-500/20")}>
                        {exp.statusLabel}
                      </span>
                      {Number(exp.arrears_amount) > 0 && Number(exp.executed) < Number(exp.arrears_amount) && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded border uppercase tracking-wide font-bold bg-red-500/10 text-red-400 border-red-500/20">
                          Mora: {formatCOP(Number(exp.arrears_amount))}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-white text-xs font-semibold flex-shrink-0">
                    {formatCOP(exp.available)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Ingresos pendientes */}
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-white font-semibold">Ingresos pendientes</h2>
              <a href="/income" className="text-indigo-400 text-xs hover:text-indigo-300 transition-colors">Ver →</a>
            </div>
            <div className="space-y-2">
              {pendingIncomeItems.length === 0 ? (
                <p className="text-slate-500 text-sm">No hay ingresos pendientes.</p>
              ) : pendingIncomeItems.map(inc => (
                <div key={inc.id} className="flex items-center gap-3 py-1.5 border-b border-slate-800 last:border-0">
                  <ArrowRightLeft size={15} className={clsx(
                    'flex-shrink-0',
                    inc.status === 'partial' ? 'text-amber-400' : 'text-indigo-400'
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-300 text-xs font-medium truncate">{inc.label}</p>
                    <p className="text-slate-500 text-xs">
                      {inc.status === 'partial' ? 'Parcial · ' : ''}{inc.expected_date}
                    </p>
                  </div>
                  <p className="text-emerald-400 text-xs font-semibold flex-shrink-0">
                    {formatCOP(inc.pending)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Alerta de mora */}
      {(arrears > 0 || deferred > 0) && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl px-5 py-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-orange-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-orange-300 text-sm font-semibold">Tienes saldos pendientes</p>
            <p className="text-orange-400/70 text-xs mt-0.5">
              Mora acumulada: {formatCOP(arrears)} · Gastos Diferidos: {formatCOP(deferred)}. 
              Revisa y planifica su pago este mes desde tu Plan de Gastos.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
