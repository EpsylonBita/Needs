import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/server'
import { assertOrderUser, requireOrderPaymentsEnabled } from '@/lib/orders/server'
import { withApiErrorHandler, ErrorFactory, createValidationError } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'
export const POST = withApiErrorHandler(async (request: NextRequest) => {
  const auth = request.headers.get('authorization') || ''
  if (!auth.startsWith('Bearer ')) throw ErrorFactory.authentication('Authentication required')
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(auth.slice(7))
  if (authError || !user) throw ErrorFactory.authentication('Invalid authentication')
  const body = z.object({ paymentId: z.string().uuid(), expectedUserId: z.string().uuid() }).safeParse(await request.json().catch(() => null))
  if (!body.success) throw createValidationError('order', 'Choose a valid order and account')
  assertOrderUser(body.data.expectedUserId, user.id, true)
  await requireOrderPaymentsEnabled()
  const { data, error } = await supabaseAdmin.rpc('confirm_order', { p_payment_id: body.data.paymentId, p_user_id: user.id })
  if (error?.code === '42501') throw ErrorFactory.authorization('This order does not belong to your account')
  if (error && ['P0001', '23514', '22023'].includes(error.code)) return NextResponse.json({ error: error.message }, { status: 409 })
  if (error || !data || data.id !== body.data.paymentId || !['buyer', 'seller'].includes(data.my_role)
    || data[data.my_role === 'buyer' ? 'buyer_confirmed' : 'seller_confirmed'] !== true) {
    throw ErrorFactory.database('Order confirmation could not be verified', { userMessage: 'Your confirmation could not be verified. Refresh before trying again.' })
  }
  return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
})
