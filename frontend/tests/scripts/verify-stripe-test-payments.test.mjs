import assert from 'node:assert/strict';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertOwnTestIntent, safeVerificationError, verificationConfig,
  verificationEnvironment, verificationOptions,
} from '../../scripts/verify-stripe-test-payments.mjs';

const environment = () => ({
  STRIPE_SECRET_KEY: 'sk_test_offline_fixture',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_offline_fixture',
  STRIPE_WEBHOOK_SECRET: 'whsec_offline_fixture',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3002',
  NEXT_PUBLIC_SUPABASE_URL: 'https://qczrqxmewjsydrrvjdil.supabase.co',
  SUPABASE_TEST_EXPECTED_PROJECT_REF: 'qczrqxmewjsydrrvjdil',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'offline-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'offline-service',
  STRIPE_TEST_EXPECTED_PLATFORM_ACCOUNT: 'acct_expected',
  STRIPE_TEST_CONNECTED_ACCOUNT: 'acct_disposable',
});

test('requires explicit write opt-in and rejects ambiguous environment selectors', () => {
  assert.throws(() => verificationOptions([]), /Opt in/);
  assert.throws(() => verificationOptions(['--allow-test-payments', '--env-file']), /requires a path/);
  assert.throws(() => verificationOptions(['--allow-test-payments', '--env-file', '--no-env-file']), /requires a path/);
  assert.throws(() => verificationOptions(['--allow-test-payments', '--env-file', 'test.env', '--no-env-file']), /only one/);
  assert.throws(() => verificationOptions(['--allow-test-payments', '--unknown']), /Unknown/);
  assert.deepEqual(verificationOptions(['--allow-test-payments']), { envFile: '.env.local', includeMilestones: false });
  assert.deepEqual(verificationOptions(['--allow-test-payments', '--no-env-file', '--include-milestones']), { envFile: null, includeMilestones: true });
});

test('separate env-file preserves inherited overrides, source bytes and process environment', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'needs-stripe-offline-'));
  const file = join(directory, 'verification.env');
  const contents = 'STRIPE_SECRET_KEY=sk_test_file\nNEXT_PUBLIC_APP_URL=http://127.0.0.1:3999\nEMPTY=file-value\n';
  const inherited = Object.freeze({ STRIPE_SECRET_KEY: 'sk_test_inherited', EMPTY: '' });
  const before = { ...process.env };
  try {
    await writeFile(file, contents);
    const result = await verificationEnvironment({ envFile: file }, inherited);
    assert.equal(result.STRIPE_SECRET_KEY, 'sk_test_inherited');
    assert.equal(result.NEXT_PUBLIC_APP_URL, 'http://127.0.0.1:3999');
    assert.equal(result.EMPTY, '');
    assert.equal(await readFile(file, 'utf8'), contents);
    assert.deepEqual({ ...process.env }, before);
  } finally {
    await unlink(file);
    await rmdir(directory);
  }
});

test('environment-only mode reads no default file and returns an independent copy', async () => {
  const inherited = { STRIPE_SECRET_KEY: 'sk_test_inherited' };
  const result = await verificationEnvironment({ envFile: null }, inherited);
  assert.deepEqual(result, inherited);
  assert.notEqual(result, inherited);
});

test('requires a specific expected platform and separate connected seller', () => {
  assert.equal(verificationConfig(environment()).platformId, 'acct_expected');
  assert.throws(() => verificationConfig({ ...environment(), STRIPE_TEST_EXPECTED_PLATFORM_ACCOUNT: '' }), /EXPECTED_PLATFORM/);
  assert.throws(() => verificationConfig({ ...environment(), STRIPE_TEST_CONNECTED_ACCOUNT: 'acct_expected' }), /distinct/);
  assert.throws(() => verificationConfig({ ...environment(), STRIPE_TEST_CONNECTED_ACCOUNT: '' }), /distinct/);
});

