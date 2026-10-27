// Run only against the local application with Stripe CLI forwarding enabled.
// This creates real Stripe TEST objects, never live charges. Stripe retains its
// test payment history; temporary Supabase fixtures are removed in finally.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { STRIPE_API_VERSION } from '../lib/stripe/api-version.mjs';

export function verificationOptions(args) {
  const options = { envFile: '.env.local', includeMilestones: false };
  let consent = false;
  let selectedEnvironment = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--allow-test-payments') consent = true;
    else if (args[i] === '--include-milestones') options.includeMilestones = true;
    else if (args[i] === '--no-env-file' || args[i] === '--env-file') {
      assert.ok(!selectedEnvironment, 'Choose only one environment source.');
      selectedEnvironment = true;
      options.envFile = args[i] === '--no-env-file' ? null : args[++i];
      assert.ok(options.envFile === null || (options.envFile && !options.envFile.startsWith('--')), '--env-file requires a path.');
    } else throw new Error('Unknown verification argument.');
  }
  assert.ok(consent, 'Opt in with --allow-test-payments.');
  return options;
}

// Resolve a separate test environment without writing files or changing process.env.
// Explicit process values take precedence over file values, including empty values.
export async function verificationEnvironment(options, inherited = process.env) {
  const fromFile = options.envFile ? parseEnv(await readFile(resolve(options.envFile), 'utf8')) : {};
  return { ...fromFile, ...inherited };
}

export function verificationConfig(env) {
  // Avoid assert.match(secret): its diagnostic includes the complete actual value.
  assert.ok(/^(sk|rk|rkcs)_test_/.test(env.STRIPE_SECRET_KEY || ''), 'A Stripe test-mode secret or restricted key is required.');
  assert.ok(/^pk_test_/.test(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ''), 'The application publishable key must be test-mode.');
  assert.ok(/^whsec_/.test(env.STRIPE_WEBHOOK_SECRET || ''), 'Configure the local Stripe CLI signing secret first.');
  const origin = new URL(env.NEXT_PUBLIC_APP_URL || '');
  assert.ok(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)
    && !origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash,
  'Only a local HTTP origin without credentials, path, query or fragment can be tested.');
  const project = env.SUPABASE_TEST_EXPECTED_PROJECT_REF || '';
  assert.ok(/^[a-z0-9]{20}$/.test(project), 'Set SUPABASE_TEST_EXPECTED_PROJECT_REF after checking the intended test database.');
  const supabaseUrl = new URL(env.NEXT_PUBLIC_SUPABASE_URL || '');
  assert.ok(supabaseUrl.protocol === 'https:' && supabaseUrl.hostname === `${project}.supabase.co`
    && !supabaseUrl.username && !supabaseUrl.password && !supabaseUrl.port && supabaseUrl.pathname === '/' && !supabaseUrl.search && !supabaseUrl.hash,
  'Unexpected Supabase project or URL.');
  assert.ok(env.NEXT_PUBLIC_SUPABASE_ANON_KEY && env.SUPABASE_SERVICE_ROLE_KEY, 'Supabase fixture credentials are required.');
  const platformId = env.STRIPE_TEST_EXPECTED_PLATFORM_ACCOUNT || '';
  const connectedId = env.STRIPE_TEST_CONNECTED_ACCOUNT || '';
  assert.ok(/^acct_[A-Za-z0-9]+$/.test(platformId), 'Set STRIPE_TEST_EXPECTED_PLATFORM_ACCOUNT after verifying the intended platform.');
  assert.ok(/^acct_[A-Za-z0-9]+$/.test(connectedId) && connectedId !== platformId, 'Choose a disposable connected test seller distinct from the platform.');
  return { env, origin, supabaseUrl: supabaseUrl.origin, platformId, connectedId };
}

export function assertOwnTestIntent(intent, { listingIds, profileIds, connectedId }) {
  assert.equal(intent.livemode, false, 'Refusing a live PaymentIntent.');
  assert.ok(listingIds.has(intent.metadata?.listing_id), 'PaymentIntent is not attached to a listing from this run.');
  assert.ok(profileIds.has(intent.metadata?.buyer_profile_id) && profileIds.has(intent.metadata?.seller_profile_id), 'PaymentIntent parties are outside this run.');
  const destination = intent.transfer_data?.destination;
  assert.equal(typeof destination === 'string' ? destination : destination?.id, connectedId, 'Unexpected connected destination.');
  assert.equal(intent.capture_method, 'manual');
  assert.equal(intent.currency, 'eur');
}

