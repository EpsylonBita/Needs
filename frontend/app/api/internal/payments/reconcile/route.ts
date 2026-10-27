import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { reconcilePaymentBatch } from '@/lib/payments/reconciliation-worker'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/** An isolated scheduler secret is required; browser sessions and request bodies cannot select work. */
export async function POST(request: NextRequest) {
  const secret = process.env.PAYMENTS_WORKER_SECRET || ''
  if (secret.length < 32) return NextResponse.json({ error: 'Payment worker is not configured.' }, { status: 503 })
  const header = request.headers.get('authorization') || ''
  const candidate = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!candidate || candidate.length > 1024 || !timingSafeEqual(
    createHash('sha256').update(secret).digest(), createHash('sha256').update(candidate).digest(),
  )) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const result = await reconcilePaymentBatch()
    // Non-success lets the scheduler/monitor flag rows requiring attention.
    return NextResponse.json(result, { status: result.failed ? 503 : 200, headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Payment reconciliation is unavailable.' }, { status: 503 })
  }
}
