"use client";

import { useEffect, useState } from 'react'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { useTheme } from 'next-themes'
import { supabase } from '@/lib/supabase/client'
import { withCsrfHeaders } from '@/lib/utils/csrf'
import { useI18n } from '@/contexts/i18n-context'
import { Button } from '@/components/ui/button'
import { orderMoney } from '@/components/features/orders/order-copy'
import { paymentFlowCopy, paymentFlowError } from './payment-flow-copy'

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
const stripePromise = publishableKey ? loadStripe(publishableKey) : null

function CheckoutForm({ platformFee }: { platformFee: number | null }) {
  const { locale } = useI18n()
  const language = locale === 'el' ? 'el' : 'en'
  const copy = paymentFlowCopy[language]
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!stripe || !elements || loading) return
    setLoading(true)
    setError(null)
    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: new URL('/payments/return', window.location.origin).toString() },
      })
      if (result.error) setError(result.error.message || 'Payment could not be confirmed. Please try again.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Payment could not be confirmed. Please try again.')
    } finally { setLoading(false) }
  }

  return (
    <div className="space-y-4">
      {platformFee !== null && <div className="text-sm text-muted-foreground">{copy.fee}: {orderMoney(platformFee, 'eur', language)}</div>}
      {error && <div role="alert" className="rounded-md border border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-200 p-3 text-sm">{paymentFlowError(error, language, 'confirmError')}</div>}
      <PaymentElement />
      <Button onClick={submit} disabled={!stripe || !elements || loading}>
        {loading ? copy.processing : copy.pay}
      </Button>
    </div>
  )
}

export function Checkout({ listingId, milestoneId, chatId }: { listingId: string; milestoneId?: string; chatId?: string }) {
  const { locale } = useI18n()
  const language = locale === 'el' ? 'el' : 'en'
  const copy = paymentFlowCopy[language]
  const { resolvedTheme } = useTheme()
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [platformFee, setPlatformFee] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setClientSecret(null)
    setError(null)
    const init = async () => {
      try {
        if (!stripePromise) throw new Error('Payments are not configured.')
        const session = await supabase.auth.getSession()
        const token = session.data.session?.access_token
        if (session.error || !token) throw new Error('Sign in to continue to checkout.')
        if (controller.signal.aborted) return
        const headers = await withCsrfHeaders({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + token })
        if (!headers['X-CSRF-Token']) throw new Error('Could not prepare a secure payment request. Refresh and try again.')
        if (controller.signal.aborted) return
        let paymentRequest: { listingId: string; milestoneId?: string; title?: string; amount?: number; chatId?: string } = { listingId, ...(chatId ? { chatId } : {}) }
        if (milestoneId) {
          const { data: proposal, error: proposalError } = await supabase.from('milestones')
            .select('id,title,amount').eq('id', milestoneId).eq('listing_id', listingId).single()
          if (proposalError || !proposal) throw new Error('Milestone proposal not found.')
          paymentRequest = { ...paymentRequest, milestoneId, title: proposal.title, amount: Number(proposal.amount) }
        }
        if (controller.signal.aborted) return
        const response = await fetch(milestoneId ? '/api/payments/milestones/create-intent' : '/api/payments/create-intent', {
          method: 'POST', headers, body: JSON.stringify(paymentRequest), signal: controller.signal,
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data?.error?.message || (typeof data?.error === 'string' ? data.error : null) || 'Unable to initialize payment')
        if (typeof data.clientSecret !== 'string' || !data.clientSecret) throw new Error('The payment could not be initialized.')
        if (!controller.signal.aborted) {
          setPlatformFee(typeof data.platformFee === 'number' ? data.platformFee : null)
          setClientSecret(data.clientSecret)
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to initialize payment')
      }
    }
    void init()
    return () => controller.abort()
  }, [listingId, milestoneId, chatId])

  return <section className="space-y-4"><h1 className="text-2xl font-bold">{copy.checkout}</h1>
    {error ? <div className="space-y-3"><div role="alert" className="rounded-md border border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-200 p-3 text-sm">{paymentFlowError(error, language, 'initError')}</div>{error.includes('Seller not set up') && <div className="text-sm text-muted-foreground">{copy.sellerHint}</div>}</div>
      : !clientSecret ? <div role="status" className="text-sm text-muted-foreground">{copy.preparing}</div>
        : <Elements key={clientSecret} stripe={stripePromise} options={{ clientSecret, locale: language, appearance: { theme: resolvedTheme === 'dark' ? 'night' : 'stripe' } }}><CheckoutForm platformFee={platformFee} /></Elements>}
  </section>
}
