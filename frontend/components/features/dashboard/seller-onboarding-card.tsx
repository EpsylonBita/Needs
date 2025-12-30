"use client";

import { useEffect, useState } from 'react'

import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { supabase } from '@/lib/supabase/client'

export default function SellerOnboardingCard() {
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const router = useRouter()

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

  const handleStartOnboarding = () => {
    router.push('/payments/onboarding')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enable Payouts</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Complete your seller onboarding to start receiving payments for your services.
        </p>
        <Button onClick={handleStartOnboarding}>
          Start Onboarding
        </Button>
      </CardContent>
    </Card>
  )
}
