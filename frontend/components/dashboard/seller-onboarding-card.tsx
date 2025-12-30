"use client";

import { useEffect, useState } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { supabase } from '@/lib/supabase/client'

export default function SellerOnboardingCard() {
  const [needsOnboarding, setNeedsOnboarding] = useState(false)

  useEffect(() => {
    const run = async () => {
      const userRes = await supabase.auth.getUser()
      const userId = userRes.data.user?.id
      if (!userId) return
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, stripe_account_id')
        .eq('user_id', userId)
        .single()
      setNeedsOnboarding(!profile?.stripe_account_id)
    }
    run()
  }, [])

  if (!needsOnboarding) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Enable Payouts</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Complete Stripe onboarding to publish listings and receive payments.</p>
        <a href="/payments/onboarding" className="inline-block mt-4 px-4 py-2 rounded-md bg-blue-600 text-white">Start Onboarding</a>
      </CardContent>
    </Card>
  )
}
