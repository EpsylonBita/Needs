'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import { useI18n } from '@/contexts/i18n-context'
import { paymentFlowCopy, paymentFlowError } from '@/components/features/payments/payment-flow-copy'

export default function OnboardingReturnPage() {
  const { locale } = useI18n()
  const language = locale === 'el' ? 'el' : 'en'
  const copy = paymentFlowCopy[language]
  const [ready, setReady] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)
  useEffect(() => {
    let active = true
    async function check() {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        if (error || !session?.access_token) throw new Error('Please sign in to check your payout account.')
        const response = await fetch('/api/payments/connect/status', { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' })
        const status = await response.json()
        if (!response.ok) throw new Error(status?.error?.message || (typeof status?.error === 'string' ? status.error : 'Could not check your payout account.'))
        if (!active) return
        setReady(status.ready === true)
      } catch (cause) {
        if (active) setErrorMessage(cause instanceof Error ? cause.message : 'Could not check your payout account.')
      } finally { if (active) setChecked(true) }
    }
    void check()
    return () => { active = false }
  }, [])
  return (
    <div className="needs-shell needs-page">
      <h1 className="text-2xl font-bold">{ready ? copy.onboardingComplete : copy.onboarding}</h1>
      <p role={errorMessage ? 'alert' : 'status'} className="text-muted-foreground mt-2">{errorMessage ? paymentFlowError(errorMessage, language, 'accountError') : !checked ? copy.checking : ready ? copy.ready : copy.incomplete}</p>
      {checked && !ready && <Link href="/payments/onboarding" className="mt-4 inline-flex min-h-11 items-center px-4 py-2 rounded-md bg-primary text-primary-foreground">{copy.continue}</Link>}
    </div>
  )
}
