import { z } from 'zod'
import { supabase } from '@/lib/supabase/client'
import { withCsrfHeaders } from '@/lib/utils/csrf'
import type { OrderCaptureResult, OrderCursor, OrderDTO, OrderPage } from '@/lib/orders/types'

export type { OrderCaptureResult, OrderCursor, OrderDTO, OrderPage } from '@/lib/orders/types'
export const ORDER_PAGE_SIZE = 20
export const ORDER_REVIEW_MAX_LENGTH = 4000
const id = z.string().uuid()
const timestamp = z.string().refine(value => Number.isFinite(Date.parse(value)))
const money = z.number().finite().nonnegative()
const party = z.object({ id, display_name: z.string().nullable(), avatar_url: z.string().nullable() })
const cursorSchema = z.object({ created_at: timestamp, id })
const orderSchema = z.object({
  id, created_at: timestamp, status: z.string().min(1), amount: money, currency: z.string().regex(/^[a-zA-Z]{3}$/), platform_fee: money,
  payments_enabled: z.boolean(),
  listing: z.object({ id, title: z.string(), thumbnail: z.string().nullable(), available: z.boolean() }),
  buyer: party, seller: party, my_role: z.enum(['buyer', 'seller']), chat_id: id.nullable(),
  milestone: z.object({ id, title: z.string(), status: z.string(), amount: money }).nullable(),
  buyer_confirmed: z.boolean(), seller_confirmed: z.boolean(), role_review_required: z.boolean(),
  authorization_state: z.enum(['authorized', 'unverified', 'settled']), capture_pending: z.boolean(),
  authorization: z.object({ expires_at: timestamp.nullable(), last_checked_at: timestamp.nullable(), provider_status: z.string().nullable(), attention_required: z.boolean() }),
  cancellation: z.object({ id, status: z.enum(['proposed', 'accepted', 'rejected', 'withdrawn', 'canceled']), requested_by: id, reason: z.string(), requested_at: timestamp }).nullable(),
  cancel_pending: z.boolean(), stripe_canceled_at: timestamp.nullable(),
  complaint: z.object({ id, status: z.string() }).nullable(),
  disputes: z.array(z.object({ id, status: z.string(), is_bank_dispute: z.boolean(), created_at: timestamp, resolved_at: timestamp.nullable() })),
  refund: z.object({ succeeded_amount: money, pending_amount: money, failed: z.boolean() }),
  review: z.object({ id, rating: z.number().int().min(1).max(5) }).nullable(),
  actions: z.object({ can_confirm: z.boolean(), can_capture: z.boolean(), can_complain: z.boolean(), can_review: z.boolean(), can_request_cancel: z.boolean(), can_accept_cancel: z.boolean(), can_reject_cancel: z.boolean(), can_withdraw_cancel: z.boolean(), can_reconcile: z.boolean() }),
})
const enabled = (databaseFlag: boolean) => (process.env.NEXT_PUBLIC_PAYMENTS_ENABLED || '').toLowerCase() === 'true' || databaseFlag
function parseOrder(value: unknown, expectedId?: string): OrderDTO {
  const parsed = orderSchema.safeParse(value)
  if (!parsed.success || (expectedId && parsed.data.id !== expectedId)) throw new Error('Order details could not be verified. Refresh and try again.')
  const order = parsed.data
  const paymentsEnabled = enabled(order.payments_enabled)
  return { ...order, payments_enabled: paymentsEnabled, actions: { ...order.actions, can_confirm: paymentsEnabled && order.actions.can_confirm, can_capture: paymentsEnabled && order.actions.can_capture } }
}
function requestError(value: unknown, fallback = 'The order request failed. Please try again.'): Error {
  if (value instanceof Error) return value
  if (value && typeof value === 'object') {
    const result = value as { message?: string; error?: string | { message?: string; userMessage?: string } }
    return new Error((typeof result.error === 'string' ? result.error : result.error?.userMessage || result.error?.message) || result.message || fallback)
  }
  return new Error(fallback)
}
async function requireUser(expectedUserId: string, signal?: AbortSignal) {
  id.parse(expectedUserId)
  signal?.throwIfAborted()
  const { data, error } = await supabase.auth.getUser()
  signal?.throwIfAborted()
  if (error || data.user?.id !== expectedUserId) throw new Error('Your account changed or your session expired. Sign in and try again.')
}
async function readRpc(name: string, parameters: Record<string, unknown>, expectedUserId: string, signal?: AbortSignal): Promise<unknown> {
  await requireUser(expectedUserId, signal)
  let query = supabase.rpc(name, { ...parameters, p_expected_user_id: expectedUserId })
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query
  await requireUser(expectedUserId, signal)
  if (error) throw requestError(error)
  return data
}
export async function getMyOrders(expectedUserId: string, cursor?: OrderCursor | null, signal?: AbortSignal): Promise<OrderPage> {
  if (cursor) cursorSchema.parse(cursor)
  const value = await readRpc('get_my_orders', { p_before_created_at: cursor?.created_at || null, p_before_id: cursor?.id || null, p_limit: ORDER_PAGE_SIZE }, expectedUserId, signal)
  const result = z.object({ profile_id: id, payments_enabled: z.boolean(), rows: z.array(z.unknown()).max(ORDER_PAGE_SIZE), next_cursor: cursorSchema.nullable() }).safeParse(value)
  if (!result.success) throw new Error('Orders could not be verified. Refresh and try again.')
  const page = result.data
  const rows = page.rows.map(row => parseOrder(row))
  if (new Set(rows.map(row => row.id)).size !== rows.length || rows.some(row => row[row.my_role].id !== page.profile_id)) throw new Error('Orders could not be verified. Refresh and try again.')
  return { ...page, rows, payments_enabled: enabled(page.payments_enabled) }
}
export async function getMyOrder(paymentId: string, expectedUserId: string, signal?: AbortSignal): Promise<OrderDTO> {
  id.parse(paymentId)
  return parseOrder(await readRpc('get_my_order', { p_payment_id: paymentId }, expectedUserId, signal), paymentId)
}
async function post(path: string, body: Record<string, unknown>, expectedUserId: string, signal?: AbortSignal): Promise<unknown> {
  await requireUser(expectedUserId, signal)
  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token
  if (session.error || !token || session.data.session?.user.id !== expectedUserId) throw new Error('Your account changed or your session expired. Sign in and try again.')
  const headers = await withCsrfHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` })
  if (!headers['X-CSRF-Token']) throw new Error('The secure request could not be prepared. Refresh and try again.')
  await requireUser(expectedUserId, signal)
  const response = await fetch(path, { method: 'POST', headers, body: JSON.stringify({ ...body, expectedUserId }), ...(signal ? { signal } : {}) })
  const result = await response.json().catch(() => null)
  await requireUser(expectedUserId, signal)
  if (!response.ok) throw requestError(result)
  return result
}
export async function reconcileOrder(paymentId: string, expectedUserId: string, signal?: AbortSignal): Promise<OrderDTO> {
  id.parse(paymentId)
  return parseOrder(await post('/api/orders/reconcile', { paymentId }, expectedUserId, signal), paymentId)
}
export async function changeOrderCancellation(paymentId: string, input: { action: 'request' | 'accept' | 'reject' | 'withdraw'; expectedCancellationId: string | null; reason?: string }, expectedUserId: string): Promise<OrderDTO> {
  id.parse(paymentId)
  const parsed = z.object({ action: z.enum(['request', 'accept', 'reject', 'withdraw']), expectedCancellationId: id.nullable(), reason: z.string().trim().min(5).max(1000).optional() })
    .refine(value => value.action !== 'request' || !!value.reason).parse(input)
  return parseOrder(await post('/api/orders/cancel', { paymentId, ...parsed }, expectedUserId), paymentId)
}
export async function confirmOrder(paymentId: string, expectedUserId: string): Promise<OrderDTO> {
  id.parse(paymentId)
  const order = parseOrder(await post('/api/orders/confirm', { paymentId }, expectedUserId), paymentId)
  if (!order[order.my_role === 'buyer' ? 'buyer_confirmed' : 'seller_confirmed']) throw new Error('Your confirmation could not be verified. Refresh before trying again.')
  return order
}
export async function captureOrder(paymentId: string, expectedUserId: string): Promise<OrderCaptureResult> {
  id.parse(paymentId)
  const result = z.object({ captured: z.boolean(), pending: z.boolean(), status: z.string().min(1) }).safeParse(await post('/api/payments/capture', { paymentId }, expectedUserId))
  if (!result.success || (!result.data.captured && !result.data.pending)) throw new Error('The payment result could not be verified. Refresh before trying again.')
  return result.data
}
export async function reportOrderProblem(paymentId: string, expectedUserId: string): Promise<{ success: true; disputeId: string }> {
  id.parse(paymentId)
  const result = z.object({ success: z.literal(true), disputeId: id }).safeParse(await post(`/api/payments/disputes/${paymentId}/create`, {}, expectedUserId))
  if (!result.success) throw new Error('Your report could not be verified. Refresh before trying again.')
  return result.data
}
export async function submitOrderReview(paymentId: string, rating: number, comment: string, expectedUserId: string): Promise<{ success: true; reviewId: string }> {
  id.parse(paymentId)
  const input = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(ORDER_REVIEW_MAX_LENGTH) }).parse({ rating, comment })
  const result = z.object({ success: z.literal(true), reviewId: id }).safeParse(await post('/api/reviews/submit', { paymentId, ...input }, expectedUserId))
  if (!result.success) throw new Error('Your review could not be verified. Refresh before trying again.')
  return result.data
}
