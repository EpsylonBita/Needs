import { expect, test, type Page } from '@playwright/test';

const userId = '10000000-0000-4000-8000-000000000001';
const profileId = '20000000-0000-4000-8000-000000000001';
const listingId = '30000000-0000-4000-8000-000000000001';
const fixtureUser = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'listing@example.test',
  user_metadata: { fullName: 'Listing Tester', phoneNumber: '+306991234567' }, app_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const fixtureProfile = { id: profileId, user_id: userId, display_name: 'Listing Tester', stripe_account_id: 'acct_fixture',
  created_at: '2026-01-01T00:00:00Z', reputation: 0, rating_count: 0, avatar_url: null };

async function fixtureBackend(page: Page, failFirstSave = false) {
  // All unmatched external HTTP traffic is blocked before loading the app.
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:3102' ? route.continue() : route.abort('blockedbyclient'));
  await page.route('https://api.mapbox.com/styles/**', route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await page.route('https://events.mapbox.com/**', route => route.fulfill({ status: 204 }));
  const writes: Record<string, unknown>[] = [];
  const tagWrites: { tag: string }[][] = [];
  let attemptedSave = false;
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: userId, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'fixture-signature'].join('.');
  await page.route('https://needs-e2e.invalid/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/auth/v1/token') return route.fulfill({ json: { user: fixtureUser, access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600 } });
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: fixtureUser });
    if (url.pathname === '/rest/v1/profiles') return route.fulfill({ json: request.headers().accept?.includes('object+json') ? fixtureProfile : [fixtureProfile] });
    if (url.pathname === '/rest/v1/notifications') return route.fulfill({ json: [], headers: { 'content-range': '*/0' } });
    if (url.pathname === '/rest/v1/listings' && request.method() === 'POST') {
      writes.push(request.postDataJSON());
      if (failFirstSave && !attemptedSave) { attemptedSave = true; return route.fulfill({ status: 503, json: { message: 'Temporary save failure' } }); }
      return route.fulfill({ status: 201, json: { id: listingId } });
    }
    if (url.pathname === '/rest/v1/listing_tags' && request.method() === 'POST') {
      tagWrites.push(request.postDataJSON());
      return route.fulfill({ status: 201, json: [] });
    }
    throw new Error(`Unexpected backend request: ${request.method()} ${url.pathname}`);
  });
  await page.routeWebSocket('wss://needs-e2e.invalid/**', socket => socket.close());
  await page.route('**/api/admin/check', route => route.fulfill({ status: 403, json: { error: 'Not an admin' } }));
  await page.route('**/api/search?**', route => route.fulfill({ json: { listings: [], pagination: { total: 0, page: 1, limit: 20, totalPages: 0 }, locationApplied: false } }));
  await page.route('https://api.mapbox.com/geocoding/v5/**', route => route.fulfill({ json: { features: [
    { id: 'place.athens', place_type: ['place'], text: 'Athens', place_name: 'Athens, Attica, Greece', center: [23.72, 37.98] },
  ] } }));
  return { writes, tagWrites };
}

async function signedInListing(page: Page) {
  await page.goto('/');
  const desktop = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'New listing', exact: true });
  if (await desktop.isVisible()) await desktop.click();
  else { await page.getByRole('button', { name: 'Open menu', exact: true }).click(); await page.getByRole('button', { name: 'New listing', exact: true }).click(); }
  const login = page.getByRole('dialog');
  await login.getByLabel('Email', { exact: true }).fill('listing@example.test');
  await login.getByLabel('Password', { exact: true }).fill('Local-fixture-only-123!');
  await login.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New listing' })).toBeVisible();
}

async function fillDraft(page: Page) {
  await page.getByRole('button', { name: 'Skip photos', exact: true }).click();
  await page.getByLabel('What would you like to list?', { exact: true }).fill('Selling a used Trek bicycle in good condition for 120€');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Trek used');
  await expect(page.getByLabel('Price (€)', { exact: true })).toHaveValue('120€');
  await expect(page.getByLabel('Phone (optional)', { exact: true })).toHaveValue('+306991234567');
  await page.getByRole('combobox', { name: 'Location', exact: true }).fill('Athens');
  await page.getByRole('option', { name: 'Athens, Attica, Greece', exact: true }).click();
}

test('sign in, optional photo preview, smart draft and successful publication', async ({ page }) => {
  const backend = await fixtureBackend(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signedInListing(page);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1EAAAAASUVORK5CYII=', 'base64');
  await page.getByLabel('Photos from device', { exact: true }).setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByAltText('Listing photo 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove photo 1', exact: true }).click();
  await expect(page.getByAltText('Listing photo 1', { exact: true })).toHaveCount(0);
  await fillDraft(page);
  await page.getByLabel('Price (€)', { exact: true }).fill('100');
  await expect(page.getByRole('button', { name: '100€', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '120€', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New listing' })).toHaveCount(0);
  expect(backend.writes).toHaveLength(1);
  expect(backend.writes[0]).toMatchObject({ title: 'Trek used', price: 100, contact_number: '+306991234567', address: { label: 'Athens, Attica, Greece' } });
  expect(backend.tagWrites.flat().map(value => value.tag)).toEqual(expect.arrayContaining(['trek', 'used', 'Athens', '100€']));
  expect(errors).toEqual([]);
});

test('failed save preserves the draft and a cleared phone through retry', async ({ page }) => {
  const backend = await fixtureBackend(page, true);
  await signedInListing(page);
  await fillDraft(page);
  await page.getByLabel('Phone (optional)', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Failed to create ad' })).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Trek used');
  await expect(page.getByLabel('Phone (optional)', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New listing' })).toHaveCount(0);
  expect(backend.writes).toHaveLength(2);
  expect(backend.writes[1].contact_number).toBe('');
});
