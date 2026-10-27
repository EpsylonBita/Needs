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
  const limit = Number(url.searchParams.get('limit') || '20')
  const offset = Number(url.searchParams.get('offset') || '0')
  if (status && !['all', 'open', 'resolved', 'refunded', 'rejected', 'won', 'lost'].includes(status)) throw ErrorFactory.validation('Invalid dispute status')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw ErrorFactory.validation('Invalid pagination')
  let q = supabaseAdmin.from('disputes').select('id, status, reason, payment_id, created_at, resolved_at, stripe_dispute_id, amount, currency', { count: 'exact' })
  if (status && status !== 'all') q = q.eq('status', status)
  const { data, count, error } = await q.order('created_at', { ascending: false }).range(offset, offset + limit - 1)
  if (error) throw ErrorFactory.database(error.message)
  return NextResponse.json({ rows: data || [], total: count || 0 }, { headers: { 'Cache-Control': 'private, no-store' } })
})
