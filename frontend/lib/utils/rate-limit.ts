import { getSupabaseAdmin } from '@/lib/supabase/server'

export async function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now()
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs).toISOString()
  const supa = getSupabaseAdmin()
  const { data } = await supa
    .from('rate_limits')
    .select('count')
    .eq('key', key)
    .eq('window_start', windowStart)
    .limit(1)
  const current = data?.[0]?.count || 0
  if (current >= limit) return { allowed: false }
  if (current === 0) {
    await supa.from('rate_limits').insert({ key, window_start: windowStart, count: 1 })
  } else {
    await supa.from('rate_limits').update({ count: current + 1 }).eq('key', key).eq('window_start', windowStart)
  }
  return { allowed: true }
}