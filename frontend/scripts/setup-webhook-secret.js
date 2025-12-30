#!/usr/bin/env node

/**
 * Webhook Secret Setup Script
 * 
 * This script helps you get a webhook secret for testing without Stripe CLI.
 * For development, you can use a mock webhook secret and test the signature validation logic.
 */

const crypto = require('crypto');

// Generate a mock webhook secret for testing
function generateMockWebhookSecret() {
  return 'whsec_' + crypto.randomBytes(32).toString('hex');
}

// Generate a test webhook signature
function generateTestSignature(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = timestamp + '.' + payload;
  const signature = crypto
    .createHmac('sha256', secret.split('_')[1])
    .update(signedPayload, 'utf8')
    .digest('hex');
  
  return {
    timestamp,
    signature: `t=${timestamp},v1=${signature}`,
    secret
  };
}

console.log('=== Webhook Secret Setup Helper ===\n');

const mockSecret = generateMockWebhookSecret();
console.log('Generated mock webhook secret for testing:');
console.log(`STRIPE_WEBHOOK_SECRET=${mockSecret}\n`);

console.log('To complete your webhook setup:');
console.log('1. Copy the webhook secret above');
console.log('2. Update your .env.local file:');
console.log(`   STRIPE_WEBHOOK_SECRET=${mockSecret}`);
console.log('');
console.log('3. For real webhook testing, install Stripe CLI:');
console.log('   - Download from: https://github.com/stripe/stripe-cli/releases');
console.log('   - Run: stripe login');
console.log('   - Run: stripe listen --forward-to localhost:3000/api/payments/webhook/secure-route');
console.log('');
console.log('4. Test webhook signature validation with this mock secret');

// Generate a test example
const testPayload = JSON.stringify({ test: 'data' });
const testResult = generateTestSignature(testPayload, mockSecret);

console.log('\n=== Test Example ===');
console.log('Payload:', testPayload);
console.log('Signature:', testResult.signature);
console.log('Secret:', testResult.secret);