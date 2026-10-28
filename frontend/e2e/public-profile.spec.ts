import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const userId = '11000000-0000-4000-8000-000000000001';
const profileId = '22000000-0000-4000-8000-000000000001';
const listingId = '33000000-0000-4000-8000-000000000001';
const profile = {
  id: profileId, user_id: userId, display_name: 'Maria Papadopoulou', title: 'Music teacher',
  bio: 'Piano lessons in Athens.', location: 'Athens', created_at: '2026-01-01T12:00:00Z',
  reputation: 0, rating_count: 0, avatar_url: null,
};

async function fixtures(page: Page) {
  const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'profile@example.test',
    user_metadata: { fullName: profile.display_name }, app_metadata: {}, created_at: profile.created_at };
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: userId, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'fixture-signature'].join('.');
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:3102' ? route.continue() : route.abort('blockedbyclient'));
  await page.route('**/test-fixture-listing.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#e8dfd5"/><circle cx="300" cy="200" r="100" fill="#c49b72"/><rect x="280" y="60" width="40" height="260" rx="12" fill="#8d6549"/></svg>' }));
  await page.route('https://needs-e2e.invalid/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/auth/v1/token') return route.fulfill({ json: { user, access_token: token, refresh_token: 'profile-fixture-refresh', token_type: 'bearer', expires_in: 3600 } });
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user });
    // The signed-in navbar requests an unread count without fetching notification bodies.
    if (url.pathname === '/rest/v1/notifications' && request.method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': '*/0' } });
    expect(request.method()).toBe('GET');
    if (url.pathname === '/rest/v1/profiles') return route.fulfill({ json: request.headers().accept?.includes('object+json') ? profile : [profile] });
    if (url.pathname === '/rest/v1/listings') {
      expect(url.searchParams.get('status')).toBe('eq.active');
      expect(url.searchParams.get('moderation_suspended')).toBe('eq.false');
      return route.fulfill({ json: [{ id: listingId, title: 'Acoustic guitar', description: 'A guitar looking for a new home.', main_category: 'Items', sub_category: 'Free', price: 0, status: 'active', seller_id: profileId, address: { label: 'Athens' }, listing_images: [{ url: '/test-fixture-listing.svg', main: true }] }] });
    }
    if (['/rest/v1/reviews', '/rest/v1/payments', '/rest/v1/notifications'].includes(url.pathname)) return route.fulfill({ json: [], headers: { 'content-range': '*/0' } });
    throw new Error(`Unexpected backend request: ${request.method()} ${url.pathname}`);
  });
  await page.routeWebSocket('wss://needs-e2e.invalid/**', socket => socket.close());
  await page.route('**/api/admin/check', route => route.fulfill({ status: 403, json: { error: 'Not an admin' } }));
}

for (const locale of ['en', 'el'] as const) {
  test(`public profile shows images, neutral history and no management for a visitor (${locale})`, async ({ page, context }, testInfo) => {
    await fixtures(page);
    await context.addCookies([{ name: 'locale', value: locale, domain: '127.0.0.1', path: '/' }]);
    await page.goto(`/profile/${profileId}`);
    await expect(page.getByRole('heading', { name: 'Maria Papadopoulou' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Acoustic guitar/ })).toBeVisible();
    await expect(page.getByText(locale === 'el' ? 'Χωρίς αξιολογήσεις' : 'No reviews', { exact: true })).toBeVisible();
    await expect(page.getByText(locale === 'el' ? 'Διαθέσιμη' : 'Available', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: locale === 'el' ? 'Πίνακας ελέγχου' : 'Dashboard', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Acoustic guitar/ }).locator('img')).toHaveJSProperty('naturalWidth', 600);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await mkdir('../output/playwright/final-verification', { recursive: true });
    await page.evaluate(async () => { await document.fonts.ready; window.scrollTo({ top: 0, behavior: 'instant' }); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    await page.screenshot({ path: `../output/playwright/final-verification/public-profile-${testInfo.project.name}-${locale}.png`, fullPage: true });
  });
}

test('public profile gives its signed-in owner access to management', async ({ page }) => {
  await fixtures(page);
  await page.goto(`/login?redirectTo=${encodeURIComponent(`/profile/${profileId}`)}`);
  const login = page.getByRole('dialog');
  await login.getByLabel('Email', { exact: true }).fill('profile@example.test');
  await login.getByLabel('Password', { exact: true }).fill('Local-fixture-only-123!');
  await login.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(`/profile/${profileId}`);
  await expect(page.getByRole('heading', { name: 'Maria Papadopoulou' })).toBeVisible();
  await expect(page.locator('main').getByRole('link', { name: 'Dashboard', exact: true })).toHaveAttribute('href', '/dashboard');
  await expect(page.getByRole('button', { name: 'Submit Review' })).toHaveCount(0);
});
