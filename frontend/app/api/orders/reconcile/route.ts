import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withApiErrorHandler, createValidationError } from '@/lib/utils/error-handler'
import { getProviderPayment, orderForUser, reconcilePayment } from '@/lib/payments/lifecycle'
import { lifecycleError, lifecycleLimit, lifecycleResponse, lifecycleUser } from '@/lib/payments/lifecycle-route'

export const dynamic = 'force-dynamic'
export const POST = withApiErrorHandler(async (request: NextRequest) => {
  const user = await lifecycleUser(request)
  const body = z.object({ paymentId: z.string().uuid(), expectedUserId: z.string().uuid() }).strict().safeParse(await request.json().catch(() => null))
  if (!body.success) throw createValidationError('order', 'Choose a valid order and account')
  await lifecycleLimit(request, user.id, body.data.expectedUserId, 'refresh')
  try {
    // Authorize before any provider request. Refresh/release stay available when new payments are disabled.
    await orderForUser(body.data.paymentId, user.id)
    await reconcilePayment(await getProviderPayment(body.data.paymentId))
    return lifecycleResponse(await orderForUser(body.data.paymentId, user.id))
  } catch (error) { return lifecycleError(error) }
})
