import { NextRequest } from 'next/server'
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
  let q = supabaseAdmin.from('payments').select('id, status, amount, platform_fee, currency, buyer_id, seller_id, stripe_payment_intent, created_at, role_review_required')
  if (roleReview === 'required') q = q.eq('role_review_required', true)
  if (status && status !== 'all') q = q.eq('status', status)
  if (year && year !== 'all') q = q.gte('created_at', `${year}-01-01`).lte('created_at', `${year}-12-31`)
  const { data, error } = await q.order('created_at', { ascending: false })
  if (error) throw ErrorFactory.database('Payment export could not be loaded')
  const rows = (data || []) as any[]
  const header = ['id','status','amount','platform_fee','currency','buyer_id','seller_id','stripe_payment_intent','created_at','role_review_required']
  const csv = [header.join(','), ...rows.map(r => header.map(h => String(r[h] ?? '').replace(/,/g,';')).join(','))].join('\n')
  return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="payments.csv"', 'Cache-Control': 'private, no-store' } })
})