test('rejects live keys without putting their values in the diagnostic', () => {
  for (const [key, value] of [['STRIPE_SECRET_KEY', 'sk_live_do_not_print'], ['STRIPE_SECRET_KEY', 'rkcs_live_do_not_print'], ['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_live_do_not_print']]) {
    try {
      verificationConfig({ ...environment(), [key]: value });
      assert.fail('Live credentials must be rejected.');
    } catch (error) {
      assert.ok(!String(error).includes(value));
      assert.match(String(error), /test-mode/);
    }
  }
});

test('accepts short-lived sandbox restricted test keys, without relaxing account selection', () => {
  assert.equal(verificationConfig({ ...environment(), STRIPE_SECRET_KEY: 'rkcs_test_offline_fixture' }).platformId, 'acct_expected');
  assert.throws(() => verificationConfig({ ...environment(), STRIPE_SECRET_KEY: 'rkcs_test_offline_fixture', STRIPE_TEST_EXPECTED_PLATFORM_ACCOUNT: '' }), /EXPECTED_PLATFORM/);
});

test('only local origins are allowed; reject redirects, credentials and URL payloads', () => {
  for (const origin of ['https://needs.example', 'http://127.0.0.1.evil.example', 'http://user:pass@127.0.0.1:3002', 'http://localhost/path', 'http://localhost/?target=prod', 'http://localhost/#prod']) {
    assert.throws(() => verificationConfig({ ...environment(), NEXT_PUBLIC_APP_URL: origin }), /local HTTP origin/);
  }
});

test('database URL must exactly match the explicitly selected project', () => {
  for (const url of ['https://aaaaaaaaaaaaaaaaaaaa.supabase.co', 'http://qczrqxmewjsydrrvjdil.supabase.co', 'https://qczrqxmewjsydrrvjdil.supabase.co.evil.example', 'https://qczrqxmewjsydrrvjdil.supabase.co/path']) {
    assert.throws(() => verificationConfig({ ...environment(), NEXT_PUBLIC_SUPABASE_URL: url }), /Unexpected Supabase/);
  }
  assert.throws(() => verificationConfig({ ...environment(), SUPABASE_TEST_EXPECTED_PROJECT_REF: '' }), /EXPECTED_PROJECT/);
});

const scope = { listingIds: new Set(['listing-own']), profileIds: new Set(['buyer-own', 'seller-own']), connectedId: 'acct_disposable' };
const ownIntent = () => ({ livemode: false, metadata: { listing_id: 'listing-own', buyer_profile_id: 'buyer-own', seller_profile_id: 'seller-own' }, transfer_data: { destination: 'acct_disposable' }, capture_method: 'manual', currency: 'eur' });

test('settlement guard requires owned listing, both parties, manual EUR intent and destination', () => {
  assert.doesNotThrow(() => assertOwnTestIntent(ownIntent(), scope));
  assert.doesNotThrow(() => assertOwnTestIntent({ ...ownIntent(), transfer_data: { destination: { id: 'acct_disposable' } } }, scope));
  for (const altered of [
    { livemode: true }, { currency: 'usd' }, { capture_method: 'automatic' },
    { metadata: { ...ownIntent().metadata, listing_id: 'outside' } },
    { metadata: { ...ownIntent().metadata, buyer_profile_id: 'outside' } },
    { metadata: { ...ownIntent().metadata, seller_profile_id: 'outside' } },
    { transfer_data: { destination: 'acct_other' } }, { metadata: {} },
  ]) assert.throws(() => assertOwnTestIntent({ ...ownIntent(), ...altered }, scope));
});

test('failure output redacts credentials even if a provider includes them in its message', () => {
  const result = safeVerificationError(new Error('sk_live_sensitive rk_test_sensitive rkcs_test_sensitive rkcs_live_sensitive pk_test_sensitive whsec_sensitive eyJabc.def.ghi'));
  assert.ok(!result.includes('sensitive'));
  assert.ok(!result.includes('eyJ'));
  assert.match(result, /Stripe key/);
  assert.match(result, /webhook secret/);
  assert.match(result, /token/);
});
