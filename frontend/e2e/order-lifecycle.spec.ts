import { devices, expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { OrderDTO } from '../lib/orders/types';

const origin = 'http://127.0.0.1:3102';
const paymentId = '40000000-0000-4000-8000-000000000001';
const cancellationId = '40000000-0000-4000-8000-000000000002';
const listingId = '40000000-0000-4000-8000-000000000003';
const createdAt = '2026-10-26T12:00:00Z';
const artifactDirectory = process.env.NEEDS_E2E_ARTIFACT_DIR;
const accounts = {
  buyer: { userId: '10000000-0000-4000-8000-000000000021', profileId: '20000000-0000-4000-8000-000000000021', name: 'Order Buyer' },
  seller: { userId: '10000000-0000-4000-8000-000000000022', profileId: '20000000-0000-4000-8000-000000000022', name: 'Order Provider' },
};
type Role = keyof typeof accounts;
type Fixture = {
  expiresAt: string | null;
  cancellation: OrderDTO['cancellation'];
  pending: boolean;
  releasedAt: string | null;
  mutations: Record<string, unknown>[];
  reconciliations: Record<string, unknown>[];
  forbiddenMoneyCalls: string[];
};

function order(role: Role, fixture: Fixture): OrderDTO {
  const own = accounts[role];
  const proposed = fixture.cancellation?.status === 'proposed';
  const requester = fixture.cancellation?.requested_by === own.profileId;
  const active = !fixture.pending && !fixture.releasedAt && !proposed;
  return {
    id: paymentId, created_at: createdAt, status: fixture.releasedAt ? 'failed' : 'requires_capture', amount: 75, currency: 'eur', platform_fee: 3.75,
    payments_enabled: true, listing: { id: listingId, title: 'Agreed home care visit', thumbnail: null, available: true },
    buyer: { id: accounts.buyer.profileId, display_name: accounts.buyer.name, avatar_url: null },
    seller: { id: accounts.seller.profileId, display_name: accounts.seller.name, avatar_url: null },
    my_role: role, chat_id: null, milestone: null, buyer_confirmed: true, seller_confirmed: true,
    role_review_required: false, authorization_state: fixture.releasedAt ? 'settled' : 'authorized', capture_pending: false,
    authorization: { expires_at: fixture.expiresAt, last_checked_at: createdAt, provider_status: fixture.releasedAt ? 'canceled' : 'requires_capture', attention_required: false },
    cancellation: fixture.cancellation, cancel_pending: fixture.pending, stripe_canceled_at: fixture.releasedAt,
    complaint: null, disputes: [], refund: { succeeded_amount: 0, pending_amount: 0, failed: false }, review: null,
    actions: { can_confirm: false, can_capture: active, can_complain: false, can_review: false,
      can_request_cancel: active, can_accept_cancel: !!proposed && !requester,
      can_reject_cancel: !!proposed && !requester, can_withdraw_cancel: !!proposed && requester, can_reconcile: true },
  };
}

async function installFixture(page: Page, role: Role, fixture: Fixture) {
  const account = accounts[role];
  const user = { id: account.userId, aud: 'authenticated', role: 'authenticated', email: `${role}@example.test`, user_metadata: { fullName: account.name }, app_metadata: {}, created_at: createdAt };
  const profile = { id: account.profileId, user_id: account.userId, display_name: account.name, created_at: createdAt, reputation: 0, rating_count: 0, avatar_url: null };
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: account.userId, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'fixture-signature'].join('.');
  // External services are blocked; all financial endpoints in this journey are inert fixtures.
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  await page.routeWebSocket('wss://needs-e2e.invalid/**', socket => socket.close());
  await page.route('https://needs-e2e.invalid/**', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname === '/auth/v1/token') return route.fulfill({ json: { user, access_token: token, refresh_token: `fixture-${role}`, token_type: 'bearer', expires_in: 3600 } });
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user });
    if (url.pathname === '/rest/v1/profiles') return route.fulfill({ json: request.headers().accept?.includes('object+json') ? profile : [profile] });
    if (url.pathname === '/rest/v1/notifications') return route.fulfill({ json: [], headers: { 'content-range': '*/0' } });
    if (url.pathname === '/rest/v1/rpc/get_my_order') {
      expect(request.postDataJSON()).toEqual({ p_payment_id: paymentId, p_expected_user_id: account.userId });
      return route.fulfill({ json: order(role, fixture) });
    }
    throw new Error(`Unexpected backend request: ${request.method()} ${url.pathname}`);
  });
  await page.route('**/api/admin/check', route => route.fulfill({ status: 403, json: { error: 'Not an admin' } }));
  await page.route('**/api/csrf', route => route.fulfill({ json: { csrfToken: 'fixture-csrf' } }));
  await page.route('**/api/orders/cancel', route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    fixture.mutations.push({ ...body, actor: role });
    expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');
    expect(body).toMatchObject({ paymentId, expectedUserId: account.userId });
    if (body.action === 'request') {
      expect(fixture.cancellation).toBeNull(); expect(body.expectedCancellationId).toBeNull();
      expect(body.reason).toBe('The visit is no longer needed.');
      fixture.cancellation = { id: cancellationId, status: 'proposed', requested_by: account.profileId, reason: String(body.reason), requested_at: createdAt };
    } else if (body.action === 'accept') {
      expect(body.expectedCancellationId).toBe(cancellationId);
      expect(fixture.cancellation?.requested_by).not.toBe(account.profileId);
      fixture.cancellation = { ...fixture.cancellation!, status: 'accepted' }; fixture.pending = true;
    } else throw new Error(`Unexpected cancellation action: ${String(body.action)}`);
    return route.fulfill({ status: fixture.pending ? 202 : 200, json: order(role, fixture) });
  });
  await page.route('**/api/orders/reconcile', route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    fixture.reconciliations.push({ ...body, actor: role });
    expect(body).toEqual({ paymentId, expectedUserId: account.userId });
    expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');
    if (fixture.pending) {
      fixture.pending = false; fixture.releasedAt = new Date().toISOString();
      fixture.cancellation = { ...fixture.cancellation!, status: 'canceled' };
    }
    return route.fulfill({ json: order(role, fixture) });
  });
  for (const endpoint of ['/api/payments/capture', '/api/payments/create-intent', '/api/orders/confirm']) {
    await page.route(`**${endpoint}`, route => { fixture.forbiddenMoneyCalls.push(endpoint); return route.fulfill({ status: 500, json: { error: 'Unexpected money mutation in cancellation journey' } }); });
  }
}

