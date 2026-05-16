import { supabase } from '@/lib/supabase'

/**
 * Cliente Supabase sin tipos estrictos para mutaciones (insert/update/delete).
 * Evita errores de inferencia 'never' con supabase-js v2.
 * Los queries (select) siguen usando el cliente tipado.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as any
