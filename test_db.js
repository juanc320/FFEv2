import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://gqxoqywoqbhluknijada.supabase.co'
const supabaseAnonKey = 'sb_publishable_O5Z5JGjdwdQyroIthKL9LQ_zVXRH8jr'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function test() {
  const { data, error } = await supabase
    .from('budget_months')
    .select('*')
    .eq('status', 'active')
  console.log('--- budget_months active ---')
  console.log('Data:', data)
  console.log('Error:', error)
}

test()
