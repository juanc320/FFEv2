import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://gqxoqywoqbhluknijada.supabase.co'
const supabaseAnonKey = 'sb_publishable_O5Z5JGjdwdQyroIthKL9LQ_zVXRH8jr'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function test() {
  const { data, error } = await supabase.from('periodic_incomes').select('*')
  console.log('--- Periodic Incomes ---')
  console.log('Data:', data)
  console.log('Error:', error)
}

test()
