import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const listing = {
  id: 'e1111111-1111-4111-8111-111111111111', title: 'Acoustic guitar · verification fixture', description: 'Public test listing for local read-only verification.',
  price: 85, main_category: 'Items', sub_category: 'Sell', seller_id: 'e2222222-2222-4222-8222-222222222222',
  sellerName: 'NEEDS verification fixture', sellerReviewCount: 0, coordinates: [23.7275, 37.9838], address: { label: 'Athens, Greece' }, listing_images: [],
};

test('final build uses real Mapbox style and geocoding, preserving area/radius through listing return', async ({ page, browser }, info) => {
  const evidenceDir = '../output/playwright/final-verification';
  await mkdir(evidenceDir, { recursive: true });
  const provider: Array<{ kind: string; status: number }> = [];
  const searchQueries: Array<Record<string, string>> = [];
  const pageErrors: string[] = [];
  // Do not retain traces, headers, tokens, credential-bearing URLs or raw console messages.
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.hostname !== 'api.mapbox.com') return;
    const kind = url.pathname.startsWith('/geocoding/') ? 'geocoding' : url.pathname.startsWith('/styles/') ? 'style-or-sprite' : url.pathname.includes('/fonts/') ? 'glyphs' : url.pathname.includes('/v4/') ? 'tiles' : 'mapbox-resource';
    provider.push({ kind, status: response.status() });
  });
  page.on('pageerror', () => pageErrors.push('Uncaught browser error'));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:3102') return route.continue();
    // Real provider reads only; suppress analytics/session writes and every unrelated host.
    if (url.hostname === 'api.mapbox.com' && route.request().method() === 'GET') return route.continue();
    return route.abort('blockedbyclient');
  });
  await page.route('**/api/search?**', route => {
    const params = new URL(route.request().url()).searchParams;
    searchQueries.push(Object.fromEntries(params));
    return route.fulfill({ json: { listings: [listing], pagination: { total: 1, page: 1, limit: 12, totalPages: 1 }, locationApplied: !!params.get('coordinates') } });
  });
  await page.goto('/search?q=guitar&category=Items');
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible({ timeout: 30_000 });
  expect(provider.some(item => item.kind === 'style-or-sprite' && item.status === 200)).toBe(true);
  await expect(page.locator('.mapboxgl-canvas')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Where are you looking?' }).fill('Athens Greece');
  const geocoding = page.waitForResponse(response => new URL(response.url()).pathname.startsWith('/geocoding/v5/'));
  await page.getByRole('button', { name: 'Find area', exact: true }).click();
  const response = await geocoding;
  expect(response.status()).toBe(200);
  const payload = await response.json();
  const feature = payload.features.find((item: { place_name?: string; center?: number[] }) => item.place_name && item.center?.length === 2);
  expect(Boolean(feature)).toBe(true);
  await page.getByRole('button', { name: feature.place_name, exact: true }).click();
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('slider', { name: 'Distance (km)' }).fill('12');
  await expect.poll(() => searchQueries.at(-1)?.distance).toBe('12');
  await expect.poll(() => new URL(page.url()).searchParams.get('coordinates')).toBe(feature.center.join(','));
  const selectedURL = new URL(page.url());
  expect(selectedURL.searchParams.get('location')).toBe(feature.place_name);
  expect(selectedURL.searchParams.get('distance')).toBe('12');
  expect(searchQueries.at(-1)?.coordinates).toBe(feature.center.join(','));
  await expect(page.getByTestId('applied-location')).toContainText(feature.place_name);
  await page.getByRole('button', { name: /^Filters/ }).click();
  await expect.poll(() => provider.filter(item => item.kind === 'tiles' && item.status === 200).length).toBeGreaterThan(0);
  await page.locator('.mapboxgl-canvas').scrollIntoViewIfNeeded();
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo({ top: 0, behavior: 'instant' });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: `${evidenceDir}/real-mapbox-${info.project.name}.png`, fullPage: true });
  const selectedParameters = Object.fromEntries(selectedURL.searchParams);
  await page.getByRole('link', { name: /Acoustic guitar/ }).click();
  const returnLink = page.getByRole('link', { name: 'Back to search' });
  await expect(returnLink).toBeVisible();
  const returnURL = new URL((await returnLink.getAttribute('href'))!, selectedURL);
  expect(returnURL.pathname).toBe(selectedURL.pathname);
  // nuqs and URLSearchParams encode commas differently; compare the actual context.
  expect(Object.fromEntries(returnURL.searchParams)).toEqual(selectedParameters);
  await page.getByRole('link', { name: 'Back to search' }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(selectedURL.pathname);
  await expect.poll(() => Object.fromEntries(new URL(page.url()).searchParams)).toEqual(selectedParameters);
  await expect(page.getByRole('textbox', { name: 'Where are you looking?' })).toHaveValue(feature.place_name);
  await expect(page.getByTestId('applied-location')).toContainText('12 km');
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(pageErrors).toEqual([]);
  await writeFile(`${evidenceDir}/real-mapbox-${info.project.name}.json`, JSON.stringify({
    checkedAt: new Date().toISOString(), environment: 'local production build, actual Mapbox, fixture listings/auth/backend',
    browser: browser.version(), viewport: page.viewportSize(), buildId: (await readFile('.next-e2e/BUILD_ID', 'utf8')).trim(),
    sourceManifest: 'source-version.json', providerResponses: provider,
    selectedArea: { label: feature.place_name, coordinates: feature.center, radiusKm: 12 },
    urlParameters: Object.fromEntries(selectedURL.searchParams), lastSearchQuery: searchQueries.at(-1), returnPreserved: true, uncaughtErrors: pageErrors.length,
  }, null, 2));
});
