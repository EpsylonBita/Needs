import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { withApiErrorHandler, ErrorFactory } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const GET = withApiErrorHandler(async (request: NextRequest) => {
  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  const limit = Number(url.searchParams.get('limit') || '20')
  const offset = Number(url.searchParams.get('offset') || '0')
  let q = supabaseAdmin.from('disputes').select('id, status, reason, payment_id, created_at', { count: 'exact' })
  if (status && status !== 'all') q = q.eq('status', status)
  const { data, count, error } = await q.order('created_at', { ascending: false }).range(offset, offset + limit - 1)
  if (error) throw ErrorFactory.database(error.message)
  return NextResponse.json({ rows: data || [], total: count || 0 })
})
