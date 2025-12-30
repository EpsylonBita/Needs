import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { withApiErrorHandler } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const GET = withApiErrorHandler(async (request: NextRequest) => {
  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  const year = url.searchParams.get('year')
  let q = supabaseAdmin.from('payments').select('id, status, amount, platform_fee, buyer_id, seller_id, stripe_payment_intent, created_at')
  if (status && status !== 'all') q = q.eq('status', status)
  if (year && year !== 'all') q = q.gte('created_at', `${year}-01-01`).lte('created_at', `${year}-12-31`)
  const { data } = await q.order('created_at', { ascending: false })
  const rows = (data || []) as any[]
  const header = ['id','status','amount','platform_fee','buyer_id','seller_id','stripe_payment_intent','created_at']
  const csv = [header.join(','), ...rows.map(r => header.map(h => String(r[h] ?? '').replace(/,/g,';')).join(','))].join('\n')
  return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="payments.csv"' } })
})
