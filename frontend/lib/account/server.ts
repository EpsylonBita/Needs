import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/server'
import { rateLimitEnhanced } from '@/lib/utils/rate-limit-enhanced'

export const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff' }
export class AccountApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}
export function accountRoute(handler: (request: NextRequest) => Promise<NextResponse>) {
  return async (request: NextRequest) => {
    try { return await handler(request) }
    catch (failure) {
      const error = failure instanceof AccountApiError ? failure : new AccountApiError(503, 'ACCOUNT_UNAVAILABLE', 'Account privacy tools are unavailable. Please try again.')
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: PRIVATE_HEADERS })
    }
  }
}

/** Called only AFTER getUser has validated the token with the auth service.
 * Refreshed iat/exp and mutable user metadata are never reauthentication proof. */
export function recentlyAuthenticated(token: string, userId: string, now = Date.now()): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    if (payload.sub !== userId || !Array.isArray(payload.amr)) return false
    const methods = new Set(['password', 'otp', 'totp', 'mfa/totp', 'mfa/phone', 'mfa/webauthn', 'magiclink', 'sso/saml', 'oauth', 'oauth_provider/authorization_code'])
    return payload.amr.some((entry: { method?: unknown; timestamp?: unknown }) => entry && typeof entry.method === 'string' && methods.has(entry.method)
      && typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp) && now / 1000 - entry.timestamp <= 600 && entry.timestamp <= now / 1000 + 30)
  } catch { return false }
}
export async function accountUser(request: NextRequest, expectedUserId: unknown, recent = false) {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token || token.length > 16384) throw new AccountApiError(401, 'SIGN_IN_REQUIRED', 'Sign in to manage your account data.')
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data.user) throw new AccountApiError(401, 'SIGN_IN_REQUIRED', 'Your session expired. Sign in again.')
  if (!z.string().uuid().safeParse(expectedUserId).success || data.user.id !== expectedUserId) throw new AccountApiError(403, 'ACCOUNT_CHANGED', 'Your account changed. Refresh and try again.')
  if (recent && !recentlyAuthenticated(token, data.user.id)) throw new AccountApiError(403, 'REAUTH_REQUIRED', 'Confirm your identity with a fresh sign-in before continuing.')
  return data.user
}
export async function accountRate(userId: string, action: string, limit = 5) {
  const result = await rateLimitEnhanced(`account:${action}:${userId}`, limit, 60 * 60 * 1000, { failClosed: true })
  if (!result.allowed) throw new AccountApiError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.')
}
export async function accountRpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.rpc(name, args)
  if (error?.code === '54000') throw new AccountApiError(413, 'ASSISTED_EXPORT_REQUIRED', 'This export is too large for a direct download. Contact support for assisted delivery.')
  if (error?.code === '42501') throw new AccountApiError(409, 'REQUEST_CHANGED', 'The account request changed. Refresh and try again.')
  if (error || data === null) throw new AccountApiError(503, 'ACCOUNT_UNAVAILABLE', 'The account request could not be completed. Please try again.')
  return data
}
export async function accountBody(request: NextRequest): Promise<unknown> {
  const body = await request.text()
  if (body.length > 6000) throw new AccountApiError(413, 'BODY_TOO_LARGE', 'The request is too long.')
  try { return JSON.parse(body) } catch { throw new AccountApiError(400, 'INVALID_REQUEST', 'Check the request details.') }
}
