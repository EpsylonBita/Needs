import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { supabaseAdmin } from '@/lib/supabase/server'
import { log } from '@/lib/utils/logger'
import { rateLimitEnhanced, RateLimitConfigs } from '@/lib/utils/rate-limit-enhanced'
import { withApiErrorHandler, ErrorFactory } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const POST = withApiErrorHandler(async (req: NextRequest) => {
  const auth = await requireAdmin(req)
  if (!auth.allowed) throw ErrorFactory.authorization(auth.reason || 'forbidden')
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  const rl = await rateLimitEnhanced(RateLimitConfigs.ADMIN.key(`resolve:${ip}`), RateLimitConfigs.ADMIN.limit, RateLimitConfigs.ADMIN.windowMs, { message: RateLimitConfigs.ADMIN.message })
  if (!rl.allowed) throw ErrorFactory.rateLimit('rate_limited')
  const segments = req.nextUrl.pathname.split('/')
  const id = segments[segments.length - 2]
  log('info', 'ADMIN resolve', { id, email: auth.user?.email })
  const { data: dispute } = await supabaseAdmin.from('disputes').select('payment_id').eq('id', id).single()
  if (!dispute?.payment_id) throw ErrorFactory.businessLogic('Not found')
  await supabaseAdmin.from('disputes').update({ status: 'resolved' }).eq('id', id)
  await supabaseAdmin.from('payment_audit_logs').insert({ payment_id: dispute.payment_id, action: 'admin_resolve', actor_type: 'admin', metadata: { dispute_id: id, admin_email: auth.user?.email } })
  return NextResponse.json({ success: true })
})
