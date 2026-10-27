import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { supabaseAdmin } from '@/lib/supabase/server'
import { withApiErrorHandler, ErrorFactory } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const GET = withApiErrorHandler(async (request: NextRequest) => {
  const auth = await requireAdmin(request)
  if (!auth.allowed) throw ErrorFactory.authorization(auth.reason || 'forbidden')
  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  const year = url.searchParams.get('year')
  const roleReview = url.searchParams.get('roleReview')
  if (roleReview && roleReview !== 'required') throw ErrorFactory.validation('Invalid payment review filter')
  const limit = Number(url.searchParams.get('limit') || '20')
  const offset = Number(url.searchParams.get('offset') || '0')
  let q = supabaseAdmin.from('payments').select('id, status, amount, platform_fee, currency, buyer_id, seller_id, stripe_payment_intent, created_at, role_review_required, authorization_expires_at, provider_checked_at, provider_status, attention_required, cancel_claim_id, stripe_canceled_at', { count: 'exact' })
  if (roleReview === 'required') q = q.eq('role_review_required', true)
  if (status && status !== 'all') q = q.eq('status', status)
  if (year && year !== 'all') q = q.gte('created_at', `${year}-01-01`).lte('created_at', `${year}-12-31`)
  const { data, count, error } = await q.order('created_at', { ascending: false }).range(offset, offset + limit - 1)
  if (error) throw ErrorFactory.database(error.message)
  return NextResponse.json({ rows: data || [], total: count || 0 }, { headers: { 'Cache-Control': 'private, no-store' } })
})
