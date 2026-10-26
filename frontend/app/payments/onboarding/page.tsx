"use client";

import { useState } from 'react'
 
import { supabase } from '@/lib/supabase/client'
import { withCsrfHeaders } from '@/lib/utils/csrf'
import { useI18n } from '@/contexts/i18n-context'
import { Button } from '@/components/ui/button'
import { paymentFlowCopy, paymentFlowError } from '@/components/features/payments/payment-flow-copy'

export default function OnboardingPage() {
  const { locale } = useI18n()
  const language = locale === 'el' ? 'el' : 'en'
  const copy = paymentFlowCopy[language]
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setLoading(true)
    setError(null)
    try {
    const session = await supabase.auth.getSession()
    const token = session.data.session?.access_token
    if (session.error || !token) throw new Error('Not authenticated')
    const userRes = await supabase.auth.getUser()
    const userId = userRes.data.user?.id
    if (!userId) { setError('Not authenticated'); setLoading(false); return }
    const { data: profile } = await supabase.from('profiles').select('id').eq('user_id', userId).limit(1).single()
    if (!profile?.id) { setError('Profile not found'); setLoading(false); return }
    const headers = await withCsrfHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` })
    if (!headers['X-CSRF-Token']) throw new Error('Could not prepare a secure request. Refresh and try again.')
    const res = await fetch('/api/payments/connect/onboard', {
      method: 'POST', headers, body: JSON.stringify({ profileId: profile.id })
    })
    const json = await res.json()
    if (!res.ok || !json.url) throw new Error(json?.error?.message || (typeof json?.error === 'string' ? json.error : 'Failed to start onboarding'))
    window.location.href = json.url
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to start onboarding')
    } finally { setLoading(false) }
  }

  return (
    <div className="needs-shell needs-page">
      <h1 className="text-2xl font-bold">{copy.onboarding}</h1>
      <p className="text-muted-foreground mt-2">{copy.onboardingIntro}</p>
      <Button onClick={start} disabled={loading} className="mt-4">
        {loading ? copy.redirecting : copy.start}
      </Button>
      {error && <p role="alert" className="mt-2 text-destructive">{paymentFlowError(error, language, 'onboardingError')}</p>}
    </div>
  )
}
