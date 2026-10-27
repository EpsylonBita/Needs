import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { assertOrderUser } from '@/lib/orders/server'
import { ErrorFactory } from '@/lib/utils/error-handler'
import { rateLimitEnhanced } from '@/lib/utils/rate-limit-enhanced'
import { LifecycleConflict } from './lifecycle'

export async function lifecycleUser(request: NextRequest) {
  const header = request.headers.get('authorization') || ''
  if (!header.startsWith('Bearer ')) throw ErrorFactory.authentication('Sign in to manage a payment')
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(header.slice(7))
  if (error || !user) throw ErrorFactory.authentication('Invalid authentication')
  return user
}

export async function lifecycleLimit(request: NextRequest, userId: string, expectedUserId: string, action: string) {
  assertOrderUser(expectedUserId, userId, true)
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const result = await rateLimitEnhanced(`order-lifecycle:${action}:${userId}:${ip}`, 120, 3_600_000, {
    burstLimit: 12, burstWindowMs: 60_000, failClosed: true,
  })
  if (!result.allowed) throw ErrorFactory.rateLimit('Too many payment requests. Try again shortly.')
}

export function lifecycleResponse(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export function lifecycleError(error: unknown): NextResponse {
  if (error instanceof LifecycleConflict) return lifecycleResponse({ error: error.message }, error.status)
  throw error
}
