import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { supabaseAdmin } from '@/lib/supabase/server'
import { withApiErrorHandler, ErrorFactory } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const GET = withApiErrorHandler(async (request: NextRequest) => {
  try {
    // Authenticate admin user
    const auth = await requireAdmin(request)
    if (!auth.allowed) {
      throw ErrorFactory.authorization('forbidden')
    }

    // Check environment configuration (server-side only)
    const envStatus = {
      stripe: !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY && !!process.env.STRIPE_SECRET_KEY,
      webhook: !!process.env.STRIPE_WEBHOOK_SECRET,
      supabase: !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      paymentsEnabled: (process.env.NEXT_PUBLIC_PAYMENTS_ENABLED || '').toLowerCase() === 'true'
    }

    // Get recent webhook events
    const { data: webhookEvents, error } = await supabaseAdmin
      .from('webhook_events')
      .select('id, created_at, event_type, status')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      console.error('Error fetching webhook events:', error)
      throw ErrorFactory.system('Failed to fetch webhook events')
    }

    return NextResponse.json({
      envStatus,
      webhooks: webhookEvents || [],
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Admin status error:', error)
    throw error
  }
})
