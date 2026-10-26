import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { supabaseAdmin } from '@/lib/supabase/server'
import { withApiErrorHandler, ErrorFactory } from '@/lib/utils/error-handler'
import { log } from '@/lib/utils/logger'
import { rateLimitEnhanced, RateLimitConfigs } from '@/lib/utils/rate-limit-enhanced'

export const dynamic = 'force-dynamic'

export const POST = withApiErrorHandler(async (req: NextRequest) => {
  const auth = await requireAdmin(req)
  if (!auth.allowed) throw ErrorFactory.authorization(auth.reason || 'forbidden')
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  const rl = await rateLimitEnhanced(RateLimitConfigs.ADMIN.key(`resolve:${ip}`), RateLimitConfigs.ADMIN.limit, RateLimitConfigs.ADMIN.windowMs, { message: RateLimitConfigs.ADMIN.message, failClosed: true })
  if (!rl.allowed) throw ErrorFactory.rateLimit('rate_limited')
  const segments = req.nextUrl.pathname.split('/')
  const id = segments[segments.length - 2]
  log('info', 'ADMIN resolve', { id, email: auth.user?.email })
  const { data: dispute, error: readError } = await supabaseAdmin.from('disputes').select('payment_id, stripe_dispute_id').eq('id', id).single()
  if (readError || !dispute?.payment_id) throw ErrorFactory.businessLogic('Not found')
  if (dispute.stripe_dispute_id) return NextResponse.json({ error: 'Bank disputes must be managed through Stripe.' }, { status: 409 })
  const { error } = await supabaseAdmin.rpc('resolve_payment_complaint', { p_dispute_id: id, p_admin_email: auth.user?.email || null })
  if (error) throw ErrorFactory.database('Could not resolve the complaint')
  return NextResponse.json({ success: true })
})
