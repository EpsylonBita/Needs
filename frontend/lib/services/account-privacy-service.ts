import { z } from 'zod'
import { supabase } from '@/lib/supabase/client'
import { withCsrfHeaders } from '@/lib/utils/csrf'
import type { AccountPrivacyStatus } from '@/lib/account/types'

export class AccountPrivacyError extends Error {
  constructor(public code: string, message: string) { super(message) }
}
const statusSchema = z.object({
  request: z.object({ id: z.string().uuid(), status: z.enum(['pending', 'reviewing', 'needs_information', 'cancelled']), created_at: z.string(), updated_at: z.string(), reviewed_at: z.string().nullable(), response: z.string().nullable() }).nullable(),
  blockers: z.object({ active_orders: z.number().int().nonnegative(), open_disputes: z.number().int().nonnegative(), pending_refunds: z.number().int().nonnegative(), active_milestones: z.number().int().nonnegative(), financial_history: z.boolean() }),
})
async function requireAccount(expectedUserId: string) {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user || data.user.id !== expectedUserId) throw new AccountPrivacyError('ACCOUNT_CHANGED', 'Your account changed or your session expired. Sign in again.')
  return data.user
}
async function request(path: string, expectedUserId: string, body?: unknown, signal?: AbortSignal) {
  signal?.throwIfAborted()
  await requireAccount(expectedUserId)
  const session = await supabase.auth.getSession()
  if (session.error || session.data.session?.user.id !== expectedUserId || !session.data.session.access_token) throw new AccountPrivacyError('ACCOUNT_CHANGED', 'Sign in again to continue.')
  let headers: Record<string, string> = { Authorization: `Bearer ${session.data.session.access_token}` }
  if (body !== undefined) {
    headers = await withCsrfHeaders({ ...headers, 'Content-Type': 'application/json' })
    if (!headers['X-CSRF-Token']) throw new AccountPrivacyError('SECURE_REQUEST_FAILED', 'The secure request could not be prepared.')
  }
  await requireAccount(expectedUserId)
  signal?.throwIfAborted()
  const response = await fetch(`${path}?expectedUserId=${encodeURIComponent(expectedUserId)}`, {
    method: body === undefined ? 'GET' : 'POST', headers, cache: 'no-store', signal,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const result = await response.json().catch(() => null)
  await requireAccount(expectedUserId)
  signal?.throwIfAborted()
  if (!response.ok) throw new AccountPrivacyError(typeof result?.code === 'string' ? result.code : 'ACCOUNT_UNAVAILABLE', typeof result?.error === 'string' ? result.error : 'The account request failed.')
  return result
}
function parseStatus(value: unknown): AccountPrivacyStatus {
  const parsed = statusSchema.safeParse(value)
  if (!parsed.success) throw new AccountPrivacyError('ACCOUNT_UNAVAILABLE', 'The account status could not be verified.')
  return parsed.data
}
export async function getAccountPrivacyStatus(userId: string, signal?: AbortSignal) {
  return parseStatus(await request('/api/account/deletion', userId, undefined, signal))
}
export async function requestAccountDeletion(userId: string) {
  return parseStatus(await request('/api/account/deletion', userId, { expectedUserId: userId, action: 'request', confirmation: 'DELETE' }))
}
export async function cancelAccountDeletion(userId: string, requestId: string) {
  return parseStatus(await request('/api/account/deletion', userId, { expectedUserId: userId, action: 'cancel', requestId }))
}
export async function exportAccountData(userId: string) {
  const data = await request('/api/account/export', userId)
  if (data?.format_version !== 1 || data.account?.id !== userId || !data.records || typeof data.scope !== 'string') throw new AccountPrivacyError('ACCOUNT_UNAVAILABLE', 'The account export could not be verified.')
  return data
}
export async function confirmAccountPassword(userId: string, password: string) {
  const user = await requireAccount(userId)
  if (!user.email || !password) throw new AccountPrivacyError('REAUTH_FAILED', 'Enter your current password or sign in again using your usual method.')
  const result = await supabase.auth.signInWithPassword({ email: user.email, password })
  if (result.error || result.data.user?.id !== userId) throw new AccountPrivacyError('REAUTH_FAILED', 'Your identity could not be confirmed. Check your password or sign in again.')
  await requireAccount(userId)
}
