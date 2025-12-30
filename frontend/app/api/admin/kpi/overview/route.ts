import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, UserRole } from '@/lib/auth/role-based-admin'
import { supabaseAdmin } from '@/lib/supabase/server'
import { rateLimitEnhanced, RateLimitConfigs } from '@/lib/utils/rate-limit-enhanced'
import { withApiErrorHandler, ErrorFactory } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const GET = withApiErrorHandler(async (req: NextRequest) => {
  const auth = await requireAdmin(req, UserRole.ADMIN)
  if (!auth.allowed) throw ErrorFactory.authorization('forbidden')
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  const rl = await rateLimitEnhanced(
    RateLimitConfigs.ADMIN.key(`kpi:${auth.user?.id || 'unknown'}:${ip}`),
    RateLimitConfigs.ADMIN.limit,
    RateLimitConfigs.ADMIN.windowMs,
    { message: RateLimitConfigs.ADMIN.message }
  )
  if (!rl.allowed) throw ErrorFactory.rateLimit('rate_limited')
  const now = Date.now()
  const d24 = new Date(now - 24 * 60 * 60 * 1000).toISOString()
  const d30 = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()
  const d7 = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()

  const p24 = supabaseAdmin.from('payments').select('id', { count: 'exact' }).gte('created_at', d24)
  const p30c = supabaseAdmin.from('payments').select('id', { count: 'exact' }).eq('status', 'completed').gte('created_at', d30)
  const p30f = supabaseAdmin.from('payments').select('id', { count: 'exact' }).eq('status', 'failed').gte('created_at', d30)
  const dOpen = supabaseAdmin.from('disputes').select('id', { count: 'exact' }).eq('status', 'open')
  const dResolved = supabaseAdmin.from('disputes').select('id', { count: 'exact' }).eq('status', 'resolved')
  const u7 = supabaseAdmin.from('profiles').select('id', { count: 'exact' }).gte('created_at', d7)

  const results = await Promise.all([p24, p30c, p30f, dOpen, dResolved, u7])
  const [r1, r2, r3, r4, r5, r6] = results

  return NextResponse.json({
    payments: { last24h: r1.count || 0, completed30d: r2.count || 0, failed30d: r3.count || 0 },
    disputes: { open: r4.count || 0, resolved: r5.count || 0 },
    users: { new7d: r6.count || 0 },
    timestamp: new Date().toISOString()
  })
})