async function signIn(page: Page, role: Role, greek = false) {
  await page.goto(`/login?redirectTo=${encodeURIComponent(`/dashboard/orders/${paymentId}`)}`);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email', { exact: true }).fill(`${role}@example.test`);
  await dialog.getByLabel('Password', { exact: true }).fill('Fixture-only-password-123!');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/orders/${paymentId}$`));
  if (greek) {
    await page.evaluate(() => localStorage.setItem('locale', 'el'));
    await page.context().addCookies([{ name: 'locale', value: 'el', url: origin }]);
    await page.reload();
  }
  await expect(page.getByRole('heading', { name: 'Agreed home care visit', exact: true })).toBeVisible();
}

test('participants cancel an authorized order and wait for verified Stripe release', async ({ page, browser }, testInfo) => {
  const fixture: Fixture = { expiresAt: new Date(Date.now() + 2 * 3600000).toISOString(), cancellation: null, pending: false, releasedAt: null, mutations: [], reconciliations: [], forbiddenMoneyCalls: [] };
  await installFixture(page, 'buyer', fixture); await signIn(page, 'buyer');
  await expect(page.locator(`time[datetime="${fixture.expiresAt}"]`)).toBeVisible();
  await expect(page.getByText('Less than 24 hours remain on this authorization.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Request cancellation', exact: true }).click();
  const request = page.getByRole('dialog', { name: 'Request cancellation of this order?', exact: true });
  await request.getByLabel('Reason for cancellation').fill('The visit is no longer needed.');
  await request.getByRole('button', { name: 'Request cancellation', exact: true }).click();
  await expect(page.getByText('Waiting for the other participant to respond. Completion and finalizing payment are paused.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept cancellation', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Finalize payment', exact: true })).toBeDisabled();

  const providerContext = await browser.newContext({ ...devices[testInfo.project.name === 'mobile-chromium' ? 'Pixel 7' : 'Desktop Chrome'], viewport: page.viewportSize() || undefined, baseURL: origin, serviceWorkers: 'block' });
  try {
    const provider = await providerContext.newPage();
    await installFixture(provider, 'seller', fixture); await signIn(provider, 'seller', true);
    await expect(provider.getByText('The visit is no longer needed.', { exact: true })).toBeVisible();
    await provider.getByRole('button', { name: 'Αποδοχή ακύρωσης', exact: true }).click();
    await provider.getByRole('dialog').getByRole('button', { name: 'Αποδοχή ακύρωσης', exact: true }).click();
    await expect(provider.getByText(/Το αίτημα αποδέσμευσης παραλήφθηκε/)).toBeVisible();
    await expect(provider.getByText(/Το Stripe επιβεβαίωσε την ακύρωση/)).toHaveCount(0);
    expect(fixture.pending).toBe(true); expect(fixture.releasedAt).toBeNull();
    await provider.getByRole('button', { name: 'Ανανέωση παραγγελιών', exact: true }).click();
    await expect(provider.getByText(/Το Stripe επιβεβαίωσε την ακύρωση/)).toBeVisible();
    await expect(provider.getByText(/Το αίτημα αποδέσμευσης παραλήφθηκε/)).toHaveCount(0);
    expect(fixture.reconciliations).toEqual([{ paymentId, expectedUserId: accounts.seller.userId, actor: 'seller' }]);
    if (artifactDirectory) await mkdir(artifactDirectory, { recursive: true });
    await provider.screenshot({ path: artifactDirectory ? path.join(artifactDirectory, `order-lifecycle-${testInfo.project.name}.png`) : testInfo.outputPath('order-lifecycle.png'), fullPage: true });
    expect(fixture.mutations.map(value => value.action)).toEqual(['request', 'accept']);
    expect(fixture.forbiddenMoneyCalls).toEqual([]);
  } finally { await providerContext.close(); }
});

test('an expired deadline disables capture without claiming release and refresh only reconciles', async ({ page }) => {
  const fixture: Fixture = { expiresAt: '2000-01-01T00:00:00Z', cancellation: null, pending: false, releasedAt: null, mutations: [], reconciliations: [], forbiddenMoneyCalls: [] };
  await installFixture(page, 'buyer', fixture); await signIn(page, 'buyer');
  await expect(page.getByText('Authorization deadline passed', { exact: true })).toBeVisible();
  await expect(page.getByText(/Expiry does not automatically charge the payer/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finalize payment', exact: true })).toBeDisabled();
  await expect(page.getByText('Authorization released', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh orders', exact: true }).click();
  await expect.poll(() => fixture.reconciliations.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Refresh orders', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Finalize payment', exact: true })).toBeDisabled();
  expect(fixture.mutations).toEqual([]); expect(fixture.forbiddenMoneyCalls).toEqual([]);
});
