'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { beginStripeOnboarding } from '@/lib/stripe/connect-client'
import { useI18n } from '@/contexts/i18n-context'
import { paymentFlowCopy, paymentFlowError } from '@/components/features/payments/payment-flow-copy'

export default function OnboardingRefreshPage() {
  const { locale } = useI18n()
  const language = locale === 'el' ? 'el' : 'en'
  const copy = paymentFlowCopy[language]
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    beginStripeOnboarding().then(url => { if (active) window.location.assign(url) })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Please try onboarding again.') })
    return () => { active = false }
  }, [])
  return (
    <div className="needs-shell needs-page">
      <h1 className="text-2xl font-bold">{copy.refreshOnboarding}</h1>
      <p role={error ? 'alert' : 'status'} className="text-muted-foreground mt-2">{error ? paymentFlowError(error, language, 'onboardingError') : copy.refreshing}</p>
      {error && <Link href="/payments/onboarding" className="mt-4 inline-flex min-h-11 items-center px-4 py-2 rounded-md bg-primary text-primary-foreground">{copy.retry}</Link>}
    </div>
  )
}
