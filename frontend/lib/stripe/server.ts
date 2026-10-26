import Stripe from 'stripe'
import { STRIPE_API_VERSION } from './api-version.mjs'

const secret = process.env.STRIPE_SECRET_KEY
if (!secret) {
  throw new Error('STRIPE_SECRET_KEY is not set')
}
export const stripe = new Stripe(secret, { apiVersion: STRIPE_API_VERSION })
