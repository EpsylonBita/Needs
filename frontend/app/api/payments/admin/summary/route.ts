import { NextRequest, NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/auth/admin'
import { supabaseAdmin } from '@/lib/supabase/server'
import { withApiErrorHandler, ErrorFactory, createValidationError } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const GET = withApiErrorHandler(async (request: NextRequest) => {
  const auth = await requireAdmin(request)
  if (!auth.allowed) throw ErrorFactory.authorization(auth.reason || 'forbidden')
  const year = request.nextUrl.searchParams.get('year') || 'all'
  if (year !== 'all' && !/^(19|20|21)\d{2}$/.test(year)) throw createValidationError('year', 'Invalid year')
  const totals = new Map<string, { currency: string; volume: number; fee: number }>()
  const monthly = new Map<string, { month: string; currency: string; volume: number; fee: number }>()
  // The original view mixes currencies. Aggregate on the server without losing
  // records beyond the REST row cap or exposing payment data to browser roles.
  for (let offset = 0; ; offset += 1000) {
    let query = supabaseAdmin.from('payments').select('id,amount,platform_fee,currency,created_at').order('id')
    if (year !== 'all') query = query.gte('created_at', `${year}-01-01`).lt('created_at', `${Number(year) + 1}-01-01`)
    const { data, error } = await query.range(offset, offset + 999)
    if (error) throw ErrorFactory.database('Payment summary could not be loaded')
    for (const payment of data || []) {
      const currency = String(payment.currency || 'usd').toUpperCase()
      const volume = Number(payment.amount || 0)
      const fee = Number(payment.platform_fee || 0)
      const total = totals.get(currency) || { currency, volume: 0, fee: 0 }
      total.volume += volume; total.fee += fee; totals.set(currency, total)
      const month = String(payment.created_at).slice(0, 7)
      const key = `${month}:${currency}`
      const point = monthly.get(key) || { month, currency, volume: 0, fee: 0 }
      point.volume += volume; point.fee += fee; monthly.set(key, point)
    }
    if (!data || data.length < 1000) break
  }
  const { data: disputes, error } = await supabaseAdmin.from('disputes')
    .select('id,status,reason,payment_id').order('created_at', { ascending: false }).limit(1000)
  if (error) throw ErrorFactory.database('Disputes could not be loaded')
  // These are global administrator counts. Browser RLS intentionally hides
  // other participants' disputes/transactions, even for an administrator.
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
  const counts = await Promise.all([
    supabaseAdmin.from('listings').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', since),
    supabaseAdmin.from('disputes').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    supabaseAdmin.from('transactions').select('id', { count: 'exact', head: true }).eq('type', 'transfer').eq('status', 'created'),
  ])
  if (counts.some(result => result.error || !Number.isSafeInteger(result.count) || (result.count ?? -1) < 0)) {
    throw ErrorFactory.database('Overview counts could not be loaded')
  }
  return NextResponse.json({
    totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    monthly: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency)),
    disputes: disputes || [],
    overview: { activeListings: counts[0].count, newUsers: counts[1].count, openDisputes: counts[2].count, recordedTransfers: counts[3].count },
  }, { headers: { 'Cache-Control': 'private, no-store' } })
})
