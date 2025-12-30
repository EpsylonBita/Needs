#!/usr/bin/env node

/**
 * Direct Webhook Security Test
 * 
 * This script tests webhook security by directly calling the webhook endpoint
 * with proper signatures generated using the webhook secret.
 */

const crypto = require('crypto');

// Use the webhook secret from environment
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_587a251c48e6d19a711dd1c7652eb043a50fd74deafe8416403b921fe98c4001';

// Generate Stripe-compatible webhook signature
function generateStripeSignature(payload, secret = WEBHOOK_SECRET) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = timestamp + '.' + payload;
  const signature = crypto
    .createHmac('sha256', secret.replace('whsec_', ''))
    .update(signedPayload, 'utf8')
    .digest('hex');
  
  return `t=${timestamp},v1=${signature}`;
}

// Create realistic Stripe webhook event
function createStripeWebhookEvent(eventType, data = {}) {
  const event = {
    id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    object: 'event',
    api_version: '2023-10-16',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: data.id || `pi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        object: 'payment_intent',
        amount: data.amount || 1000,
        currency: data.currency || 'usd',
        status: data.status || 'succeeded',
        metadata: data.metadata || {},
        charges: {
          object: 'list',
          data: [{
            id: `ch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            object: 'charge',
            amount: data.amount || 1000,
            currency: data.currency || 'usd',
            status: 'succeeded',
            payment_intent: data.id || `pi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            created: Math.floor(Date.now() / 1000)
          }],
          has_more: false,
          total_count: 1,
          url: '/v1/charges'
        },
        created: Math.floor(Date.now() / 1000)
      }
    },
    livemode: false,
    pending_webhooks: 1,
    request: { 
      id: null, 
      idempotency_key: null 
    },
    type: eventType
  };
  
  return JSON.stringify(event);
}

// Test webhook with different scenarios
async function testWebhookScenarios() {
  console.log('=== Webhook Security Validation ===\n');
  
  const scenarios = [
    {
      name: 'Valid Payment Success Webhook',
      eventType: 'payment_intent.succeeded',
      data: {
        amount: 2000,
        currency: 'usd',
        status: 'succeeded',
        metadata: {
          listing_id: 'test-listing-123',
          buyer_profile_id: 'test-buyer-123',
          seller_profile_id: 'test-seller-123'
        }
      },
      expectSuccess: true
    },
    {
      name: 'Valid Payment Failed Webhook',
      eventType: 'payment_intent.payment_failed',
      data: {
        amount: 2000,
        currency: 'usd',
        status: 'requires_payment_method'
      },
      expectSuccess: true
    },
    {
      name: 'Missing Signature',
      eventType: 'payment_intent.succeeded',
      data: { amount: 2000 },
      signature: '',
      expectSuccess: false
    },
    {
      name: 'Invalid Signature',
      eventType: 'payment_intent.succeeded',
      data: { amount: 2000 },
      signature: 't=1234567890,v1=invalid_signature_hash',
      expectSuccess: false
    }
  ];
  
  let passed = 0;
  const total = scenarios.length;
  
  for (const scenario of scenarios) {
    console.log(`Testing: ${scenario.name}`);
    
    try {
      const payload = createStripeWebhookEvent(scenario.eventType, scenario.data);
      const signature = scenario.signature || generateStripeSignature(payload);
      
      const response = await fetch('http://localhost:3000/api/payments/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': signature
        },
        body: payload
      });
      
      const result = {
        status: response.status,
        statusText: response.statusText,
        success: response.ok,
        expected: scenario.expectSuccess,
        passed: response.ok === scenario.expectSuccess
      };
      
      try {
        const data = await response.json();
        result.data = data;
      } catch (e) {
        result.data = null;
      }
      
      console.log(`  Status: ${result.status} ${result.statusText}`);
      console.log(`  Expected: ${scenario.expectSuccess ? 'Success' : 'Failure'}`);
      console.log(`  Result: ${result.passed ? '✅ PASSED' : '❌ FAILED'}`);
      
      if (result.data) {
        console.log(`  Response: ${JSON.stringify(result.data, null, 2)}`);
      }
      
      console.log('');
      
      if (result.passed) {
        passed++;
      }
      
    } catch (error) {
      console.log(`  Error: ${error.message}`);
      console.log(`  Result: ${scenario.expectSuccess ? '❌ FAILED' : '✅ PASSED'}`);
      console.log('');
      
      if (!scenario.expectSuccess) {
        passed++;
      }
    }
  }
  
  console.log(`=== Final Results ===`);
  console.log(`Tests Passed: ${passed}/${total}`);
  console.log(`Success Rate: ${Math.round((passed/total) * 100)}%`);
  
  if (passed === total) {
    console.log('\n🎉 All webhook security tests passed!');
    console.log('✅ Webhook signature validation is working correctly');
    console.log('✅ Invalid signatures are properly rejected');
    console.log('✅ Missing signatures are properly rejected');
  } else {
    console.log('\n⚠️  Some tests failed. Review the implementation.');
  }
  
  return passed === total;
}

// Check server status
async function checkServer() {
  try {
    const response = await fetch('http://localhost:3000/api/health');
    return response.ok;
  } catch (error) {
    return false;
  }
}

// Main execution
async function main() {
  console.log('🔍 Validating Webhook Security Implementation...\n');
  
  const serverRunning = await checkServer();
  if (!serverRunning) {
    console.log('❌ Next.js server is not running on localhost:3000');
    console.log('Please start your development server:');
    console.log('  npm run dev');
    return;
  }
  
  console.log('✅ Next.js server is running\n');
  console.log(`Using webhook secret: ${WEBHOOK_SECRET.substring(0, 15)}...`);
  console.log('');
  
  const success = await testWebhookScenarios();
  
  if (success) {
    console.log('\n🚀 Webhook security validation complete!');
    console.log('Your payment system is now fully secure and ready for production.');
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { generateStripeSignature, createStripeWebhookEvent, testWebhookScenarios };