import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withApiErrorHandler, createValidationError } from '@/lib/utils/error-handler'
import { getProviderPayment, lifecycleRpc, orderForUser, releaseClaimedPayment } from '@/lib/payments/lifecycle'
import { lifecycleError, lifecycleLimit, lifecycleResponse, lifecycleUser } from '@/lib/payments/lifecycle-route'

export const dynamic = 'force-dynamic'
const input = z.object({
  paymentId: z.string().uuid(), expectedUserId: z.string().uuid(),
  action: z.enum(['request', 'accept', 'reject', 'withdraw']), expectedCancellationId: z.string().uuid().nullable(),
  reason: z.string().trim().min(5).max(1000).optional(),
}).strict().refine(value => value.action === 'request' ? !!value.reason : !!value.expectedCancellationId)

export const POST = withApiErrorHandler(async (request: NextRequest) => {
  const user = await lifecycleUser(request)
  const body = input.safeParse(await request.json().catch(() => null))
  if (!body.success) throw createValidationError('cancellation', 'Choose a valid cancellation and provide a reason')
  await lifecycleLimit(request, user.id, body.data.expectedUserId, 'cancel')
  const value = body.data
  try {
    // SQL binds this exact request to its participants and serializes against capture.
    await lifecycleRpc(value.action === 'request' ? 'request_order_cancellation' : 'respond_order_cancellation', {
      p_payment_id: value.paymentId, p_user_id: user.id,
      ...(value.action === 'request'
        ? { p_expected_cancellation_id: value.expectedCancellationId, p_reason: value.reason }
        : { p_cancellation_id: value.expectedCancellationId, p_action: value.action }),
    })
    let pending = false
    if (value.action === 'accept') {
      const claim = await lifecycleRpc('claim_order_cancellation', {
        p_payment_id: value.paymentId, p_user_id: user.id, p_cancellation_id: value.expectedCancellationId,
      })
      pending = (await releaseClaimedPayment(await getProviderPayment(value.paymentId), claim)).pending
    }
    return lifecycleResponse(await orderForUser(value.paymentId, user.id), pending ? 202 : 200)
  } catch (error) { return lifecycleError(error) }
})
