import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { withApiErrorHandler, ErrorFactory } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const POST = withApiErrorHandler(async (req: NextRequest) => {
  try {
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) {
      throw ErrorFactory.authentication('Unauthorized')
    }
    const token = authHeader.slice(7)
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      throw ErrorFactory.authentication('Unauthorized')
    }

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

    const { error: disputeError } = await supabaseAdmin
      .from('disputes')
      .insert({ payment_id: payment.id, status: 'open' })
    if (disputeError) {
      throw ErrorFactory.database('Failed to open dispute')
    }

    const { error: updateError } = await supabaseAdmin
      .from('payments')
      .update({ status: 'failed' })
      .eq('id', payment.id)
    if (updateError) {
      throw ErrorFactory.database('Failed to update payment')
    }

    const notifications: any[] = []
    if (payment.seller_id) {
      notifications.push({ user_id: payment.seller_id, type: 'dispute_opened', payload: { payment_id: payment.id } })
    }
    if (payment.buyer_id) {
      notifications.push({ user_id: payment.buyer_id, type: 'dispute_opened', payload: { payment_id: payment.id } })
    }
    if (notifications.length) {
      await supabaseAdmin.from('notifications').insert(notifications)
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    throw error
  }
})
