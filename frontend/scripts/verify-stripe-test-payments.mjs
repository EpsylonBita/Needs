// Run only against the local application with Stripe CLI forwarding enabled.
// This creates real Stripe TEST objects, never live charges. Stripe retains its
// test payment history; temporary Supabase fixtures are removed in finally.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { STRIPE_API_VERSION } from '../lib/stripe/api-version.mjs';

assert.ok(process.argv.includes('--allow-test-payments'), 'Opt in with --allow-test-payments.');
process.loadEnvFile('.env.local');
const secret = process.env.STRIPE_SECRET_KEY || '';
assert.match(secret, /^(sk|rk)_test_/, 'A Stripe test-mode secret or restricted key is required.');
assert.match(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '', /^pk_test_/, 'The application publishable key must be test-mode.');
assert.match(process.env.STRIPE_WEBHOOK_SECRET || '', /^whsec_/, 'Configure the local Stripe CLI signing secret first.');
const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname), 'Only the local application can be tested.');
assert.equal(origin.protocol, 'http:');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(new URL(supabaseUrl).hostname, 'qczrqxmewjsydrrvjdil.supabase.co', 'Unexpected Supabase project.');
const connectedId = process.env.STRIPE_TEST_CONNECTED_ACCOUNT;
assert.match(connectedId || '', /^acct_/, 'Set STRIPE_TEST_CONNECTED_ACCOUNT to a disposable platform-connected test seller.');
const stripe = new Stripe(secret, { apiVersion: STRIPE_API_VERSION });
const platform = await stripe.accounts.retrieve(null);
assert.equal(platform.id, 'acct_1QmzaBFEIG2kR47o', 'Unexpected Stripe platform.');
assert.notEqual(connectedId, platform.id, 'The destination must be a connected seller, not the platform.');
// Retrieving under this test key verifies that the seller belongs to this
// platform/test environment. No assumption is made from the acct_ prefix.
const connected = await stripe.accounts.retrieve(connectedId);
assert.ok(!connected.deleted, 'The connected test seller was deleted.');
assert.equal(connected.capabilities?.transfers, 'active', 'Complete test seller onboarding before running payment tests.');

