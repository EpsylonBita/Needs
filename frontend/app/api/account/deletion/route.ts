import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AccountApiError, accountBody, accountRate, accountRoute, accountRpc, accountUser, PRIVATE_HEADERS } from '@/lib/account/server'
export const dynamic = 'force-dynamic'
const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request'), expectedUserId: z.string().uuid(), confirmation: z.literal('DELETE') }).strict(),
  z.object({ action: z.literal('cancel'), expectedUserId: z.string().uuid(), requestId: z.string().uuid() }).strict(),
])
export const GET = accountRoute(async request => {
  const user = await accountUser(request, request.nextUrl.searchParams.get('expectedUserId'))
  const result = await accountRpc('get_account_deletion_status', { p_user_id: user.id })
  return NextResponse.json(result, { headers: PRIVATE_HEADERS })
})
export const POST = accountRoute(async request => {
  const body = input.safeParse(await accountBody(request))
  if (!body.success) throw new AccountApiError(400, 'INVALID_REQUEST', 'Confirm the deletion request or choose an existing request to cancel.')
  const user = await accountUser(request, body.data.expectedUserId, true)
  await accountRate(user.id, 'deletion', 10)
  const result = body.data.action === 'request'
    ? await accountRpc('request_account_deletion', { p_user_id: user.id })
    : await accountRpc('cancel_account_deletion', { p_user_id: user.id, p_request_id: body.data.requestId })
  return NextResponse.json(result, { headers: PRIVATE_HEADERS })
})
