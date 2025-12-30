"use client";

import { useState } from 'react'
 
import { supabase } from '@/lib/supabase/client'

export default function OnboardingPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setLoading(true)
    setError(null)
    const userRes = await supabase.auth.getUser()
    const userId = userRes.data.user?.id
    if (!userId) { setError('Not authenticated'); setLoading(false); return }
    const { data: profile } = await supabase.from('profiles').select('id').eq('user_id', userId).limit(1).single()
    if (!profile?.id) { setError('Profile not found'); setLoading(false); return }
    const res = await fetch('/api/payments/connect/onboard', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: profile.id, userId })
    })
    const json = await res.json()
    if (!res.ok) { setError(json.error || 'Failed'); setLoading(false); return }
    window.location.href = json.url
  }

  return (
    <div className="container mx-auto p-4 pt-[72px]">
      <h1 className="text-2xl font-bold">Stripe Onboarding</h1>
      <p className="text-muted-foreground mt-2">Enable payouts by completing onboarding.</p>
      <button onClick={start} disabled={loading} className="mt-4 px-4 py-2 rounded-md bg-blue-600 text-white">
        {loading ? 'Redirecting…' : 'Start Onboarding'}
      </button>
      {error && <p className="mt-2 text-red-500">{error}</p>}
    </div>
  )
}