const marker = `needs-stripe-test-${randomUUID()}`;
const started = Math.floor(Date.now() / 1000) - 5;
const makeClient = key => createClient(supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: randomUUID() } });
const admin = makeClient(process.env.SUPABASE_SERVICE_ROLE_KEY);
const users = [];
const listings = [];
const intents = new Set();
const charges = new Set();
const eventIds = new Set();
const passed = [];
const check = (result, label) => { if (result.error) throw new Error(`${label}: ${result.error.message}`); return result.data; };
const pass = label => { passed.push(label); console.log(`PASS ${label}`); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(label, operation, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await operation();
    if (result) return result;
    await pause(750);
  }
  throw new Error(`${label} timed out. Confirm Stripe CLI forwards both platform and Connect events to ${origin.origin}/api/payments/webhook.`);
}
async function app(user, path, body, expected = 200) {
  const csrfResponse = await fetch(new URL('/api/csrf', origin));
  assert.ok(csrfResponse.ok, 'CSRF preparation failed.');
  const { csrfToken } = await csrfResponse.json();
  const response = await fetch(new URL(path, origin), {
    method: 'POST', headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, Cookie: `csrf_token=${csrfToken}` },
    body: JSON.stringify(body || {}),
  });
  const payload = await response.json();
  assert.equal(response.status, expected, `${path}: ${payload.error || response.statusText}`);
  return payload;
}
async function createUser(role) {
  const email = `${marker}-${role}@example.com`;
  const password = `${randomUUID()}aA1!`;
  const data = check(await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: role === 'admin' ? 'admin' : 'user' }, user_metadata: { fullName: 'Temporary Stripe verification' } }), 'create temporary user');
  const user = { id: data.user.id, email, client: makeClient(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) };
  users.push(user);
  const session = check(await user.client.auth.signInWithPassword({ email, password }), 'sign in');
  user.token = session.session.access_token;
  let profile = check(await user.client.from('profiles').select('id').eq('user_id', user.id).maybeSingle(), 'find own profile');
  if (!profile) profile = check(await user.client.from('profiles').insert({ user_id: user.id, display_name: 'Temporary Stripe verification' }).select('id').single(), 'create own profile');
  user.profileId = profile.id;
  return user;
}
async function listing(seller, suffix) {
  const row = check(await seller.client.from('listings').insert({ seller_id: seller.profileId, title: `${marker}-${suffix}`, description: 'Temporary Stripe test; automatically removed.', price: 2, main_category: 'Items', sub_category: 'Other', status: 'active', location: 'SRID=4326;POINT(23.7275 37.9838)', address: { label: 'Athens test location' }, contact_number: 'test-only' }).select('id').single(), 'create test listing');
  listings.push(row.id);
  return row.id;
}
async function payment(intentId) {
  return check(await admin.from('payments').select('*').eq('stripe_payment_intent', intentId).single(), 'load payment');
}
async function actualEvent(type, intentId) {
  return until(`Stripe ${type} event`, async () => {
    const events = await stripe.events.list({ type, created: { gte: started }, limit: 100 });
    const event = events.data.find(item => {
      const obj = item.data.object;
      return obj.id === intentId || obj.payment_intent === intentId;
    });
    if (!event) return null;
    assert.equal(event.livemode, false, 'Refusing a live event.');
    eventIds.add(event.id);
    return event;
  });
}
async function verifyForwarded(type, intentId) {
  const event = await actualEvent(type, intentId);
  // This is deliberately observed BEFORE replay: it proves actual CLI delivery,
  // not only that a locally generated test signature can reach the endpoint.
  await until(`CLI delivery of ${type}`, async () => {
    const row = check(await admin.from('webhook_events').select('processed_at,processing_error,processing_result').eq('id', event.id).maybeSingle(), 'read webhook marker');
    return row?.processed_at && !row.processing_error && row.processing_result ? row : null;
  });
  return event;
}
async function replay(event) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const response = await fetch(new URL('/api/payments/webhook', origin), { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': signature }, body: payload });
  assert.equal(response.status, 200, 'Signed real-event replay failed.');
  assert.equal((await response.json()).duplicate, true, 'Re-delivery must be acknowledged as a duplicate.');
}
async function authorize(intentId, buyer) {
  intents.add(intentId);
  const initial = await stripe.paymentIntents.retrieve(intentId);
  assert.equal(initial.livemode, false, 'Refusing to confirm a live PaymentIntent.');
  assert.equal(initial.receipt_email, buyer.email, 'Receipt must target the verified buyer.');
  assert.equal(initial.capture_method, 'manual');
  assert.equal(initial.currency, 'eur');
  const confirmed = await stripe.paymentIntents.confirm(intentId, { payment_method: 'pm_card_visa', return_url: new URL('/payments/return', origin).href });
  assert.equal(confirmed.status, 'requires_capture');
  assert.equal(confirmed.livemode, false);
  if (confirmed.latest_charge) charges.add(typeof confirmed.latest_charge === 'string' ? confirmed.latest_charge : confirmed.latest_charge.id);
  await verifyForwarded('payment_intent.amount_capturable_updated', intentId);
}
async function confirmAndCapture(intentId, buyer, seller, milestoneId) {
  const row = await payment(intentId);
  await app(buyer, '/api/payments/capture', { intentId }, 409);
  const table = milestoneId ? 'milestones' : 'payments';
  const id = milestoneId || row.id;
  check(await buyer.client.from(table).update({ buyer_confirmed: true }).eq('id', id), 'buyer confirmation under RLS');
  check(await seller.client.from(table).update({ seller_confirmed: true }).eq('id', id), 'seller confirmation under RLS');
  const result = await app(seller, '/api/payments/capture', { intentId });
  assert.equal(result.captured, true);
  assert.equal((await stripe.paymentIntents.retrieve(intentId)).status, 'succeeded');
  const event = await verifyForwarded('payment_intent.succeeded', intentId);
  assert.equal((await payment(intentId)).status, 'completed');
  await replay(event);
  const transactions = check(await admin.from('transactions').select('id').eq('payment_id', row.id).eq('type', 'charge'), 'charge deduplication');
  assert.equal(transactions.length, 1);
  return row.id;
}
async function refundThroughApp(paymentId, intentId, buyer, operator) {
  const complaint = await app(buyer, `/api/payments/disputes/${paymentId}/create`);
  const again = await app(buyer, `/api/payments/disputes/${paymentId}/create`);
  assert.equal(again.disputeId, complaint.disputeId);
  assert.equal((await payment(intentId)).status, 'completed', 'A complaint must not invalidate a successful payment.');
  await app(operator, `/api/payments/disputes/${complaint.disputeId}/refund`);
  await verifyForwarded('charge.refunded', intentId);
  assert.equal((await payment(intentId)).status, 'refunded');
  const settled = await stripe.paymentIntents.retrieve(intentId);
  const charge = await stripe.charges.retrieve(typeof settled.latest_charge === 'string' ? settled.latest_charge : settled.latest_charge.id);
  assert.equal(charge.refunded, true);
  if (charge.transfer) {
    const transfer = await stripe.transfers.retrieve(typeof charge.transfer === 'string' ? charge.transfer : charge.transfer.id);
    assert.equal(transfer.reversed, true, 'Refund must reverse seller proceeds.');
  }
  if (charge.application_fee) {
    const fee = await stripe.applicationFees.retrieve(typeof charge.application_fee === 'string' ? charge.application_fee : charge.application_fee.id);
    assert.equal(fee.refunded, true, 'Refund must return the platform fee.');
  }
  const dispute = check(await admin.from('disputes').select('status').eq('id', complaint.disputeId).single(), 'complaint refund state');
  assert.equal(dispute.status, 'refunded');
  await app(operator, `/api/payments/disputes/${complaint.disputeId}/refund`);
}

try {
  const seller = await createUser('seller');
  const buyer = await createUser('buyer');
  const milestoneBuyer = await createUser('milestone-buyer');
  const retryBuyer = await createUser('retry-buyer');
  const operator = await createUser('admin');
  check(await admin.from('profiles').update({ stripe_account_id: connectedId }).eq('id', seller.profileId), 'attach disposable test seller');
  const statusResponse = await fetch(new URL('/api/payments/connect/status', origin), { headers: { Authorization: `Bearer ${seller.token}` } });
  assert.equal(statusResponse.status, 200);
  assert.equal((await statusResponse.json()).transfersEnabled, true);
  pass('authenticated Connect status and verified test fixtures');

  const listingId = await listing(seller, 'listing');
  const created = await app(buyer, '/api/payments/create-intent', { listingId });
  intents.add(created.paymentId);
  const reused = await app(buyer, '/api/payments/create-intent', { listingId });
  assert.equal(reused.paymentId, created.paymentId);
  await authorize(created.paymentId, buyer);
  const paymentId = await confirmAndCapture(created.paymentId, buyer, seller);
  pass('listing authorization, durable intent reuse, two-party capture, actual CLI webhook and duplicate replay');
  await refundThroughApp(paymentId, created.paymentId, buyer, operator);
  pass('buyer complaint, admin refund, transfer/fee reversal and real refund webhook');

  const milestoneListing = await listing(seller, 'milestone');
  const proposal = await app(milestoneBuyer, '/api/milestones/create', { listingId: milestoneListing, title: 'Test milestone', amount: 2 });
  const milestone = await app(milestoneBuyer, '/api/payments/milestones/create-intent', { listingId: milestoneListing, milestoneId: proposal.id, title: 'Test milestone', amount: 2 });
  intents.add(milestone.intentId);
  assert.equal(milestone.milestoneId, proposal.id);
  await authorize(milestone.intentId, milestoneBuyer);
  assert.equal(check(await admin.from('milestones').select('status').eq('id', proposal.id).single(), 'authorized milestone').status, 'requires_capture');
  const milestonePayment = await confirmAndCapture(milestone.intentId, milestoneBuyer, seller, proposal.id);
  assert.equal(check(await admin.from('milestones').select('status').eq('id', proposal.id).single(), 'completed milestone').status, 'completed');
  pass('existing milestone proposal funds exactly once and completes through the real webhook');
  await refundThroughApp(milestonePayment, milestone.intentId, milestoneBuyer, operator);
  pass('milestone payment refund and financial ledger');

  const retryListing = await listing(seller, 'retry');
  const original = await app(retryBuyer, '/api/payments/create-intent', { listingId: retryListing });
  intents.add(original.paymentId);
  assert.equal((await stripe.paymentIntents.retrieve(original.paymentId)).livemode, false);
  await stripe.paymentIntents.cancel(original.paymentId);
  await verifyForwarded('payment_intent.canceled', original.paymentId);
  const replacement = await app(retryBuyer, '/api/payments/create-intent', { listingId: retryListing });
  intents.add(replacement.paymentId);
  assert.notEqual(replacement.paymentId, original.paymentId);
  const retried = await app(retryBuyer, '/api/payments/create-intent', { listingId: retryListing });
  assert.equal(retried.paymentId, replacement.paymentId);
  pass('canceled payment safely retires and retries with one replacement intent');
} finally {
  const cleanupErrors = [];
  const clean = async (label, operation) => { try { return await operation(); } catch (error) { cleanupErrors.push(`${label}: ${error.message}`); return null; } };
  // Settle only the exact intents created by this run, after rechecking test mode.
  for (const id of intents) await clean(`settle test intent ${id}`, async () => {
    const intent = await stripe.paymentIntents.retrieve(id, { expand: ['latest_charge'] });
    assert.equal(intent.livemode, false, 'Refusing live cleanup.');
    if (intent.status === 'succeeded') {
      if (!intent.latest_charge?.refunded) await stripe.refunds.create({ payment_intent: id, reverse_transfer: true, refund_application_fee: true }, { idempotencyKey: `${marker}:cleanup:${id}` });
      await verifyForwarded('charge.refunded', id);
    } else if (intent.status !== 'canceled') {
      await stripe.paymentIntents.cancel(id);
      await verifyForwarded('payment_intent.canceled', id);
    }
  });
  if (cleanupErrors.length) throw new Error(`Test settlement needs attention; local fixtures preserved (${marker}): ${cleanupErrors.join('; ')}`);
  // Let already emitted CLI events settle before deleting their local records.
  if (intents.size) await pause(2500);
  await clean('collect own webhook markers', async () => {
    for await (const event of stripe.events.list({ created: { gte: started }, limit: 100 })) {
      const object = event.data.object;
      if (intents.has(object.id) || intents.has(object.payment_intent) || charges.has(object.id) || charges.has(object.source_transaction)) eventIds.add(event.id);
    }
  });
  for (const id of listings) {
    await clean('remove own payment audit', async () => check(await admin.from('payment_audit_logs').delete().eq('listing_id', id), 'audit cleanup'));
    const rows = await clean('find own payments', async () => check(await admin.from('payments').select('id').eq('listing_id', id), 'payments cleanup'));
    for (const row of rows || []) await clean('remove linked payment audit', async () => check(await admin.from('payment_audit_logs').delete().eq('payment_id', row.id), 'payment audit cleanup'));
    await clean('remove own listing', async () => check(await admin.from('listings').delete().eq('id', id), 'listing cleanup'));
  }
  if (eventIds.size) await clean('remove own webhook markers', async () => check(await admin.from('webhook_events').delete().in('id', [...eventIds]), 'event cleanup'));
  for (const user of users) {
    await user.client.auth.signOut();
    await clean('remove temporary user', async () => check(await admin.auth.admin.deleteUser(user.id), 'user cleanup'));
  }
  if (cleanupErrors.length) throw new Error(`Cleanup needs attention (${marker}): ${cleanupErrors.join('; ')}`);
  console.log(`CLEANUP complete; ${passed.length} real Stripe test checks passed. Stripe test history is retained; no live money was used.`);
}
