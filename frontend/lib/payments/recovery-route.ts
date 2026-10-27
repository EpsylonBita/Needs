import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/admin'
import { createValidationError, ErrorFactory } from '@/lib/utils/error-handler'
import { lifecycleError, lifecycleLimit, lifecycleResponse } from './lifecycle-route'
import { executePaymentRecovery, previewPaymentRecovery } from './recovery'

const previewInput = z.object({ paymentId: z.string().uuid(), expectedUserId: z.string().uuid() }).strict()
const executeInput = previewInput.extend({ previewVersion: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(5).max(1000) }).strict()

export async function recoveryRoute(request: NextRequest, execute: boolean) {
  const auth = await requireAdmin(request)
  if (!auth.allowed || !auth.user?.id) throw ErrorFactory.authorization('Administrator access required')
  const body = await request.json().catch(() => null)
  const input = execute ? executeInput.safeParse(body) : previewInput.safeParse(body)
  if (!input.success) throw createValidationError('recovery', 'Choose an exact recovery preview and explain the approval')
  await lifecycleLimit(request, auth.user.id, input.data.expectedUserId, execute ? 'admin-recovery' : 'admin-recovery-preview')
  try {
    if (!execute) return lifecycleResponse(await previewPaymentRecovery(input.data.paymentId))
    const validated = executeInput.parse(input.data)
    const result = await executePaymentRecovery(validated.paymentId, auth.user.id, validated.previewVersion, validated.reason)
    return lifecycleResponse(result, result.recovery?.status === 'completed' ? 200 : result.pending ? 202 : 409)
  } catch (error) { return lifecycleError(error) }
}
