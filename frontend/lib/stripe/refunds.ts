import { stripe } from '@/lib/stripe/server'
import type Stripe from 'stripe'

// Refund events can arrive out of order and a refund can fail after initially
// succeeding. Always retrieve Stripe's current records, including every page.
export async function currentPaymentRefunds(paymentIntent: string, requestOptions?: Stripe.RequestOptions, maximumRecords = 1000) {
  const refunds: Stripe.Refund[] = []
  let startingAfter: string | undefined
  do {
    const parameters = { payment_intent: paymentIntent, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) }
    const page = requestOptions ? await stripe.refunds.list(parameters, requestOptions) : await stripe.refunds.list(parameters)
    refunds.push(...page.data)
    if (!page.has_more) return refunds
    startingAfter = page.data.at(-1)?.id
    if (!startingAfter || refunds.length >= maximumRecords) throw new Error('Refund history requires manual reconciliation')
  } while (startingAfter)
  return refunds
}
