import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { withApiErrorHandler } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const GET = withApiErrorHandler(async (request: NextRequest) => {
  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  let q = supabaseAdmin.from('disputes').select('id, status, reason, payment_id, created_at')
  if (status && status !== 'all') q = q.eq('status', status)
  const { data } = await q.order('created_at', { ascending: false })
  const rows = (data || []) as any[]
  const header = ['id','status','reason','payment_id','created_at']
  const csv = [header.join(','), ...rows.map(r => header.map(h => String(r[h] ?? '').replace(/,/g,';')).join(','))].join('\n')
  return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="disputes.csv"' } })
})
