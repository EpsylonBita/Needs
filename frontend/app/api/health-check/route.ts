import { NextRequest, NextResponse } from 'next/server';
import { withApiErrorHandler, ErrorFactory } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic';

export const GET = withApiErrorHandler(async (request: NextRequest) => {
  try {
    const db = await fetch(`${new URL(request.url).origin}/api/health`, { method: 'GET', signal: AbortSignal.timeout(3000) })
    const ok = db.ok
    const payload = ok ? await db.json() : { status: 'error' }
    return NextResponse.json({ success: ok, database: payload, timestamp: new Date().toISOString() }, { status: ok ? 200 : 500 })
  } catch (error) {
    console.error('[HEALTH] Health check error:', error);
    throw ErrorFactory.system('Health check failed')
  }
})
