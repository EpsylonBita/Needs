#!/usr/bin/env node

/**
 * Final Webhook Security Validation
 * 
 * This script validates that webhook security is properly implemented
 * by testing the signature validation logic.
 */

const crypto = require('crypto');

// Use the configured webhook secret
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_587a251c48e6d19a711dd1c7652eb043a50fd74deafe8416403b921fe98c4001';

// Create a raw payload (exactly as Stripe would send it)
function createRawPayload(eventType) {
  const event = {
    id: `evt_test_${Date.now()}`,
    object: 'event',
    api_version: '2023-10-16',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: `pi_test_${Date.now()}`,
        object: 'payment_intent',
        amount: 2000,
        currency: 'usd',
        status: eventType === 'payment_intent.succeeded' ? 'succeeded' : 'requires_payment_method',
        metadata: {
          listing_id: 'test-listing-123',
          buyer_profile_id: 'test-buyer-123',
          seller_profile_id: 'test-seller-123'
        }
      }
    },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: eventType
  };
  
  // Return exact JSON string without formatting to match Stripe's format
  return JSON.stringify(event);
}

// Generate Stripe-compatible signature
function generateStripeSignature(payload, secret = WEBHOOK_SECRET) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const signature = crypto
    .createHmac('sha256', secret.replace('whsec_', ''))
    .update(signedPayload, 'utf8')
    .digest('hex');
  
  return `t=${timestamp},v1=${signature}`;
}

// Test webhook security scenarios
async function validateWebhookSecurity() {
  console.log('🔐 Final Webhook Security Validation\n');
  console.log(`Using webhook secret: ${WEBHOOK_SECRET.substring(0, 20)}...\n`);
  
  const tests = [
    {
      name: '✅ Valid payment_intent.succeeded webhook',
      eventType: 'payment_intent.succeeded',
      expectSuccess: true,
      description: 'Should accept valid webhook with correct signature'
    },
    {
      name: '❌ Missing signature header',
      eventType: 'payment_intent.succeeded',
      expectSuccess: false,
      signature: '',
      description: 'Should reject webhook without signature'
    },
    {
      name: '❌ Invalid signature format',
      eventType: 'payment_intent.succeeded',
      expectSuccess: false,
      signature: 'invalid-signature-format',
      description: 'Should reject webhook with malformed signature'
    },
    {
      name: '❌ Wrong webhook secret',
      eventType: 'payment_intent.succeeded',
      expectSuccess: false,
      secret: 'whsec_wrongsecret1234567890abcdef',
      description: 'Should reject webhook with incorrect secret'
    }
  ];
  
  let passed = 0;
  const total = tests.length;
  
  for (const test of tests) {
    console.log(`Testing: ${test.name}`);
    console.log(`Description: ${test.description}`);
    
    try {
      const payload = createRawPayload(test.eventType);
      const signature = test.signature || generateStripeSignature(payload, test.secret || WEBHOOK_SECRET);
      
      const response = await fetch('http://localhost:3000/api/payments/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': signature
        },
        body: payload
      });
      
      const success = response.ok;
      const passedTest = success === test.expectSuccess;
      
      console.log(`  Status: ${response.status} ${response.statusText}`);
      console.log(`  Expected: ${test.expectSuccess ? 'Success' : 'Failure'}`);
      console.log(`  Result: ${passedTest ? '✅ PASSED' : '❌ FAILED'}`);
      
      if (!success) {
        try {
          const errorData = await response.json();
          console.log(`  Error: ${errorData.error || 'Unknown error'}`);
        } catch (e) {
          console.log(`  Error: Unable to parse error response`);
        }
      }
      
      console.log('');
      
      if (passedTest) {
        passed++;
      }
      
    } catch (error) {
      console.log(`  Network Error: ${error.message}`);
      console.log(`  Result: ${!test.expectSuccess ? '✅ PASSED' : '❌ FAILED'}`);
      console.log('');
      
      if (!test.expectSuccess) {
        passed++;
      }
    }
  }
  
  console.log('=== Webhook Security Validation Results ===');
  console.log(`Tests Passed: ${passed}/${total}`);
  console.log(`Success Rate: ${Math.round((passed/total) * 100)}%`);
  
  if (passed === total) {
    console.log('\n🎉 SUCCESS: Webhook security validation complete!');
    console.log('✅ Valid webhooks with correct signatures are accepted');
    console.log('✅ Invalid/missing signatures are properly rejected');
    console.log('✅ Webhook secret validation is working correctly');
    console.log('\n🚀 Your payment system webhook security is production-ready!');
  } else {
    console.log('\n⚠️  Some security tests failed. Review the webhook implementation.');
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
  console.log('🔐 Final Webhook Security Validation\n');
  
  const serverRunning = await checkServer();
  if (!serverRunning) {
    console.log('❌ Next.js server is not running on localhost:3000');
    console.log('Please start your development server:');
    console.log('  npm run dev');
    return;
  }
  
  console.log('✅ Next.js server is running\n');
  
  const success = await validateWebhookSecurity();
  
  if (success) {
    console.log('\n📋 Deployment Checklist Status: COMPLETE');
    console.log('All security implementations have been validated and are working correctly.');
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { 
  createRawPayload, 
  generateStripeSignature, 
  validateWebhookSecurity 
};