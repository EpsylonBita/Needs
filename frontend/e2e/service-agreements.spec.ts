import { devices, expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const origin = 'http://127.0.0.1:3102';
const chatId = '30000000-0000-4000-8000-000000000010';
const listingId = '30000000-0000-4000-8000-000000000011';
const agreementId = '30000000-0000-4000-8000-000000000012';
const artifactDirectory = process.env.NEEDS_E2E_ARTIFACT_DIR;
const accounts = {
  provider: { userId: '10000000-0000-4000-8000-000000000010', profileId: '20000000-0000-4000-8000-000000000010', name: 'Care Provider' },
  buyer: { userId: '10000000-0000-4000-8000-000000000011', profileId: '20000000-0000-4000-8000-000000000011', name: 'Care Buyer' },
};
type Agreement = { id: string; status: 'proposed' | 'accepted'; amount: number; currency: 'eur'; proposedBy: string; acceptedBy: string | null; createdAt: string; checkoutStartedAt: string | null; stale: boolean };
type Fixture = { agreement: Agreement | null; mutations: Record<string, unknown>[]; checkouts: Record<string, unknown>[]; failNext: boolean };

async function installFixture(page: Page, role: keyof typeof accounts, fixture: Fixture) {
  const account = accounts[role];
  const other = accounts[role === 'buyer' ? 'provider' : 'buyer'];
  const user = { id: account.userId, aud: 'authenticated', role: 'authenticated', email: `${role}@example.test`, user_metadata: { fullName: account.name }, app_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
  const profile = { id: account.profileId, user_id: account.userId, display_name: account.name, stripe_account_id: 'acct_fixture', created_at: user.created_at, reputation: 0, rating_count: 0, avatar_url: null };
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: account.userId, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'fixture-signature'].join('.');
  // No external service receives requests, and every application API used here is mocked.
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  await page.routeWebSocket('wss://needs-e2e.invalid/**', socket => socket.close());
  await page.route('https://needs-e2e.invalid/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/auth/v1/token') return route.fulfill({ json: { user, access_token: token, refresh_token: `fixture-${role}`, token_type: 'bearer', expires_in: 3600 } });
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user });
    if (url.pathname === '/rest/v1/profiles') return route.fulfill({ json: request.headers().accept?.includes('object+json') ? profile : [profile] });
    if (url.pathname === '/rest/v1/notifications') return route.fulfill({ json: [], headers: { 'content-range': '*/0' } });
    if (url.pathname === '/rest/v1/rpc/get_my_chats') return route.fulfill({ json: [{
      chat_id: chatId, title: 'Home care at 10€/hour', type: 'direct', listing_id: listingId, created_at: user.created_at,
      participants: [{ profile_id: other.profileId, display_name: other.name, avatar_url: null, left_at: null }],
      last_message: null, unread_count: 0, last_read_at: null, left_at: null, can_send: true, other_left: false,
    }] });
    if (url.pathname === '/rest/v1/rpc/get_chat_messages') return route.fulfill({ json: [] });
    throw new Error(`Unexpected backend request: ${request.method()} ${url.pathname}`);
  });
  await page.route('**/api/admin/check', route => route.fulfill({ status: 403, json: { error: 'Not an admin' } }));
  await page.route('**/api/search?**', route => route.fulfill({ json: { listings: [], pagination: { total: 0, page: 1, totalPages: 0 } } }));
  await page.route('**/api/csrf', route => route.fulfill({ json: { csrfToken: 'fixture-csrf' } }));
  await page.route('**/api/payments/context?**', route => {
    const agreement = fixture.agreement;
    const pendingOther = agreement?.status === 'proposed' && agreement.proposedBy !== account.profileId;
    return route.fulfill({ json: {
      listingId, chatId, buyerId: accounts.buyer.profileId, sellerId: accounts.provider.profileId, currentProfileId: account.profileId,
      isFree: false, canPay: role === 'buyer' && agreement?.status === 'accepted' && !agreement.stale,
      sellerOnboarded: true, paymentsEnabled: true, milestonesEnabled: true, title: 'Home care', amount: 10, subCategory: 'I can',
      requiresAgreement: true, priceUnit: 'hour', priceNeedsConfirmation: false, serviceAgreementEligible: true, agreement,
      canProposeAgreement: !agreement?.checkoutStartedAt, canAcceptAgreement: !!pendingOther, canRejectAgreement: !!pendingOther,
      canWithdrawAgreement: !!agreement && !agreement.checkoutStartedAt && (agreement.proposedBy === account.profileId || agreement.status === 'accepted'),
    } });
  });
  await page.route('**/api/payments/agreements', route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    fixture.mutations.push({ ...body, actor: role });
    expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');
    expect(body).toMatchObject({ listingId, chatId });
    if (fixture.failNext) { fixture.failNext = false; return route.fulfill({ status: 409, json: { error: 'The agreement changed. Refresh the conversation and try again.' } }); }
    if (body.action === 'propose') {
      expect(body.expectedAgreementId).toBe(fixture.agreement?.id || null);
      fixture.agreement = { id: agreementId, status: 'proposed', amount: Number(body.amount), currency: 'eur', proposedBy: account.profileId, acceptedBy: null, createdAt: '2026-10-26T12:00:00Z', checkoutStartedAt: null, stale: false };
    } else if (body.action === 'accept') {
      expect(fixture.agreement?.proposedBy).not.toBe(account.profileId);
      expect(body.agreementId).toBe(agreementId);
      fixture.agreement = { ...fixture.agreement!, status: 'accepted', acceptedBy: account.profileId };
    } else throw new Error(`Unexpected agreement action: ${String(body.action)}`);
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/payments/create-intent', route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    fixture.checkouts.push(body);
    expect(role).toBe('buyer');
    expect(fixture.agreement?.status).toBe('accepted');
    expect(body).toEqual({ listingId, chatId, agreementId });
    return route.fulfill({ json: { clientSecret: 'pi_fixture_secret_test', totalAmount: fixture.agreement!.amount, platformFee: 3.75 } });
  });
  // Exercise the real React Elements integration with an inert local SDK fixture.
  await page.addInitScript(() => {
    const browser = window as unknown as { Stripe: () => unknown; __stripeConfirmCalls: number };
    browser.__stripeConfirmCalls = 0;
    browser.Stripe = () => ({
      elements: () => ({
        create: () => ({
          on() {}, off() {}, update() {}, destroy() {}, unmount() {},
          mount(target: string | HTMLElement) {
            const host = typeof target === 'string' ? document.querySelector(target) : target;
            if (host) { const label = document.createElement('p'); label.textContent = 'Payment details (test fixture)'; host.appendChild(label); }
          },
        }), getElement: () => null, update() {},
      }),
      createToken() {}, createPaymentMethod() {}, confirmCardPayment() {}, registerAppInfo() {}, _registerWrapper() {},
      confirmPayment() { browser.__stripeConfirmCalls += 1; throw new Error('Real payment confirmation is forbidden in this fixture'); },
    });
  });
}

