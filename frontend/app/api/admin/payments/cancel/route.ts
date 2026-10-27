import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/admin'
import { withApiErrorHandler, ErrorFactory, createValidationError } from '@/lib/utils/error-handler'
import { getProviderPayment, lifecycleRpc, releaseClaimedPayment } from '@/lib/payments/lifecycle'
import { lifecycleError, lifecycleLimit, lifecycleResponse } from '@/lib/payments/lifecycle-route'

export const dynamic = 'force-dynamic'
export const POST = withApiErrorHandler(async (request: NextRequest) => {
  const auth = await requireAdmin(request)
  if (!auth.allowed || !auth.user?.id) throw ErrorFactory.authorization('Administrator access required')
  const input = z.object({ paymentId: z.string().uuid(), expectedUserId: z.string().uuid(), reason: z.string().trim().min(5).max(1000) }).strict()
  const body = input.safeParse(await request.json().catch(() => null))
  if (!body.success) throw createValidationError('cancellation', 'Choose a payment and explain the release')
  await lifecycleLimit(request, auth.user.id, body.data.expectedUserId, 'admin-cancel')
  try {
    const claim = await lifecycleRpc('claim_admin_order_cancellation', {
      p_payment_id: body.data.paymentId, p_admin_user_id: auth.user.id, p_reason: body.data.reason,
    })
    const result = await releaseClaimedPayment(await getProviderPayment(body.data.paymentId), claim)
    return lifecycleResponse(result, result.pending ? 202 : 200)
  } catch (error) { return lifecycleError(error) }
})
