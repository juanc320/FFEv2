// ============================================================
// Cálculos funcionales del BRD — sección 15
// ============================================================

/** Calcula el ingreso neto a partir del bruto y las deducciones */
export function calcNetIncome(
  gross: number,
  type: 'none' | 'percent' | 'fixed' | 'both',
  rate: number,   // 0.08 = 8%
  fixed: number,
): number {
  switch (type) {
    case 'percent': return gross * (1 - rate)
    case 'fixed':   return gross - fixed
    case 'both':    return gross * (1 - rate) - fixed
    default:        return gross
  }
}

/** Disponible de un sobre/envelope */
export function calcEnvelopeAvailable(
  budget: number,
  arrears: number,
  reallocIn: number,
  reallocOut: number,
  executed: number,
  deferred: number,
): number {
  return budget + arrears + reallocIn - reallocOut - executed - deferred
}

/** Impuesto 4x1000 sobre una salida */
export function calc4x1000(amount: number): number {
  return Math.round(amount * 0.004 * 100) / 100
}

/** Resultado proyectado del mes */
export function calcProjectedResult(
  currentBalance: number,
  pendingIncome: number,
  pendingExpenses: number,
  estimatedTax: number,
): number {
  return currentBalance + pendingIncome - pendingExpenses - estimatedTax
}

/** Estado del mes */
export function isMonthInRed(projected: number): boolean {
  return projected < 0
}

/** Gasto pendiente de un concepto */
export function calcExpensePending(
  budget: number,
  arrears: number,
  executed: number,
  deferred: number,
): number {
  return Math.max(budget + arrears - executed - deferred, 0)
}

/** Formatea moneda COP */
export function formatCOP(amount: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

/** Nombre del mes en español */
export function monthName(month: number): string {
  return new Date(2024, month - 1, 1).toLocaleString('es-CO', { month: 'long' })
}
