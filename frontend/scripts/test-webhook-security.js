#!/usr/bin/env node

/**
 * Webhook Security Testing Script
 * 
 * This script tests the webhook signature validation and security features
 * without requiring Stripe CLI installation.
 */

const crypto = require('crypto');

// Mock webhook secret from environment or generate new one
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_587a251c48e6d19a711dd1c7652eb043a50fd74deafe8416403b921fe98c4001';

// Generate webhook signature
function generateWebhookSignature(payload, secret = WEBHOOK_SECRET) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = timestamp + '.' + payload;
  const signature = crypto
    .createHmac('sha256', secret.split('_')[1])
    .update(signedPayload, 'utf8')
    .digest('hex');
  
  return {
    timestamp,
    signature: `t=${timestamp},v1=${signature}`,
    payload
  };
}

// Create test webhook events
function createTestWebhookEvent(eventType, paymentIntentData = {}) {
  const event = {
    id: `evt_test_${Date.now()}`,
    object: 'event',
    api_version: '2023-10-16',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: paymentIntentData.id || `pi_test_${Date.now()}`,
        object: 'payment_intent',
        amount: paymentIntentData.amount || 1000,
        currency: paymentIntentData.currency || 'usd',
        status: paymentIntentData.status || 'succeeded',
        charges: {
          data: [{
            id: `ch_test_${Date.now()}`,
            amount: paymentIntentData.amount || 1000,
            currency: paymentIntentData.currency || 'usd',
            status: 'succeeded'
          }]
        }
      }
    },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: eventType
  };
  
  return JSON.stringify(event);
}

// Test webhook endpoints
async function testWebhookEndpoint(eventType, payload, signature, expectSuccess = true) {
  const url = 'http://localhost:3000/api/payments/webhook';
  
  try {
    const response = await fetch(url, {
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
      expected: expectSuccess,
      passed: response.ok === expectSuccess
    };
    
    try {
      const data = await response.json();
      result.data = data;
    } catch (e) {
      result.data = null;
    }
    
    return result;
  } catch (error) {
    return {
      status: 0,
      statusText: 'Network Error',
      success: false,
      expected: expectSuccess,
      passed: false,
      error: error.message
    };
  }
}

// Run comprehensive webhook security tests
async function runWebhookSecurityTests() {
  console.log('=== Webhook Security Testing ===\n');
  
  const tests = [
    {
      name: 'Valid payment_intent.succeeded webhook',
      eventType: 'payment_intent.succeeded',
      expectSuccess: true
    },
    {
      name: 'Valid payment_intent.payment_failed webhook',
      eventType: 'payment_intent.payment_failed',
      expectSuccess: true
    },
    {
      name: 'Valid charge.refunded webhook',
      eventType: 'charge.refunded',
      expectSuccess: true
    },
    {
      name: 'Missing signature header',
      eventType: 'payment_intent.succeeded',
      expectSuccess: false,
      modifySignature: () => ''
    },
    {
      name: 'Invalid signature format',
      eventType: 'payment_intent.succeeded',
      expectSuccess: false,
      modifySignature: () => 'invalid-signature-format'
    },
    {
      name: 'Tampered payload',
      eventType: 'payment_intent.succeeded',
      expectSuccess: false,
      modifyPayload: (payload) => {
        const data = JSON.parse(payload);
        data.data.object.amount = 999999; // Tamper with amount
        return JSON.stringify(data);
      }
    }
  ];
  
  let passed = 0;
  let total = tests.length;
  
  for (const test of tests) {
    console.log(`Testing: ${test.name}`);
    
    // Generate payload
    let payload = createTestWebhookEvent(test.eventType);
    if (test.modifyPayload) {
      payload = test.modifyPayload(payload);
    }
    
    // Generate signature
    let signatureData = generateWebhookSignature(payload);
    let signature = signatureData.signature;
    if (test.modifySignature) {
      signature = test.modifySignature();
    }
    
    // Test endpoint
    const result = await testWebhookEndpoint(test.eventType, payload, signature, test.expectSuccess);
    
    console.log(`  Status: ${result.status} ${result.statusText}`);
    console.log(`  Expected: ${test.expectSuccess ? 'Success' : 'Failure'}`);
    console.log(`  Result: ${result.passed ? '✅ PASSED' : '❌ FAILED'}`);
    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }
    console.log('');
    
    if (result.passed) {
      passed++;
    }
  }
  
  console.log(`=== Test Results ===`);
  console.log(`Passed: ${passed}/${total}`);
  console.log(`Success Rate: ${Math.round((passed/total) * 100)}%`);
  
  if (passed === total) {
    console.log('🎉 All webhook security tests passed!');
  } else {
    console.log('⚠️  Some tests failed. Check the implementation.');
  }
  
  return passed === total;
}

// Check if server is running
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
  console.log('Checking if Next.js server is running on localhost:3000...\n');
  
  const serverRunning = await checkServer();
  if (!serverRunning) {
    console.log('❌ Next.js server is not running on localhost:3000');
    console.log('Please start your development server first:');
    console.log('  npm run dev');
    console.log('');
    console.log('Then run this test script again.');
    return;
  }
  
  console.log('✅ Next.js server is running\n');
  
  await runWebhookSecurityTests();
}

// Run the tests
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  generateWebhookSignature,
  createTestWebhookEvent,
  testWebhookEndpoint,
  runWebhookSecurityTests
};