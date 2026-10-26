import { NextResponse } from 'next/server'
import { databaseHealth } from '@/lib/health/database'
import { withApiErrorHandler } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const GET = withApiErrorHandler(async () => {
  const payload = await databaseHealth()
  const success = payload.status === 'ok'
  return NextResponse.json({ success, database: payload, timestamp: payload.timestamp }, {
    status: success ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
})
