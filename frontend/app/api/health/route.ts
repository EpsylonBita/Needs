import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { withApiErrorHandler, ErrorFactory } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const GET = withApiErrorHandler(async () => {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const ping = await supabaseAdmin.from('profiles').select('id').limit(1)
    const ok = !ping.error
    return NextResponse.json({
      status: ok ? 'ok' : 'error',
      database: {
        status: ok ? 'connected' : 'error',
        message: ok ? 'supabase reachable' : ping.error?.message
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Health check error:', error);
    throw ErrorFactory.system('Health check failed')
  }
})
