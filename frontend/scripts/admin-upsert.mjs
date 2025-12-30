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
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('Missing Supabase admin envs')
    process.exit(1)
  }
  const admin = createClient(url, serviceKey)
  const email = 'epsylon2010@gmail.com'
  const password = '98741235'

  // Try to find existing user by listing users (limited capability)
  let targetId = null
  try {
    const list = await admin.auth.admin.listUsers()
    targetId = (list?.data?.users || []).find(u => (u.email || '').toLowerCase() === email.toLowerCase())?.id || null
  } catch {}

  if (!targetId) {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error) {
      console.error('Create user error:', created.error.message)
      process.exit(1)
    }
    targetId = created.data.user?.id || null
    console.log('Created admin user:', targetId)
  } else {
    const upd = await admin.auth.admin.updateUserById(targetId, { password, email_confirm: true })
    if (upd.error) {
      console.error('Update user error:', upd.error.message)
      process.exit(1)
    }
    console.log('Updated admin user password:', targetId)
  }

  if (targetId) {
    await admin.from('profiles').upsert({ user_id: targetId, display_name: 'Admin' }, { onConflict: 'user_id' })
  }
}

run().catch(e => { console.error(e); process.exit(1) })