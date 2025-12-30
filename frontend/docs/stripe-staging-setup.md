# Stripe Staging Environment Setup Guide

This guide provides a comprehensive approach to setting up Stripe for testing without requiring production business VAT or website verification.

## Overview

Since you mentioned you cannot set up proper Stripe API keys due to lacking business VAT or website requirements, this staging setup allows you to:
- Test payment flows securely
- Validate webhook handling
- Verify security implementations
- Develop without production credentials

## Option 1: Stripe Test Mode (Recommended)

### 1. Create Stripe Test Account

1. Go to [stripe.com](https://stripe.com)
2. Sign up for a free account (no business verification needed for test mode)
3. Navigate to Developers → API keys
4. Use **Test mode** keys (never need business verification)

### 2. Configure Test Environment Variables

Create a `.env.local` file in your project root:

```bash
# Stripe Test Keys (No business verification required)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
STRIPE_SECRET_KEY=sk_test_your_secret_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here

# Payment Processing
NEXT_PUBLIC_APP_URL=http://localhost:3000
STRIPE_CONNECT_CLIENT_ID=ca_test_your_connect_client_id_here
```

### 3. Test Card Numbers

Use these test card numbers for different scenarios:

```
✅ Success: 4242 4242 4242 4242
❌ Decline: 4000 0000 0000 0002
💳 Requires 3D Secure: 4000 0025 0000 3155
🔄 Insufficient Funds: 4000 0000 0000 9995
🚫 Fraudulent: 4100 0000 0000 0019
```

Use any future expiry date and any 3-digit CVC.

### 4. Test Webhooks Locally

#### Install Stripe CLI
```bash
# Windows (PowerShell)
Invoke-WebRequest -Uri "https://github.com/stripe/stripe-cli/releases/latest/download/stripe_windows_x86_64.zip" -OutFile stripe-cli.zip
Expand-Archive -Path stripe-cli.zip -DestinationPath C:\stripe-cli
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\stripe-cli", [EnvironmentVariableTarget]::User)
```

#### Login and Forward Webhooks
```bash
# Login to Stripe CLI
stripe login

# Forward webhooks to your local server
stripe listen --forward-to localhost:3000/api/payments/webhook/secure-route

# In another terminal, trigger test events
stripe trigger payment_intent.succeeded
```

## Option 2: Mock Stripe Service (Development Only)

For complete offline development, create a mock Stripe service:

### 1. Create Mock Stripe Service

```typescript
// lib/stripe/mock-server.ts
import { NextResponse } from 'next/server'

export class MockStripeServer {
  private paymentIntents = new Map<string, any>()
  private customers = new Map<string, any>()
  
  async createPaymentIntent(params: any) {
    const id = `pi_mock_${Date.now()}`
    const client_secret = `pi_${id}_secret_${Date.now()}`
    
    const intent = {
      id,
      client_secret,
      amount: params.amount,
      currency: params.currency,
      status: 'requires_payment_method',
      metadata: params.metadata || {},
      created: Math.floor(Date.now() / 1000)
    }
    
    this.paymentIntents.set(id, intent)
    return intent
  }
  
  async retrievePaymentIntent(id: string) {
    return this.paymentIntents.get(id) || null
  }
  
  async confirmPaymentIntent(id: string) {
    const intent = this.paymentIntents.get(id)
    if (!intent) throw new Error('Payment intent not found')
    
    intent.status = 'succeeded'
    intent.charges = {
      data: [{
        id: `ch_mock_${Date.now()}`,
        amount: intent.amount,
        payment_intent: id,
        status: 'succeeded'
      }]
    }
    
    return intent
  }
  
  async failPaymentIntent(id: string, reason = 'card_declined') {
    const intent = this.paymentIntents.get(id)
    if (!intent) throw new Error('Payment intent not found')
    
    intent.status = 'requires_payment_method'
    intent.last_payment_error = {
      code: reason,
      message: `Payment failed: ${reason}`
    }
    
    return intent
  }
  
  generateMockWebhookEvent(eventType: string, paymentIntentId: string) {
    const baseEvent = {
      id: `evt_mock_${Date.now()}`,
      object: 'event',
      api_version: '2023-10-16',
      created: Math.floor(Date.now() / 1000),
      data: { object: this.paymentIntents.get(paymentIntentId) },
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type: eventType
    }
    
    return baseEvent
  }
}

export const mockStripeServer = new MockStripeServer()
```

### 2. Create Mock Webhook Endpoint

```typescript
// app/api/payments/mock-webhook/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { mockStripeServer } from '@/lib/stripe/mock-server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { eventType, paymentIntentId } = body
    
    if (!eventType || !paymentIntentId) {
      return NextResponse.json({ error: 'Missing eventType or paymentIntentId' }, { status: 400 })
    }
    
    // Generate mock webhook event
    const mockEvent = mockStripeServer.generateMockWebhookEvent(eventType, paymentIntentId)
    
    // Forward to secure webhook handler
    const webhookUrl = new URL('/api/payments/webhook/secure-route', request.url)
    const webhookResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'mock-signature'
      },
      body: JSON.stringify(mockEvent)
    })
    
    return webhookResponse
  } catch (error) {
    return NextResponse.json({ error: 'Mock webhook failed' }, { status: 500 })
  }
}
```

### 3. Create Development Testing Interface

```typescript
// app/stripe-dev/page.tsx
'use client'

import { useState } from 'react'

export default function StripeDevPage() {
  const [amount, setAmount] = useState(1000)
  const [paymentIntentId, setPaymentIntentId] = useState('')
  const [status, setStatus] = useState('')
  
  const createMockPayment = async () => {
    try {
      const response = await fetch('/api/payments/create-intent/secure-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: 'test-listing',
          amount: amount,
          currency: 'usd'
        })
      })
      
      const data = await response.json()
      setPaymentIntentId(data.clientSecret?.split('_secret')[0] || '')
      setStatus('Created: ' + data.clientSecret)
    } catch (error) {
      setStatus('Error: ' + error.message)
    }
  }
  
  const triggerWebhook = async (eventType: string) => {
    try {
      const response = await fetch('/api/payments/mock-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType,
          paymentIntentId
        })
      })
      
      const data = await response.json()
      setStatus(`Webhook triggered: ${eventType}`)
    } catch (error) {
      setStatus('Webhook error: ' + error.message)
    }
  }
  
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Stripe Development Testing</h1>
      
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">Amount (cents)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(parseInt(e.target.value))}
            className="border rounded px-3 py-2"
          />
        </div>
        
        <button
          onClick={createMockPayment}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Create Mock Payment
        </button>
        
        {paymentIntentId && (
          <div className="space-y-2">
            <p className="text-sm text-gray-600">Payment Intent: {paymentIntentId}</p>
            
            <div className="flex gap-2">
              <button
                onClick={() => triggerWebhook('payment_intent.succeeded')}
                className="bg-green-500 text-white px-3 py-1 rounded text-sm hover:bg-green-600"
              >
                Success
              </button>
              
              <button
                onClick={() => triggerWebhook('payment_intent.payment_failed')}
                className="bg-red-500 text-white px-3 py-1 rounded text-sm hover:bg-red-600"
              >
                Fail
              </button>
              
              <button
                onClick={() => triggerWebhook('charge.refunded')}
                className="bg-yellow-500 text-white px-3 py-1 rounded text-sm hover:bg-yellow-600"
              >
                Refund
              </button>
            </div>
          </div>
        )}
        
        {status && (
          <div className="mt-4 p-3 bg-gray-100 rounded">
            <p className="text-sm font-mono">{status}</p>
          </div>
        )}
      </div>
    </div>
  )
}
```

## Option 3: Stripe Test Environment Configuration

### 1. Environment-Specific Configuration

```typescript
// lib/stripe/config.ts
export const stripeConfig = {
  development: {
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST,
    secretKey: process.env.STRIPE_SECRET_KEY_TEST,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET_TEST,
    connectClientId: process.env.STRIPE_CONNECT_CLIENT_ID_TEST,
    apiVersion: '2023-10-16' as const
  },
  production: {
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    connectClientId: process.env.STRIPE_CONNECT_CLIENT_ID,
    apiVersion: '2023-10-16' as const
  }
}

export function getStripeConfig() {
  const env = process.env.NODE_ENV === 'production' ? 'production' : 'development'
  return stripeConfig[env]
}
```

### 2. Conditional Stripe Client Initialization

```typescript
// lib/stripe/server.ts
import Stripe from 'stripe'
import { getStripeConfig } from './config'

const config = getStripeConfig()

export const stripe = config.secretKey ? new Stripe(config.secretKey, {
  apiVersion: config.apiVersion,
  typescript: true,
}) : null

// Mock Stripe for development without keys
export const stripeClient = stripe || {
  paymentIntents: {
    create: async (params: any) => {
      console.log('Mock: Creating payment intent', params)
      return {
        id: `pi_mock_${Date.now()}`,
        client_secret: `pi_mock_${Date.now()}_secret`,
        status: 'requires_payment_method'
      }
    }
  },
  webhooks: {
    constructEvent: (payload: any, sig: any, secret: any) => {
      console.log('Mock: Constructing webhook event')
      return JSON.parse(payload)
    }
  }
} as any
```

## Testing Checklist

### Security Tests
- [ ] Verify authentication is required for all payment endpoints
- [ ] Test that client-provided buyerProfileId is ignored
- [ ] Validate rate limiting works correctly
- [ ] Confirm audit logs are created for all payment actions
- [ ] Test webhook signature validation

### Functional Tests
- [ ] Create payment intent successfully
- [ ] Handle payment success webhook
- [ ] Handle payment failure webhook
- [ ] Process refunds correctly
- [ ] Create and process milestone payments
- [ ] Handle dispute creation and resolution

### Integration Tests
- [ ] Test complete payment flow end-to-end
- [ ] Verify notification creation
- [ ] Test transaction recording
- [ ] Validate database state consistency
- [ ] Test error scenarios and edge cases

## Deployment Considerations

### 1. Environment Variables

Set these in your deployment platform:

```bash
# Production (when you have business verification)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_live_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...

# Test/Development
STRIPE_SECRET_KEY_TEST=sk_test_...
STRIPE_WEBHOOK_SECRET_TEST=whsec_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST=pk_test_...
```

### 2. Webhook Configuration

For production deployment:

1. Deploy your application
2. Get the production webhook URL: `https://yourdomain.com/api/payments/webhook/secure-route`
3. Add webhook endpoint in Stripe Dashboard
4. Configure webhook secret
5. Test webhook delivery

### 3. Security Best Practices

- Never commit API keys to code
- Use different keys for test and production
- Implement proper webhook signature verification
- Monitor webhook delivery status
- Set up webhook endpoint monitoring

## Next Steps

1. **Choose your approach**: Test mode (recommended) or mock service
2. **Set up environment variables** with test keys
3. **Test payment flows** using the provided test cards
4. **Verify webhook handling** with Stripe CLI
5. **Run comprehensive security tests**
6. **Deploy to staging** environment
7. **Monitor and validate** all payment operations

This staging setup allows you to develop and test securely without business verification while maintaining the same security standards as production.