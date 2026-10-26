import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { withApiErrorHandler, ErrorFactory } from '@/lib/utils/error-handler'
import { assertOrderUser } from '@/lib/orders/server'

export const dynamic = 'force-dynamic'

export const POST = withApiErrorHandler(async (req: NextRequest) => {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) {
    throw ErrorFactory.authentication('Unauthorized')
  }
  const token = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    throw ErrorFactory.authentication('Unauthorized')
  }
  const body = await req.json().catch(() => ({}))
  assertOrderUser(body?.expectedUserId, user.id)

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (profileError || !profile) {
    throw ErrorFactory.businessLogic('Profile not found')
  }

  const segments = req.nextUrl.pathname.split('/')
  const paymentId = segments[segments.length - 2]
  const { data: payment, error: paymentError } = await supabaseAdmin
    .from('payments')
    .select('id, buyer_id, seller_id, status')
    .eq('id', paymentId)
    .single()
  if (paymentError || !payment) {
    throw ErrorFactory.businessLogic('Payment not found')
  }

  if (payment.buyer_id !== profile.id) {
    throw ErrorFactory.authorization('Forbidden')
  }

  if (!['requires_capture', 'completed'].includes(payment.status)) {
    return NextResponse.json({ error: 'This payment cannot accept a new complaint.' }, { status: 409 })
  }
  // A marketplace complaint is distinct from a Stripe chargeback. Opening it
  // must never mark a successfully paid order as a failed charge.
  const { data: result, error } = await supabaseAdmin.rpc('open_payment_complaint', {
    p_payment_id: payment.id, p_buyer_id: profile.id,
  })
  if (error?.code === '42501') throw ErrorFactory.authorization('This payment cannot accept a report from your account')
  if (error && ['P0001', '23514', '22023'].includes(error.code)) return NextResponse.json({ error: error.message }, { status: 409 })
  if (error || typeof result?.dispute_id !== 'string' || !result.dispute_id) throw ErrorFactory.database('Failed to open dispute')
  return NextResponse.json({ success: true, disputeId: result.dispute_id })
})
