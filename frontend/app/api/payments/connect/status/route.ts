import { NextRequest, NextResponse } from 'next/server'
import { syncConnectedAccount } from '@/lib/stripe/connect'
import { supabaseAdmin } from '@/lib/supabase/server'
import { ErrorFactory, withApiErrorHandler } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const GET = withApiErrorHandler(async (request: NextRequest) => {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) throw ErrorFactory.authentication('Unauthorized')
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authorization.slice(7))
  if (authError || !user) throw ErrorFactory.authentication('Unauthorized')
  const { data: profile, error } = await supabaseAdmin.from('profiles')
    .select('stripe_account_id').eq('user_id', user.id).single()
  if (error || !profile) throw ErrorFactory.businessLogic('Profile not found')
  if (!profile.stripe_account_id) return NextResponse.json({ connected: false, ready: false })
  const status = await syncConnectedAccount(profile.stripe_account_id)
  return NextResponse.json({ connected: true, ...status }, { headers: { 'Cache-Control': 'no-store' } })
})
