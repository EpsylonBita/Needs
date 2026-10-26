"use client";

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { useTheme } from 'next-themes'
import { supabase } from '@/lib/supabase/client'
import { withCsrfHeaders } from '@/lib/utils/csrf'
import { useI18n } from '@/contexts/i18n-context'
import { useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { orderMoney } from '@/components/features/orders/order-copy'
import { paymentFlowCopy, paymentFlowError } from './payment-flow-copy'

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
const stripePromise = publishableKey ? loadStripe(publishableKey) : null

function CheckoutForm({ platformFee, totalAmount, isAgreement, expectedUserId }: { platformFee: number | null; totalAmount: number | null; isAgreement: boolean; expectedUserId: string }) {
  const { locale } = useI18n()
  const language = locale === 'el' ? 'el' : 'en'
  const copy = paymentFlowCopy[language]
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = useRef(false)
  const submitting = useRef(false)
  useLayoutEffect(() => { current.current = true; return () => { current.current = false } }, [])

  const submit = async () => {
    if (!stripe || !elements || submitting.current) return
    submitting.current = true
    setLoading(true)
    setError(null)
    try {
      const session = await supabase.auth.getSession()
      if (!current.current) return
      if (session.error || !session.data.session?.access_token || session.data.session.user?.id !== expectedUserId) throw new Error('Your account changed. Open checkout again before paying.')
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: new URL('/payments/return', window.location.origin).toString() },
      })
      if (current.current && result.error) setError(result.error.message || 'Payment could not be confirmed. Please try again.')
    } catch (cause) {
      if (current.current) setError(cause instanceof Error ? cause.message : 'Payment could not be confirmed. Please try again.')
    } finally { submitting.current = false; if (current.current) setLoading(false) }
  }

  return (
    <div className="space-y-4">
      {totalAmount !== null && <div className="rounded-xl border border-border bg-muted/30 p-4"><p className="text-sm text-muted-foreground">{isAgreement ? copy.agreedTotal : copy.total}</p><p className="mt-1 text-2xl font-semibold">{orderMoney(totalAmount, 'eur', language)}</p></div>}
      {platformFee !== null && <div className="text-sm text-muted-foreground">{copy.fee}: {orderMoney(platformFee, 'eur', language)}</div>}
      {error && <div role="alert" className="rounded-md border border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-200 p-3 text-sm">{paymentFlowError(error, language, 'confirmError')}</div>}
      <PaymentElement />
      <Button onClick={submit} disabled={!stripe || !elements || loading}>
        {loading ? copy.processing : copy.pay}
      </Button>
    </div>
  )
}

type CheckoutProps = { listingId: string; milestoneId?: string; chatId?: string; agreementId?: string }

export function Checkout(props: CheckoutProps) {
  const { user, isInitialized } = useAuth()
  const { locale } = useI18n()
  const copy = paymentFlowCopy[locale === 'el' ? 'el' : 'en']
  if (!isInitialized) return <section className="space-y-4"><h1 className="text-2xl font-bold">{copy.checkout}</h1><p role="status">{copy.preparing}</p></section>
  return <CheckoutContent key={`${user?.id || 'anonymous'}:${props.listingId}:${props.chatId || ''}:${props.agreementId || ''}:${props.milestoneId || ''}`} {...props} expectedUserId={user?.id || null} />
}

function CheckoutContent({ listingId, milestoneId, chatId, agreementId, expectedUserId }: CheckoutProps & { expectedUserId: string | null }) {
  const { locale } = useI18n()
  const language = locale === 'el' ? 'el' : 'en'
  const copy = paymentFlowCopy[language]
  const { resolvedTheme } = useTheme()
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [platformFee, setPlatformFee] = useState<number | null>(null)
  const [totalAmount, setTotalAmount] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const init = async () => {
      try {
        if (agreementId && milestoneId) throw new Error('Choose either an agreement or a milestone for checkout.')
        if (agreementId && !chatId) throw new Error('Choose the conversation for this agreement.')
        if (!stripePromise) throw new Error('Payments are not configured.')
        if (!expectedUserId) throw new Error('Sign in to continue to checkout.')
        const session = await supabase.auth.getSession()
        const token = session.data.session?.access_token
        if (session.error || !token) throw new Error('Sign in to continue to checkout.')
        if (session.data.session?.user?.id !== expectedUserId) throw new Error('Your account changed. Open checkout again before paying.')
        if (controller.signal.aborted) return
        const headers = await withCsrfHeaders({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + token })
        if (!headers['X-CSRF-Token']) throw new Error('Could not prepare a secure payment request. Refresh and try again.')
        if (controller.signal.aborted) return
        let paymentRequest: { listingId: string; milestoneId?: string; title?: string; amount?: number; chatId?: string; agreementId?: string } = { listingId, ...(chatId ? { chatId } : {}), ...(agreementId ? { agreementId } : {}) }
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
        const validTotal = typeof data.totalAmount === 'number' && Number.isFinite(data.totalAmount) && data.totalAmount > 0
          && Math.abs(data.totalAmount * 100 - Math.round(data.totalAmount * 100)) < 0.000001
          && (!agreementId || (data.totalAmount >= 0.5 && data.totalAmount <= 999999.99))
        if (agreementId && !validTotal) throw new Error('The payment total could not be verified.')
        if (!controller.signal.aborted) {
          setPlatformFee(typeof data.platformFee === 'number' ? data.platformFee : null)
          setTotalAmount(validTotal ? data.totalAmount : null)
          setClientSecret(data.clientSecret)
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to initialize payment')
      }
    }
    void init()
    return () => controller.abort()
  }, [listingId, milestoneId, chatId, agreementId, expectedUserId])

  return <section className="space-y-4"><h1 className="text-2xl font-bold">{copy.checkout}</h1>
    {error ? <div className="space-y-3"><div role="alert" className="rounded-md border border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-200 p-3 text-sm">{paymentFlowError(error, language, 'initError')}</div>{error.includes('Seller not set up') && <div className="text-sm text-muted-foreground">{copy.sellerHint}</div>}{agreementId && chatId && <Link href={`/chat?chat=${encodeURIComponent(chatId)}`} className="inline-flex min-h-11 items-center text-sm text-primary underline">{copy.backToChat}</Link>}</div>
      : !clientSecret ? <div role="status" className="text-sm text-muted-foreground">{copy.preparing}</div>
        : <Elements key={clientSecret} stripe={stripePromise} options={{ clientSecret, locale: language, appearance: { theme: resolvedTheme === 'dark' ? 'night' : 'stripe' } }}><CheckoutForm platformFee={platformFee} totalAmount={totalAmount} isAgreement={!!agreementId} expectedUserId={expectedUserId!} /></Elements>}
  </section>
}
