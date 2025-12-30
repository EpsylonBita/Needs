import { NextRequest, NextResponse } from 'next/server'

import { stripe } from '@/lib/stripe/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { withApiErrorHandler, ErrorFactory, createValidationError } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const POST = withApiErrorHandler(async (request: NextRequest) => {
  try {
    // Authenticate the user using Bearer token
    const authHeader = request.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) {
      throw ErrorFactory.authentication('Unauthorized')
    }
    
    const token = authHeader.slice(7)
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    
    if (authError || !user) {
      throw ErrorFactory.authentication('Unauthorized')
    }

    const body = await request.json()
    const { profileId } = body as { profileId: string }
    
    if (!profileId) {
      throw createValidationError('profileId', 'profileId required')
    }

    // Get the user's profile to verify ownership
    const { data: requesterProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, user_id, stripe_account_id')
      .eq('user_id', user.id)
      .single()

    if (profileError || !requesterProfile) {
      throw ErrorFactory.businessLogic('Requester profile not found')
    }

    // Verify the requester owns the profile they're trying to onboard
    if (requesterProfile.id !== profileId) {
      throw ErrorFactory.authorization('Forbidden - can only onboard your own profile')
    }

    const { data: userAdmin } = await supabaseAdmin.auth.admin.getUserById(user.id)
    const email = userAdmin.user?.email || undefined

    let accountId = requesterProfile.stripe_account_id as string | null
    if (!accountId) {
      const account = await stripe.accounts.create({ type: 'express', email })
      accountId = account.id
      await supabaseAdmin
        .from('profiles')
        .update({ stripe_account_id: accountId })
        .eq('id', profileId)
    }

    const returnUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const link = await stripe.accountLinks.create({
      account: accountId!,
      refresh_url: `${returnUrl}/payments/onboarding/refresh`,
      return_url: `${returnUrl}/payments/onboarding/return`,
      type: 'account_onboarding',
    })

    return NextResponse.json({ url: link.url, accountId })
  } catch (error: any) {
    console.error('Stripe onboarding error:', error)
    throw error
  }
})
