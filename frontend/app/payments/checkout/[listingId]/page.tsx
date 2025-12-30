"use client";

import { useEffect, useState } from 'react'
 
import { Checkout } from '@/components/features/payments/checkout'
import { supabase } from '@/lib/supabase/client'

export default function CheckoutPage({ params }: { params: { listingId: string } }) {
  const [buyerProfileId, setBuyerProfileId] = useState<string | undefined>(undefined)

  useEffect(() => {
    const run = async () => {
      const userRes = await supabase.auth.getUser()
      const userId = userRes.data.user?.id
      if (!userId) return
      const { data: profile } = await supabase.from('profiles').select('id').eq('user_id', userId).limit(1).single()
      if (profile?.id) setBuyerProfileId(profile.id)
    }
    run()
  }, [])

  return (
    <div className="container mx-auto p-4 pt-[72px]">
      <h1 className="text-2xl font-bold">Checkout</h1>
      <div className="mt-4 max-w-md">
        <Checkout listingId={params.listingId} buyerProfileId={buyerProfileId} />
      </div>
    </div>
  )
}
