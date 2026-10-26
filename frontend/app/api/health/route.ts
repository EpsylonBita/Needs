import { NextResponse } from 'next/server'
import { databaseHealth } from '@/lib/health/database'
import { withApiErrorHandler } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const GET = withApiErrorHandler(async () => {
  const payload = await databaseHealth()
  return NextResponse.json(payload, {
    status: payload.status === 'ok' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
})