async function openConversation(page: Page, role: keyof typeof accounts, greek = false) {
  await page.goto(`/login?redirectTo=${encodeURIComponent(`/chat?chat=${chatId}`)}`);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email', { exact: true }).fill(`${role}@example.test`);
  await dialog.getByLabel('Password', { exact: true }).fill('Fixture-only-password-123!');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/chat\\?chat=${chatId}$`));
  if (greek) {
    await page.evaluate(() => localStorage.setItem('locale', 'el'));
    await page.context().addCookies([{ name: 'locale', value: 'el', url: origin }]);
    await page.reload();
  }
  await page.locator('summary').filter({ hasText: greek ? 'Αγγελία και συμφωνία' : 'Listing & agreement' }).click();
}

test('provider proposes a total, buyer accepts and checkout uses the agreed amount', async ({ page, browser }, testInfo) => {
  const fixture: Fixture = { agreement: null, mutations: [], checkouts: [], failNext: false };
  await installFixture(page, 'provider', fixture);
  await openConversation(page, 'provider');
  await page.getByRole('button', { name: 'Propose a total', exact: true }).click();
  await page.getByLabel('Total amount (€)', { exact: true }).fill('75,00');
  await page.getByRole('button', { name: 'Send proposal', exact: true }).click();
  await expect(page.getByText('Waiting for the other person to accept your proposal.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept total', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Pay €75/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Milestone', exact: true })).toHaveCount(0);
  expect(fixture.mutations[0]).toMatchObject({ action: 'propose', amount: 75, expectedAgreementId: null, actor: 'provider' });

  const buyerContext = await browser.newContext({ ...devices[testInfo.project.name === 'mobile-chromium' ? 'Pixel 7' : 'Desktop Chrome'], viewport: page.viewportSize() || undefined, baseURL: origin, serviceWorkers: 'block' });
  try {
    const buyer = await buyerContext.newPage();
    await installFixture(buyer, 'buyer', fixture);
    await openConversation(buyer, 'buyer', true);
    await expect(buyer.getByRole('link', { name: /Πληρωμή 75/ })).toHaveCount(0);
    await buyer.getByRole('button', { name: 'Αποδοχή ποσού', exact: true }).click();
    const pay = buyer.getByRole('link', { name: /Πληρωμή 75,00/ });
    await expect(pay).toHaveAttribute('href', `/payments/checkout/${listingId}?chatId=${chatId}&agreementId=${agreementId}`);
    await expect(buyer.getByRole('button', { name: 'Προσθήκη σταδίου', exact: true })).toHaveCount(0);
    await pay.scrollIntoViewIfNeeded();
    if (artifactDirectory) await mkdir(artifactDirectory, { recursive: true });
    await buyer.screenshot({ path: artifactDirectory ? path.join(artifactDirectory, `service-agreement-${testInfo.project.name}.png`) : testInfo.outputPath('service-agreement.png'), fullPage: true });
    await pay.click();
    await expect(buyer).toHaveURL(new RegExp(`/payments/checkout/${listingId}\\?chatId=${chatId}&agreementId=${agreementId}$`));
    await expect(buyer.getByText('Συμφωνημένο συνολικό ποσό', { exact: true })).toBeVisible();
    await expect(buyer.getByText(/75,00.*€/)).toBeVisible();
    await expect(buyer.getByText('Payment details (test fixture)', { exact: true })).toBeVisible();
    expect(fixture.checkouts).toEqual([{ listingId, chatId, agreementId }]);
    expect(await buyer.evaluate(() => (window as unknown as { __stripeConfirmCalls: number }).__stripeConfirmCalls)).toBe(0);
  } finally { await buyerContext.close(); }
});

test('agreement conflict preserves the proposed amount and can be retried after refresh', async ({ page }) => {
  const fixture: Fixture = { agreement: null, mutations: [], checkouts: [], failNext: true };
  await installFixture(page, 'provider', fixture);
  await openConversation(page, 'provider');
  await page.getByRole('button', { name: 'Propose a total', exact: true }).click();
  await page.getByLabel('Total amount (€)', { exact: true }).fill('75,00');
  await page.getByRole('button', { name: 'Send proposal', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'The agreement changed.' })).toBeVisible();
  await expect(page.getByLabel('Total amount (€)', { exact: true })).toHaveValue('75,00');
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send proposal', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Send proposal', exact: true }).click();
  await expect(page.getByText('Waiting for the other person to accept your proposal.', { exact: true })).toBeVisible();
  expect(fixture.mutations).toHaveLength(2);
  expect(fixture.checkouts).toHaveLength(0);
});
