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
  const menu = page.getByRole('button', { name: 'Open menu', exact: true });
  // Wait for streamed navigation before deciding which responsive entry is visible.
  await expect(desktop.or(menu)).toBeVisible();
  if (await desktop.isVisible()) await desktop.click();
  else { await menu.click(); await page.getByRole('button', { name: 'New listing', exact: true }).click(); }
  const login = page.getByRole('dialog');
  await login.getByLabel('Email', { exact: true }).fill('listing@example.test');
  await login.getByLabel('Password', { exact: true }).fill('Local-fixture-only-123!');
  await login.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New listing' })).toBeVisible();
  expect(await page.getByText('Login successful', { exact: true }).count()).toBe(0);
  expect(await page.getByText('You have been logged in successfully.', { exact: true }).count()).toBe(0);
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

test('extracts the reported Greek phone discount and hourly care service', async ({ page }) => {
  const backend = await fixtureBackend(page);
  await signedInListing(page);
  await page.getByRole('button', { name: 'Skip photos', exact: true }).click();
  const note = page.getByLabel('What would you like to list?', { exact: true });
  await note.fill('πωλειται κινητο smasung s25 ultra ελαχειστα χρησιμοποιημενοαπο 220 στα 130');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Samsung μεταχειρισμένο s25 ultra');
  await expect(page.getByLabel('Category', { exact: true })).toHaveValue('Items');
  await expect(page.getByLabel('Listing type', { exact: true })).toHaveValue('Sell');
  await expect(page.getByLabel('Price (€)', { exact: true })).toHaveValue('130€');
  await expect(page.getByRole('button', { name: '130€', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await note.fill('μπορω να αναλαβω  ηλικιωμενους κατοικον με 10 ευρω την ωρα');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Φροντίδα ηλικιωμένων κατ’ οίκον');
  await expect(page.getByLabel('Category', { exact: true })).toHaveValue('Services');
  await expect(page.getByLabel('Listing type', { exact: true })).toHaveValue('I can');
  await expect(page.getByLabel('Price (€)', { exact: true })).toHaveValue('10€');
  await expect(page.getByText('Per hour, as stated in your description. Agree the total before payment.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '10€/hour', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '130€', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Location', exact: true }).fill('Athens');
  await page.getByRole('option', { name: 'Athens, Attica, Greece', exact: true }).click();
  await page.getByLabel('Price (€)', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
  await expect(page.getByText('Enter a price greater than 0 for this rate.', { exact: true })).toBeVisible();
  expect(backend.writes).toHaveLength(0);
  await page.getByLabel('Price (€)', { exact: true }).fill('12');
  await expect(page.getByRole('button', { name: '12€/hour', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Your listing is published!' });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole('link', { name: 'View listing' })).toHaveAttribute('href', `/listings/${listingId}`);
  await expect(confirmation.getByRole('button', { name: 'Publish listing' })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('needs.pending-publication'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('needs.auth-continuation'))).toBeNull();
  await confirmation.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  expect(backend.writes).toHaveLength(1);
  expect(backend.writes[0]).toMatchObject({ price: 12, description: 'μπορω να αναλαβω  ηλικιωμενους κατοικον με 10 ευρω την ωρα' });
  expect(backend.tagWrites.flat().map(value => value.tag)).toContain('12€/hour');
});

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
  const confirmation = page.getByRole('dialog', { name: 'Your listing is published!' });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole('link', { name: 'View listing' })).toHaveAttribute('href', `/listings/${listingId}`);
  await expect(confirmation.getByRole('button', { name: 'Publish listing' })).toHaveCount(0);
  await confirmation.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
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
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('needs.pending-publication') || 'null')?.accountId)).toBe(userId);
  await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Your listing is published!' });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole('link', { name: 'View listing' })).toHaveAttribute('href', `/listings/${listingId}`);
  await expect(confirmation.getByRole('button', { name: 'Publish listing' })).toHaveCount(0);
  await confirmation.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  expect(backend.writes).toHaveLength(2);
  expect(backend.writes[1].contact_number).toBe('');
});

test('price marker updates without transitions when reduced motion is enabled', async ({ page }) => {
  const backend = await fixtureBackend(page);
  await page.route('**/api/csrf', route => route.fulfill({ json: { csrfToken: 'pricing-fixture-csrf', expiresIn: 3600 } }));
  await page.route('**/api/pricing/guidance', route => route.fulfill({ json: {
    status: 'ready', range: { low: 90, median: 110, high: 130 }, sampleSize: 6,
    basis: 'needs_asking', unit: 'item', retailRange: null,
  } }));
  await signedInListing(page);
  await fillDraft(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Check price', exact: true }).click();
  const meter = page.getByRole('meter', { name: 'Price comparison' });
  await expect(meter).toBeVisible();
  await page.getByLabel('Price (€)', { exact: true }).fill('200');
  await expect(meter).toHaveAttribute('aria-valuenow', '4');
  const marker = meter.locator('svg');
  await expect(marker).toHaveCSS('transition-property', 'none');
  expect(await marker.evaluate(element => element.getAnimations().length)).toBe(0);
  expect(backend.writes).toHaveLength(0);
});
