import { log } from '@/lib/utils/logger'

/** A shared bounded probe keeps both health endpoints consistent without HTTP recursion. */
export async function databaseHealth() {
  let connected = false
  try {
    const { getSupabaseAdmin } = await import('@/lib/supabase/server')
    const result = await getSupabaseAdmin().from('profiles').select('id').limit(1)
      .abortSignal(AbortSignal.timeout(3000))
    if (result.error) throw new Error(result.error.message)
    connected = true
  } catch {
    // Public monitoring responses must not expose database details or credentials.
    log('warn', 'health_database_unavailable', {})
  }
  return {
    status: connected ? 'ok' : 'error',
    database: { status: connected ? 'connected' : 'error', message: connected ? 'supabase reachable' : 'database unavailable' },
    timestamp: new Date().toISOString(),
  }
}
