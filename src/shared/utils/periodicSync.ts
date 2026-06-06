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
 * Inserta los que corresponden y no existen, actualiza los que cambiaron y elimina/desactiva
 * los que ya no corresponden.
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

  // 5. Inyectar o actualizar en el mes activo
  for (const p of periodicToInject) {
    const existing = (existingItems as any[]).find((item: any) => item.concept_id === p.concept_id)
    const dueDate = p.due_day ? getDueDateForAccountingMonth(year, month, p.due_day) : null

    if (!existing) {
      // Si no existe el ítem, lo creamos
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
    } else {
      // Si ya existe, actualizamos si cambiaron los valores clave o si estaba desactivado
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
    }
  }

  // 6. Eliminar o desactivar los ítems mensuales del mes activo que ya no corresponden
  // (porque el gasto periódico fue desactivado, eliminado o se cambió su mes/periodicidad)
  for (const item of (existingItems as any[])) {
    const stillApplies = periodicToInject.some((p: any) => p.concept_id === item.concept_id)
    if (!stillApplies) {
      if (Number(item.executed_amount_cached) === 0) {
        // No tiene transacciones asociadas, se puede eliminar de forma segura
        await db
          .from('monthly_expense_items')
          .delete()
          .eq('id', item.id)
      } else {
        // Ya tiene transacciones, no lo eliminamos para no dañar los registros históricos,
        // pero lo desactivamos para este mes actual.
        await db
          .from('monthly_expense_items')
          .update({ active_in_month: false })
          .eq('id', item.id)
      }
    }
  }
}
