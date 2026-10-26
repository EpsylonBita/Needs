import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { configuredContactEmailDelivery } from '@/lib/email/contact-email-transport'
import { dispatchContactNotifications } from '@/lib/email/contact-notification'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/** Cookie authentication is intentionally not accepted by this worker endpoint. */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET || ''
  if (secret.length < 32) return NextResponse.json({ error: 'Contact worker is not configured.' }, { status: 503 })
  const authorization = request.headers.get('Authorization') || ''
  const candidate = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  // Fixed-size digests avoid length-dependent timingSafeEqual exceptions.
  if (!candidate || candidate.length > 1024 || !timingSafeEqual(
    createHash('sha256').update(secret).digest(),
    createHash('sha256').update(candidate).digest(),
  )) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const delivery = configuredContactEmailDelivery()
    if (!delivery) return NextResponse.json({ configured: false, claimed: 0, accepted: 0, pending: 0 })
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return NextResponse.json({ error: 'Contact storage is not configured.' }, { status: 503 })
    const database = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    // Fixed batch size cannot be increased by a request body or query string.
    return NextResponse.json(await dispatchContactNotifications(database, delivery, { limit: 5 }))
  } catch {
    return NextResponse.json({ error: 'Contact notifications could not be processed.' }, { status: 503 })
  }
}
