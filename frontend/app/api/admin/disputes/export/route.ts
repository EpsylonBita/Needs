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
  let q = supabaseAdmin.from('disputes').select('id, status, reason, payment_id, created_at')
  if (status && status !== 'all') q = q.eq('status', status)
  const { data, error } = await q.order('created_at', { ascending: false })
  if (error) throw ErrorFactory.database('Dispute export could not be loaded')
  const rows = (data || []) as any[]
  const header = ['id','status','reason','payment_id','created_at']
  const csv = [header.join(','), ...rows.map(r => header.map(h => String(r[h] ?? '').replace(/,/g,';')).join(','))].join('\n')
  return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="disputes.csv"', 'Cache-Control': 'private, no-store' } })
})
