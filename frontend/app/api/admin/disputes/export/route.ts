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
  if (status && !['all', 'open', 'resolved', 'refunded', 'rejected', 'won', 'lost'].includes(status)) throw ErrorFactory.validation('Invalid dispute status')
  let q = supabaseAdmin.from('disputes').select('id, status, reason, payment_id, created_at, stripe_dispute_id, amount, currency, resolved_at')
  if (status && status !== 'all') q = q.eq('status', status)
  const { data, error } = await q.order('created_at', { ascending: false })
  if (error) throw ErrorFactory.database('Dispute export could not be loaded')
  const header = ['id', 'status', 'reason', 'payment_id', 'created_at', 'stripe_dispute_id', 'amount', 'currency', 'resolved_at'] as const
  const cell = (value: unknown) => {
    const text = String(value ?? '')
    const safe = /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text
    return `"${safe.replace(/"/g, '""')}"`
  }
  const csv = [header.join(','), ...(data || []).map(row => header.map(key => cell(row[key])).join(','))].join('\r\n')
  return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="disputes.csv"', 'Cache-Control': 'private, no-store' } })
})
