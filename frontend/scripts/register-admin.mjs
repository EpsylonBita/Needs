import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

function loadEnvLocal(path = '.env.local') {
  const txt = fs.readFileSync(path, 'utf-8')
  const obj = {}
  txt.split(/\r?\n/).forEach(line => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) obj[m[1]] = m[2]
  })
  return obj
}

async function run() {
  const env = loadEnvLocal()
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    console.error('Missing Supabase envs')
    process.exit(1)
  }
  const supa = createClient(url, anon)
  const email = 'epsylon2010@gmail.com'
  const password = '98741235'
  const { data, error } = await supa.auth.signUp({ email, password })
  if (error) {
    console.error('SignUp error:', error.message)
    process.exit(1)
  }
  console.log('Created user:', data.user?.id)
}

run().catch(e => { console.error(e); process.exit(1) })