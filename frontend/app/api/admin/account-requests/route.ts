import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/admin'
import { AccountApiError, accountBody, accountRoute, accountRpc, PRIVATE_HEADERS } from '@/lib/account/server'
export const dynamic = 'force-dynamic'
const cursor = z.object({ before: z.iso.datetime({ offset: true }).nullable(), id: z.string().uuid().nullable() }).refine(value => !!value.before === !!value.id)
export const GET = accountRoute(async request => {
  if (!(await requireAdmin(request)).allowed) throw new AccountApiError(403, 'FORBIDDEN', 'Administrator access required.')
  const parsed = cursor.safeParse({ before: request.nextUrl.searchParams.get('before'), id: request.nextUrl.searchParams.get('id') })
  if (!parsed.success) throw new AccountApiError(400, 'INVALID_PAGE', 'Invalid page.')
  const result = await accountRpc('list_account_deletion_requests', { p_before_created_at: parsed.data.before, p_before_id: parsed.data.id, p_limit: 20 })
  return NextResponse.json(result, { headers: PRIVATE_HEADERS })
})
const review = z.object({ requestId: z.string().uuid(), status: z.enum(['reviewing', 'needs_information']), response: z.string().trim().min(10).max(4000) }).strict()
export const PATCH = accountRoute(async request => {
  const admin = await requireAdmin(request)
  if (!admin.allowed || !admin.user) throw new AccountApiError(403, 'FORBIDDEN', 'Administrator access required.')
  const parsed = review.safeParse(await accountBody(request))
  if (!parsed.success) throw new AccountApiError(400, 'INVALID_REQUEST', 'Choose a review state and write a response of 10–4,000 characters.')
  const result = await accountRpc('review_account_deletion_request', { p_request_id: parsed.data.requestId, p_admin_id: admin.user.id, p_status: parsed.data.status, p_response: parsed.data.response })
  return NextResponse.json(result, { headers: PRIVATE_HEADERS })
})
