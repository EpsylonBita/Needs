"use client";

import { useEffect, useState } from 'react'

import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'

import { supabase } from '@/lib/supabase/client'
import { withCsrfHeaders } from '@/lib/utils/csrf'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY as string)

function CheckoutForm({ listingId, buyerProfileId }: { listingId: string; buyerProfileId?: string }) {
  const stripe = useStripe()
  const elements = useElements()
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [platformFee, setPlatformFee] = useState<number | null>(null)

  useEffect(() => {
    const init = async () => {
      const { data: flag } = await fetch('/api/flags/payments').then(r=>r.json()).catch(()=>({ data: { enabled: true } }))
      if (flag && flag.enabled === false) {
        setError('Payments disabled')
        setClientSecret(null)
        return
      }
      const s = await supabase.auth.getSession()
      const at = s.data.session?.access_token || ''
      const headers = await withCsrfHeaders({ 'Content-Type': 'application/json', ...(at ? { Authorization: `Bearer ${at}` } : {}) })
      const res = await fetch('/api/payments/create-intent', {
        method: 'POST',
        headers,
        body: JSON.stringify({ listingId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Unable to initialize payment')
        setClientSecret(null)
        return
      }
      setPlatformFee(typeof data.platformFee === 'number' ? data.platformFee : null)
      setClientSecret(data.clientSecret || null)
    }
    init()
  }, [listingId, buyerProfileId])

  const submit = async () => {
    if (!stripe || !elements) return
    setLoading(true)
    await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000') + '/payments/return',
      },
    })
    setLoading(false)
  }

  if (error) {
    return (
      <div className="space-y-3">
        <div className="rounded-md bg-yellow-100 text-yellow-800 p-3 text-sm">{error}</div>
        {error.includes('Seller not onboarded') && (
          <div className="text-sm text-gray-600">Ask the seller to complete Stripe onboarding to enable payments.</div>
        )}
      </div>
    )
  }
  if (!clientSecret) return <div className="text-sm text-gray-500">Preparing checkout…</div>
  return (
    <div className="space-y-4">
      {platformFee !== null && (
        <div className="text-sm text-gray-600">Platform fee: {platformFee.toFixed(2)} USD</div>
      )}
      <PaymentElement />
      <button onClick={submit} disabled={!stripe || loading} className="px-4 py-2 rounded-md bg-blue-600 text-white">
        {loading ? 'Processing…' : 'Pay'}
      </button>
    </div>
  )
}

export function Checkout({ listingId, buyerProfileId }: { listingId: string; buyerProfileId?: string }) {
  return (
    <Elements stripe={stripePromise} options={{ appearance: { theme: 'stripe' } }}>
      <CheckoutForm listingId={listingId} buyerProfileId={buyerProfileId} />
    </Elements>
  )
}
