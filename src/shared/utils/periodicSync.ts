import { db } from '@/lib/db'

/**
 * Calcula la fecha límite correcta basada en el año, mes y día de corte/vencimiento.
 * Si el día es >= 30, se toma el mes anterior (para alinearse con el fin de mes contable/presupuestal).
 */
export function getDueDateForAccountingMonth(year: number, month: number, dueDay: number): string {
  let targetYear = year
  let targetMonth = month
  
  if (dueDay >= 30) {
    targetMonth = month - 1
    if (targetMonth === 0) {
      targetMonth = 12
      targetYear = year - 1
    }
  }
  
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth, 0).getDate()
  const validDay = Math.min(dueDay, lastDayOfTargetMonth)
  
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(validDay).padStart(2, '0')}`
}

/**
 * Sincroniza los gastos periódicos de una familia con el mes presupuestal activo actual.
 * Agrupa los elementos por concepto para permitir que múltiples gastos periódicos
 * con la misma categoría y concepto se inserten y actualicen de forma independiente
 * sin sobrescribirse entre sí.
 */
export async function syncPeriodicExpenses(familyId: string) {
  if (!familyId) return

  // 1. Obtener el mes activo actual
  const { data: activeMonth, error: monthErr } = await db
    .from('budget_months')
    .select('*')
    .eq('family_id', familyId)
    .eq('status', 'active')
    .maybeSingle()

  if (monthErr || !activeMonth) return

  // 2. Obtener gastos periódicos activos de la familia
  const { data: periodicItems, error: periodicErr } = await db
    .from('periodic_expenses')
    .select('*')
    .eq('family_id', familyId)
    .eq('active', true)

  if (periodicErr || !periodicItems) return

  // 3. Obtener ítems mensuales de tipo 'sporadic' (gastos periódicos inyectados) para el mes activo
  const { data: existingItems, error: itemsErr } = await db
    .from('monthly_expense_items')
    .select('*')
    .eq('month_id', activeMonth.id)
    .eq('expense_type', 'sporadic')

  if (itemsErr || !existingItems) return

  const { year, month } = activeMonth

  // 4. Filtrar cuáles de los gastos periódicos corresponden a este mes activo
  const periodicToInject = (periodicItems as any[]).filter((p: any) => {
    // Si no tiene concepto o categoría válidos, no se puede inyectar (evita violar RLS/constraints)
    if (!p.concept_id || !p.category_id) return false

    const intervalMonths = p.periodicity === 'quarterly' ? 3 : p.periodicity === 'semi_annual' ? 6 : 12
    const diffMonths = (year - p.start_year) * 12 + (month - p.start_month)
    return diffMonths >= 0 && diffMonths % intervalMonths === 0
  })

  // 5. Agrupar por concept_id para hacer un emparejamiento posicional
  const periodicByConcept: Record<string, any[]> = {}
  for (const p of periodicToInject) {
    if (!periodicByConcept[p.concept_id]) periodicByConcept[p.concept_id] = []
    periodicByConcept[p.concept_id].push(p)
  }

  const existingByConcept: Record<string, any[]> = {}
  for (const item of (existingItems as any[])) {
    if (!existingByConcept[item.concept_id]) existingByConcept[item.concept_id] = []
    existingByConcept[item.concept_id].push(item)
  }

  // Obtener todos los concept_ids únicos involucrados
  const allConcepts = new Set([
    ...Object.keys(periodicByConcept),
    ...Object.keys(existingByConcept)
  ])

  // 6. Sincronizar cada concepto
  for (const conceptId of allConcepts) {
    const P_c = periodicByConcept[conceptId] || []
    const E_c = existingByConcept[conceptId] || []
    const limit = Math.max(P_c.length, E_c.length)

    for (let i = 0; i < limit; i++) {
      const p = P_c[i]
      const existing = E_c[i]

      if (p && !existing) {
        // Insertar nuevo ítem para este concepto en el mes
        const dueDate = p.due_day ? getDueDateForAccountingMonth(year, month, p.due_day) : null
        await db.from('monthly_expense_items').insert({
          family_id: familyId,
          month_id: activeMonth.id,
          category_id: p.category_id,
          concept_id: p.concept_id,
          expense_type: 'sporadic',
          criticality: p.criticality,
          due_mode: 'once',
          due_date: dueDate,
          budget_amount: p.amount,
          arrears_amount: 0,
          executed_amount_cached: 0,
          deferred_amount: 0,
          status: 'pending',
          active_in_month: true,
        })
      } else if (p && existing) {
        // Actualizar el ítem existente si difieren los valores clave
        const dueDate = p.due_day ? getDueDateForAccountingMonth(year, month, p.due_day) : null
        if (
          Number(existing.budget_amount) !== Number(p.amount) ||
          existing.criticality !== p.criticality ||
          existing.due_date !== dueDate ||
          !existing.active_in_month
        ) {
          await db
            .from('monthly_expense_items')
            .update({
              budget_amount: p.amount,
              criticality: p.criticality,
              due_date: dueDate,
              active_in_month: true,
            })
            .eq('id', existing.id)
        }
      } else if (!p && existing) {
        // Eliminar o desactivar el ítem sobrante
        if (Number(existing.executed_amount_cached) === 0) {
          await db
            .from('monthly_expense_items')
            .delete()
            .eq('id', existing.id)
        } else if (existing.active_in_month) {
          await db
            .from('monthly_expense_items')
            .update({ active_in_month: false })
            .eq('id', existing.id)
        }
      }
    }
  }
}

/**
 * Sincroniza los ingresos periódicos de una familia con el mes presupuestal activo actual.
 */
export async function syncPeriodicIncomes(familyId: string) {
  if (!familyId) return

  // 1. Obtener el mes activo actual
  const { data: activeMonth, error: monthErr } = await db
    .from('budget_months')
    .select('*')
    .eq('family_id', familyId)
    .eq('status', 'active')
    .maybeSingle()

  if (monthErr || !activeMonth) return

  // 2. Obtener ingresos periódicos activos de la familia
  const { data: periodicItems, error: periodicErr } = await db
    .from('periodic_incomes')
    .select('*')
    .eq('family_id', familyId)
    .eq('active', true)

  if (periodicErr || !periodicItems) return

  // 3. Obtener ingresos mensuales de tipo 'sporadic' para el mes activo
  const { data: existingItems, error: itemsErr } = await db
    .from('monthly_income_items')
    .select('*')
    .eq('month_id', activeMonth.id)
    .eq('income_type', 'sporadic')

  if (itemsErr || !existingItems) return

  const { year, month } = activeMonth

  // 4. Filtrar cuáles de los ingresos periódicos corresponden a este mes activo
  const periodicToInject = (periodicItems as any[]).filter((p: any) => {
    const intervalMonths = p.periodicity === 'quarterly' ? 3 : p.periodicity === 'semi_annual' ? 6 : 12
    const diffMonths = (year - p.start_year) * 12 + (month - p.start_month)
    return diffMonths >= 0 && diffMonths % intervalMonths === 0
  })

  // 5. Agrupar por concept_id o etiqueta para hacer un emparejamiento posicional
  const periodicByGroup: Record<string, any[]> = {}
  for (const p of periodicToInject) {
    const key = p.concept_id || `label:${p.label}`
    if (!periodicByGroup[key]) periodicByGroup[key] = []
    periodicByGroup[key].push(p)
  }

  const existingByGroup: Record<string, any[]> = {}
  for (const item of (existingItems as any[])) {
    const key = item.concept_id || `label:${item.label}`
    if (!existingByGroup[key]) existingByGroup[key] = []
    existingByGroup[key].push(item)
  }

  // Obtener todos los grupos únicos involucrados
  const allGroups = new Set([
    ...Object.keys(periodicByGroup),
    ...Object.keys(existingByGroup)
  ])

  // 6. Sincronizar cada grupo
  for (const groupKey of allGroups) {
    const P_g = periodicByGroup[groupKey] || []
    const E_g = existingByGroup[groupKey] || []
    const limit = Math.max(P_g.length, E_g.length)

    for (let i = 0; i < limit; i++) {
      const p = P_g[i]
      const existing = E_g[i]

      if (p && !existing) {
        // Insertar nuevo ingreso para este grupo en el mes
        const dueDate = p.due_day ? getDueDateForAccountingMonth(year, month, p.due_day) : null
        await db.from('monthly_income_items').insert({
          family_id: familyId,
          month_id: activeMonth.id,
          member_id: p.member_id || null,
          concept_id: p.concept_id || null,
          label: p.label,
          gross_amount: p.amount,
          deduction_type: 'none',
          deduction_rate: 0,
          deduction_amount: 0,
          net_expected: p.amount,
          expected_date: dueDate,
          received_amount: 0,
          status: 'pending',
          is_recurring: false,
          income_type: 'sporadic',
        })
      } else if (p && existing) {
        // Actualizar el ingreso existente si difieren los valores clave
        const dueDate = p.due_day ? getDueDateForAccountingMonth(year, month, p.due_day) : null
        if (
          Number(existing.gross_amount) !== Number(p.amount) ||
          existing.expected_date !== dueDate ||
          existing.label !== p.label ||
          existing.member_id !== p.member_id
        ) {
          await db
            .from('monthly_income_items')
            .update({
              gross_amount: p.amount,
              net_expected: p.amount,
              expected_date: dueDate,
              label: p.label,
              member_id: p.member_id || null,
            })
            .eq('id', existing.id)
        }
      } else if (!p && existing) {
        // Eliminar el ingreso sobrante si no ha recibido pagos
        if (Number(existing.received_amount) === 0) {
          await db
            .from('monthly_income_items')
            .delete()
            .eq('id', existing.id)
        }
      }
    }
  }
}