export function safeVerificationError(error) {
  return String(error?.message || error).replace(/\b(?:sk|rk|rkcs|pk)_(?:test|live)_[A-Za-z0-9_]+\b/g, '[Stripe key]')
    .replace(/\bwhsec_[A-Za-z0-9_]+\b/g, '[webhook secret]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[token]');
}

export async function verifyStripeTestPayments(config, options) {
const { env, origin, supabaseUrl, platformId, connectedId } = config;
const secret = env.STRIPE_SECRET_KEY;
const stripe = new Stripe(secret, { apiVersion: STRIPE_API_VERSION });
const platform = await stripe.accounts.retrieve(null);
assert.equal(platform.id, platformId, 'The key belongs to a different Stripe platform. No fixtures were created.');
assert.notEqual(connectedId, platform.id, 'The destination must be a connected seller, not the platform.');
// Retrieving under this test key verifies that the seller belongs to this
// platform/test environment. No assumption is made from the acct_ prefix.
const connected = await stripe.accounts.retrieve(connectedId);
assert.ok(!connected.deleted, 'The connected test seller was deleted.');
assert.equal(connected.capabilities?.transfers, 'active', 'Complete test seller onboarding before running payment tests.');

const marker = `needs-stripe-test-${randomUUID()}`;
const started = Math.floor(Date.now() / 1000) - 5;
const makeClient = key => createClient(supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: randomUUID() } });
const admin = makeClient(env.SUPABASE_SERVICE_ROLE_KEY);
const users = [];
const listings = [];
const chats = new Set();
const profileIds = new Set();
const intents = new Set();
const charges = new Set();
const eventIds = new Set();
const passed = [];
const assertOwnedIntent = intent => assertOwnTestIntent(intent, { listingIds: new Set(listings), profileIds, connectedId });
console.log(`RUN ${marker}; platform ${platformId}; database ${new URL(supabaseUrl).hostname}; app ${origin.origin}`);
const check = (result, label) => { if (result.error) throw new Error(`${label}: ${result.error.message}`); return result.data; };
const pass = label => { passed.push(label); console.log(`PASS ${label}`); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// Fail before fixture writes if the selected application/schema are not ready.
check(await admin.from('payments').select('id,stripe_canceled_at').limit(0), 'payment migration preflight');
check(await admin.from('service_price_agreements').select('id').limit(0), 'agreement migration preflight');
check(await admin.from('order_cancellations').select('id').limit(0), 'cancellation migration preflight');
if (options.includeMilestones) {
  const flag = check(await admin.from('feature_flags').select('enabled').eq('key', 'milestones_enabled').maybeSingle(), 'milestone preflight');
  assert.equal(flag?.enabled, true, 'Milestones must already be enabled; the runner never changes shared flags.');
}
assert.equal((await fetch(new URL('/api/orders/reconcile', origin))).status, 405, 'The local POST lifecycle API must be running before creating fixtures.');
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
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${path}: HTTP ${response.status}; ${payload.error || response.statusText}`);
  return payload;
}
async function get(user, path) {
  const response = await fetch(new URL(path, origin), { headers: { Authorization: `Bearer ${user.token}` } });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  return response.json();
}
async function createUser(role) {
  const email = `${marker}-${role}@example.com`;
  const password = `${randomUUID()}aA1!`;
  const data = check(await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: role === 'admin' ? 'admin' : 'user', verification_run: marker }, user_metadata: { fullName: 'Temporary Stripe verification' } }), 'create temporary user');
  const user = { id: data.user.id, email, client: makeClient(env.NEXT_PUBLIC_SUPABASE_ANON_KEY) };
  users.push(user);
  const session = check(await user.client.auth.signInWithPassword({ email, password }), 'sign in');
  user.token = session.session.access_token;
  let profile = check(await user.client.from('profiles').select('id').eq('user_id', user.id).maybeSingle(), 'find own profile');
  if (!profile) profile = check(await user.client.from('profiles').insert({ user_id: user.id, display_name: 'Temporary Stripe verification' }).select('id').single(), 'create own profile');
  user.profileId = profile.id;
  profileIds.add(profile.id);
  return user;
}
async function listing(seller, suffix, hourly = false) {
  const row = check(await seller.client.from('listings').insert({ seller_id: seller.profileId, title: `${marker}-${suffix}`, description: hourly ? 'Temporary test service, 10 ευρώ την ώρα.' : 'Temporary Stripe test; automatically removed.', price: hourly ? 10 : 2, main_category: hourly ? 'Services' : 'Items', sub_category: hourly ? 'I can' : 'Sell', status: 'active', location: 'SRID=4326;POINT(23.7275 37.9838)', address: { label: 'Athens test location' }, contact_number: 'test-only' }).select('id').single(), 'create test listing');
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
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET });
  const response = await fetch(new URL('/api/payments/webhook', origin), { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': signature }, body: payload });
  assert.equal(response.status, 200, 'Signed real-event replay failed.');
  assert.equal((await response.json()).duplicate, true, 'Re-delivery must be acknowledged as a duplicate.');
}
async function authorize(intentId, buyer) {
  intents.add(intentId);
  const initial = await stripe.paymentIntents.retrieve(intentId);
  assertOwnedIntent(initial);
  assert.equal(initial.receipt_email, buyer.email, 'Receipt must target the verified buyer.');
  assert.equal(initial.capture_method, 'manual');
  assert.equal(initial.currency, 'eur');
  const confirmed = await stripe.paymentIntents.confirm(intentId, { payment_method: 'pm_card_visa', return_url: new URL('/payments/return', origin).href });
  assert.equal(confirmed.status, 'requires_capture');
  assert.equal(confirmed.livemode, false);
  if (confirmed.latest_charge) charges.add(typeof confirmed.latest_charge === 'string' ? confirmed.latest_charge : confirmed.latest_charge.id);
  await verifyForwarded('payment_intent.amount_capturable_updated', intentId);
}
async function confirmAndCapture(intentId, buyer, seller, captureByBuyer = false) {
  const row = await payment(intentId);
  await app(buyer, '/api/payments/capture', { paymentId: row.id, expectedUserId: buyer.id }, 409);
  await app(buyer, '/api/orders/confirm', { paymentId: row.id, expectedUserId: buyer.id });
  assert.equal((await stripe.paymentIntents.retrieve(intentId)).status, 'requires_capture', 'One confirmation cannot capture payment.');
  await app(seller, '/api/orders/confirm', { paymentId: row.id, expectedUserId: seller.id });
  const actor = captureByBuyer ? buyer : seller;
  const result = await app(actor, '/api/payments/capture', { paymentId: row.id, expectedUserId: actor.id }, [200, 202]);
  assert.ok(result.captured === true || result.pending === true, 'Capture must report settlement or pending verification.');
  await until('Stripe capture', async () => (await stripe.paymentIntents.retrieve(intentId)).status === 'succeeded');
  const event = await verifyForwarded('payment_intent.succeeded', intentId);
  assert.equal((await payment(intentId)).status, 'completed');
  await replay(event);
  const transactions = check(await admin.from('transactions').select('id').eq('payment_id', row.id).eq('type', 'charge'), 'charge deduplication');
  assert.equal(transactions.length, 1);
  return row.id;
}
async function refundThroughApp(paymentId, intentId, buyer, operator) {
  const complaint = await app(buyer, `/api/payments/disputes/${paymentId}/create`, { expectedUserId: buyer.id });
  const again = await app(buyer, `/api/payments/disputes/${paymentId}/create`, { expectedUserId: buyer.id });
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

async function reconcile(intentId, actor) {
  const row = await payment(intentId);
  return app(actor, '/api/orders/reconcile', { paymentId: row.id, expectedUserId: actor.id });
}
async function verifyAuthorizationDeadline(intentId, actor) {
  const intent = await stripe.paymentIntents.retrieve(intentId, { expand: ['latest_charge'] });
  assertOwnedIntent(intent);
  const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : await stripe.charges.retrieve(intent.latest_charge);
  const deadline = charge?.payment_method_details?.card?.capture_before;
  assert.ok(Number.isFinite(deadline), 'The test card must supply a capture deadline.');
  const order = await reconcile(intentId, actor);
  assert.equal(new Date(order.authorization?.expires_at).getTime(), deadline * 1000, 'The UI deadline must come from Stripe, not a hardcoded duration.');
  assert.equal(order.authorization?.provider_status, 'requires_capture');
  assert.ok(order.authorization?.last_checked_at, 'Reconciliation must record its verification time.');
}
async function waitReleased(intentId, actor) {
  await until('Stripe cancellation', async () => (await stripe.paymentIntents.retrieve(intentId)).status === 'canceled');
  await verifyForwarded('payment_intent.canceled', intentId);
  await until('persisted cancellation', async () => {
    const order = await reconcile(intentId, actor);
    return order.stripe_canceled_at && order.authorization?.provider_status === 'canceled';
  });
}

try {
  const seller = await createUser('seller');
  const buyer = await createUser('buyer');
  const operator = await createUser('admin');
  check(await admin.from('profiles').update({ stripe_account_id: connectedId }).eq('id', seller.profileId), 'attach disposable test seller');
  const statusResponse = await fetch(new URL('/api/payments/connect/status', origin), { headers: { Authorization: `Bearer ${seller.token}` } });
  const statusPayload = await statusResponse.json();
  assert.equal(statusResponse.status, 200, `Connect status: HTTP ${statusResponse.status}; ${statusPayload.error || statusPayload.message || statusResponse.statusText}`);
  assert.equal(statusPayload.transfersEnabled, true);
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

  if (options.includeMilestones) {
  const milestoneBuyer = await createUser('milestone-buyer');
  const milestoneListing = await listing(seller, 'milestone');
  const proposal = await app(milestoneBuyer, '/api/milestones/create', { listingId: milestoneListing, title: 'Test milestone', amount: 2 });
  const milestone = await app(milestoneBuyer, '/api/payments/milestones/create-intent', { listingId: milestoneListing, milestoneId: proposal.id, title: 'Test milestone', amount: 2 });
  intents.add(milestone.intentId);
  assert.equal(milestone.milestoneId, proposal.id);
  await authorize(milestone.intentId, milestoneBuyer);
  assert.equal(check(await admin.from('milestones').select('status').eq('id', proposal.id).single(), 'authorized milestone').status, 'requires_capture');
  const milestonePayment = await confirmAndCapture(milestone.intentId, milestoneBuyer, seller, true);
  assert.equal(check(await admin.from('milestones').select('status').eq('id', proposal.id).single(), 'completed milestone').status, 'completed');
  pass('existing milestone proposal funds exactly once and completes through the real webhook');
  await refundThroughApp(milestonePayment, milestone.intentId, milestoneBuyer, operator);
  pass('milestone payment refund and financial ledger');
  }

  const hourlyBuyer = await createUser('hourly-buyer');
  const hourlyListing = await listing(seller, 'hourly', true);
  const chatId = check(await hourlyBuyer.client.rpc('get_or_create_direct_chat', { p_listing_id: hourlyListing, p_other_profile_id: null, p_expected_user_id: hourlyBuyer.id }), 'create own hourly conversation');
  assert.equal(typeof chatId, 'string');
  chats.add(chatId);
  const contextPath = `/api/payments/context?listingId=${hourlyListing}&chatId=${chatId}`;
  assert.equal((await get(hourlyBuyer, contextPath)).canPay, false);
  await app(seller, '/api/payments/agreements', { listingId: hourlyListing, chatId, action: 'propose', amount: 2, expectedAgreementId: null });
  const proposalContext = await get(hourlyBuyer, contextPath);
  const agreementId = proposalContext.agreement?.id;
  assert.ok(agreementId);
  assert.equal(proposalContext.canPay, false);
  await app(seller, '/api/payments/agreements', { listingId: hourlyListing, chatId, action: 'accept', agreementId }, 409);
  await app(hourlyBuyer, '/api/payments/agreements', { listingId: hourlyListing, chatId, action: 'accept', agreementId });
  assert.equal((await get(hourlyBuyer, contextPath)).canPay, true);
  const hourly = await app(hourlyBuyer, '/api/payments/create-intent', { listingId: hourlyListing, chatId, agreementId });
  intents.add(hourly.paymentId);
  const hourlyIntent = await stripe.paymentIntents.retrieve(hourly.paymentId);
  assertOwnedIntent(hourlyIntent);
  assert.equal(hourlyIntent.amount, 200, 'Checkout uses the accepted total, not the 10 EUR hourly rate.');
  assert.equal(hourlyIntent.application_fee_amount, 10);
  await authorize(hourly.paymentId, hourlyBuyer);
  await verifyAuthorizationDeadline(hourly.paymentId, hourlyBuyer);
  const hourlyPayment = await confirmAndCapture(hourly.paymentId, hourlyBuyer, seller);
  await refundThroughApp(hourlyPayment, hourly.paymentId, hourlyBuyer, operator);
  pass('hourly proposal, other-party consent, agreed total, Stripe deadline, capture and refund');

  const retryBuyer = await createUser('cancel-buyer');
  const retryListing = await listing(seller, 'retry');
  const original = await app(retryBuyer, '/api/payments/create-intent', { listingId: retryListing });
  intents.add(original.paymentId);
  await authorize(original.paymentId, retryBuyer);
  await verifyAuthorizationDeadline(original.paymentId, retryBuyer);
  const originalRow = await payment(original.paymentId);
  await app(retryBuyer, '/api/orders/confirm', { paymentId: originalRow.id, expectedUserId: retryBuyer.id });
  await app(seller, '/api/orders/confirm', { paymentId: originalRow.id, expectedUserId: seller.id });
  const cancelBody = { paymentId: originalRow.id, expectedUserId: retryBuyer.id, action: 'request', expectedCancellationId: null, reason: 'Temporary verification: both parties agree to cancel.' };
  const requested = await app(retryBuyer, '/api/orders/cancel', cancelBody);
  assert.ok(requested.cancellation?.id);
  assert.equal((await stripe.paymentIntents.retrieve(original.paymentId)).status, 'requires_capture', 'A unilateral request must not release funds.');
  await app(seller, '/api/payments/capture', { paymentId: originalRow.id, expectedUserId: seller.id }, 409);
  await app(seller, '/api/orders/cancel', { paymentId: originalRow.id, expectedUserId: seller.id, action: 'accept', expectedCancellationId: requested.cancellation.id }, [200, 202]);
  await waitReleased(original.paymentId, retryBuyer);
  const replacement = await app(retryBuyer, '/api/payments/create-intent', { listingId: retryListing });
  intents.add(replacement.paymentId);
  assert.notEqual(replacement.paymentId, original.paymentId);
  const retried = await app(retryBuyer, '/api/payments/create-intent', { listingId: retryListing });
  assert.equal(retried.paymentId, replacement.paymentId);
  pass('mutual cancellation releases an authorized hold, reconciles, and retries with one replacement intent');

  const adminCancelBuyer = await createUser('admin-cancel-buyer');
  const adminCancelListing = await listing(seller, 'admin-cancel');
  const adminCancel = await app(adminCancelBuyer, '/api/payments/create-intent', { listingId: adminCancelListing });
  intents.add(adminCancel.paymentId);
  await authorize(adminCancel.paymentId, adminCancelBuyer);
  const adminCancelRow = await payment(adminCancel.paymentId);
  await app(operator, '/api/admin/payments/cancel', { paymentId: adminCancelRow.id, expectedUserId: operator.id, reason: 'Temporary verification: authorized support cancellation.' }, [200, 202]);
  await waitReleased(adminCancel.paymentId, adminCancelBuyer);
  pass('administrator cancellation releases the exact authorized test hold');
} catch (error) {
  console.error(`FAIL ${safeVerificationError(error)}; run ${marker}`);
  throw error;
} finally {
  const cleanupErrors = [];
  const clean = async (label, operation) => { try { return await operation(); } catch (error) { cleanupErrors.push(`${label}: ${safeVerificationError(error)}`); return null; } };
  const ownRows = async (table, columns, field, ids) => ids.length ? check(await admin.from(table).select(columns).in(field, ids), `${table} ownership`) : [];
  // Discover persisted intents even if an application response was lost. Every
  // selected row must belong to this run before any external cleanup mutation.
  const local = await clean('verify fixture ownership', async () => {
    for (const user of users) {
      const data = check(await admin.auth.admin.getUserById(user.id), 'check temporary user');
      assert.equal(data.user.email, user.email);
      assert.equal(data.user.app_metadata?.verification_run, marker);
      const rows = await ownRows('profiles', 'id,user_id', 'user_id', [user.id]);
      rows.forEach(profile => profileIds.add(profile.id));
    }
    const listingRows = await ownRows('listings', 'id,title,seller_id', 'id', listings);
    assert.equal(listingRows.length, listings.length);
    listingRows.forEach(row => assert.ok(row.title.startsWith(`${marker}-`) && profileIds.has(row.seller_id), 'Listing ownership changed; preserving fixtures.'));
    const paymentRows = await ownRows('payments', 'id,buyer_id,seller_id,stripe_payment_intent', 'listing_id', listings);
    const milestoneRows = await ownRows('milestones', 'id,buyer_id,seller_id', 'listing_id', listings);
    const agreementRows = await ownRows('service_price_agreements', 'id,buyer_id,seller_id', 'listing_id', listings);
    [...paymentRows, ...milestoneRows, ...agreementRows].forEach(row => assert.ok(profileIds.has(row.buyer_id) && profileIds.has(row.seller_id), 'A fixture has an outside transaction participant; preserving all data.'));
    const chatRows = await ownRows('chats', 'id', 'listing_id', listings);
    assert.ok(chatRows.every(row => chats.has(row.id)), 'An outside conversation references a fixture; preserving all data.');
    const participants = await ownRows('chat_participants', 'user_id', 'chat_id', [...chats]);
    assert.ok(participants.every(row => profileIds.has(row.user_id)), 'An outside participant joined a fixture.');
    const reviews = await ownRows('reviews', 'id', 'listing_id', listings);
    assert.equal(reviews.length, 0, 'Unexpected review history on a test fixture; preserving all data.');
    paymentRows.forEach(row => { if (row.stripe_payment_intent) intents.add(row.stripe_payment_intent); });
    return { paymentIds: paymentRows.map(row => row.id), milestoneIds: milestoneRows.map(row => row.id), agreementIds: agreementRows.map(row => row.id) };
  });
  if (cleanupErrors.length || !local) throw new Error(`Ownership verification failed; fixtures preserved (${marker}): ${cleanupErrors.join('; ')}`);
  // A lost create response can precede DB persistence. Find only test intents
  // whose listing and both parties are verified above. Never sweep by age alone.
  await clean('discover own Stripe intents', async () => {
    let scanned = 0;
    for await (const intent of stripe.paymentIntents.list({ created: { gte: started }, limit: 100 })) {
      if (++scanned > 1000) throw new Error('Too many concurrent test intents; manual review required.');
      if (!listings.includes(intent.metadata?.listing_id)) continue;
      assertOwnedIntent(intent);
      intents.add(intent.id);
    }
  });
  if (cleanupErrors.length) throw new Error(`Intent discovery uncertain; fixtures preserved (${marker}): ${cleanupErrors.join('; ')}`);
  // Settle only the exact intents created by this run, after rechecking test mode.
  for (const id of intents) await clean(`settle test intent ${id}`, async () => {
    const intent = await stripe.paymentIntents.retrieve(id, { expand: ['latest_charge'] });
    assertOwnedIntent(intent);
    if (intent.latest_charge) charges.add(typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge.id);
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
      if (!event.livemode && (intents.has(object.id) || intents.has(object.payment_intent) || charges.has(object.id) || charges.has(object.source_transaction))) eventIds.add(event.id);
    }
  });
  if (cleanupErrors.length) throw new Error(`Event collection failed; fixtures preserved (${marker}): ${cleanupErrors.join('; ')}`);
  // Delete only explicit verified fixture dependencies, in foreign-key order.
  // Stop at the first failure. Do not disable history protection or alter grants.
  const remove = async (table, field, ids) => {
    if (ids.length) check(await admin.from(table).delete().in(field, ids), `${table} cleanup`);
  };
  await clean('remove exact fixture dependencies', async () => {
    await remove('transactions', 'payment_id', local.paymentIds);
    await remove('disputes', 'payment_id', local.paymentIds);
    await remove('payment_audit_logs', 'payment_id', local.paymentIds);
    await remove('payment_audit_logs', 'listing_id', listings);
    await remove('order_cancellations', 'payment_id', local.paymentIds);
    await remove('payments', 'id', local.paymentIds);
    await remove('milestones', 'id', local.milestoneIds);
    await remove('service_price_agreements', 'id', local.agreementIds);
    await remove('messages', 'chat_id', [...chats]);
    await remove('chat_participants', 'chat_id', [...chats]);
    await remove('chats', 'id', [...chats]);
    await remove('listings', 'id', listings);
  });
  if (cleanupErrors.length) throw new Error(`Fixture cleanup stopped; remaining records preserved (${marker}): ${cleanupErrors.join('; ')}`);
  if (eventIds.size) await clean('remove own webhook markers', async () => check(await admin.from('webhook_events').delete().in('id', [...eventIds]), 'event cleanup'));
  for (const user of users) {
    await user.client.auth.signOut();
    await clean('remove temporary user', async () => check(await admin.auth.admin.deleteUser(user.id), 'user cleanup'));
  }
  if (cleanupErrors.length) throw new Error(`Cleanup needs attention (${marker}): ${cleanupErrors.join('; ')}`);
  console.log(`CLEANUP complete; ${passed.length} real Stripe test checks passed. Stripe test history is retained; no live money was used.`);
}
return passed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = verificationOptions(process.argv.slice(2));
    const config = verificationConfig(await verificationEnvironment(options));
    await verifyStripeTestPayments(config, options);
  } catch (error) {
    console.error(safeVerificationError(error));
    process.exitCode = 1;
  }
}
