import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const id = 'e1111111-1111-4111-8111-111111111111';
const base = { id, title: 'Κιθάρα · Acoustic guitar', description: 'A used acoustic guitar', price: 85, main_category: 'Items', sub_category: 'Sell', seller_id: 'e2222222-2222-4222-8222-222222222222', sellerName: 'Alex', sellerReviewCount: 0, coordinates: [23.72, 37.98], address: { label: 'Athens, Greece' }, listing_images: [] };
const listings = [base, { ...base, id: 'e3333333-3333-4333-8333-333333333333', title: 'Κιθάρα · Coast guitar', coordinates: [23.72, 37.78] }, { ...base, id: 'e4444444-4444-4444-8444-444444444444', title: 'Κιθάρα · Patras guitar', coordinates: [21.73, 38.25] }];
function km(a: number[], b: number[]) {
  const radians = Math.PI / 180;
  const dlat = (b[1] - a[1]) * radians, dlon = (b[0] - a[0]) * radians;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(dlon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
async function fixtures(page: Page, mapFailure = false) {
  const state = { mapFailure, queries: [] as URLSearchParams[] };
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:3102') return route.continue();
    return route.abort();
  });
  await page.route('**/api/search?**', route => {
    const p = new URL(route.request().url()).searchParams;
    state.queries.push(p);
    let rows = p.has('listingId') ? listings.filter(row => row.id === p.get('listingId')) : listings;
    if (p.get('q')) rows = rows.filter(row => `${row.title} ${row.description}`.toLowerCase().includes(p.get('q')!.toLowerCase()));
    if (p.get('category')) rows = rows.filter(row => row.main_category === p.get('category'));
    if (p.get('coordinates')) rows = rows.filter(row => km(p.get('coordinates')!.split(',').map(Number), row.coordinates) <= Number(p.get('distance') || 50));
    return route.fulfill({ json: { listings: rows, pagination: { total: rows.length, page: Number(p.get('page') || 1), limit: 12, totalPages: 1 }, locationApplied: !!p.get('coordinates') } });
  });
  await page.route('https://api.mapbox.com/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/geocoding/')) return route.fulfill({ json: { features: [
      { id: 'place.athens', place_name: 'Athens, Greece', center: [23.72, 37.98] },
      { id: 'place.patras', place_name: 'Patras, Greece', center: [21.73, 38.25] },
    ] } });
    if (url.pathname.startsWith('/styles/')) return state.mapFailure ? route.fulfill({ status: 403, json: { message: 'Controlled provider failure' } }) : route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'fixture-background', type: 'background', paint: { 'background-color': '#dce9e5' } }] } });
    return route.fulfill({ json: {} });
  });
  return state;
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function capture(page: Page, filename: string) {
  await mkdir('../output/playwright/final-verification', { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo({ top: 0, behavior: 'instant' });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: `../output/playwright/final-verification/${filename}`, fullPage: true });
}

test('manual area and radius change results after denied geolocation', async ({ page }) => {
  const state = await fixtures(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (_success: unknown, failure: (error: { code: number }) => void) => failure({ code: 1 }) } }));
  await page.goto('/search?q=guitar');
  await expect(page.locator('.needs-search-result-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Use my location', exact: true }).click();
  await expect(page.getByText('Your location is unavailable. Choose a city manually or keep searching all locations.')).toBeVisible();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Distance (km)' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Where are you looking?' }).fill('Athens');
  await page.getByRole('button', { name: 'Find area' }).click();
  await page.getByRole('button', { name: 'Athens, Greece', exact: true }).click();
  await expect(page.locator('.needs-search-result-card')).toHaveCount(2);
  await expect(page.getByTestId('applied-location')).toHaveText('Athens, Greece · within 50 km');
  await page.getByRole('slider', { name: 'Distance (km)' }).fill('12');
  await expect(page.locator('.needs-search-result-card')).toHaveCount(1);
  expect(state.queries.at(-1)?.get('distance')).toBe('12');
  expect(state.queries.at(-1)?.get('coordinates')).toBe('23.72,37.98');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Where are you looking?' })).toHaveValue('Athens, Greece');
  await expect(page.getByTestId('applied-location')).toHaveText('Athens, Greece · within 12 km');
  await page.getByRole('textbox', { name: 'Where are you looking?' }).fill('Patras');
  await page.getByRole('button', { name: 'Find area' }).click();
  await page.getByRole('button', { name: 'Patras, Greece', exact: true }).click();
  await expect(page.getByRole('link', { name: /Patras guitar/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Acoustic guitar/ })).toHaveCount(0);
  await noOverflow(page);
});

test('search return, browser history and refresh preserve all URL filters', async ({ page }) => {
  await fixtures(page);
  const search = '/search?' + new URLSearchParams({ q: 'κιθάρα', category: 'Items', subcategory: 'Sell', tags: 'music,wood', coordinates: '23.72,37.98', location: 'Athens, Greece', distance: '12', page: '2' });
  await page.goto(search);
  const original = page.url();
  await page.getByRole('link', { name: /Acoustic guitar/ }).click();
  await expect(page.getByRole('heading', { name: /Acoustic guitar/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to search' })).toHaveAttribute('href', search);
  await page.goBack();
  await expect(page).toHaveURL(original);
  await page.goForward();
  await expect(page.getByRole('heading', { name: /Acoustic guitar/ })).toBeVisible();
  await page.reload();
  await page.getByRole('link', { name: 'Back to search' }).click();
  await expect(page).toHaveURL(original);
  await expect(page.getByRole('searchbox', { name: 'Search', exact: true })).toHaveValue('κιθάρα');
  await expect(page.getByTestId('applied-location')).toHaveText('Athens, Greece · within 12 km');
  await page.goto(`/listings/${id}?returnTo=https://invalid.example`);
  await expect(page.getByRole('link', { name: 'Back to search' })).toHaveAttribute('href', '/search');
});

test('real Mapbox renderer loads a fixture style, fails compactly and retries without losing search', async ({ page }, info) => {
  const state = await fixtures(page, true);
  await page.goto('/search?q=guitar&category=Items');
  await expect(page.locator('[data-map-status="error"]')).toBeVisible();
  await expect(page.locator('.needs-search-workspace')).toHaveClass(/map-unavailable/);
  await expect(page.locator('.needs-search-result-card')).toHaveCount(3);
  const mapBox = await page.locator('.needs-search-map-canvas').boundingBox();
  expect(mapBox!.height).toBeLessThan(300);
  const listBox = await page.locator('.needs-search-list').boundingBox();
  expect(mapBox!.y).toBeGreaterThan(listBox!.y + listBox!.height);
  await noOverflow(page);
  await capture(page, `search-fallback-${info.project.name}.png`);
  state.mapFailure = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await expect(page.locator('.mapboxgl-canvas')).toHaveCount(1);
  await expect(page.locator('.needs-search-workspace')).not.toHaveClass(/map-unavailable/);
  await expect(page.getByRole('searchbox', { name: 'Search', exact: true })).toHaveValue('guitar');
  await expect(page.locator('.needs-search-result-card')).toHaveCount(3);
  await capture(page, `search-map-ready-${info.project.name}.png`);
  await page.goto('/');
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'I need something', exact: true })).toBeVisible();
  await noOverflow(page);
  await capture(page, `home-${info.project.name}.png`);
  state.mapFailure = true;
  await page.reload();
  await expect(page.locator('.needs-discovery-grid')).toHaveClass(/map-unavailable/);
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  const failedHomeMap = await page.locator('.needs-discovery-map').boundingBox();
  expect(failedHomeMap!.height).toBeGreaterThanOrEqual(180);
  expect(failedHomeMap!.height).toBeLessThan(300);
  state.mapFailure = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('[data-map-status="ready"]')).toBeVisible();
});

test('Greek discovery, empty results and reduced motion remain usable on a short viewport', async ({ page }, info) => {
  await fixtures(page);
  await page.context().addCookies([{ name: 'locale', value: 'el', url: 'http://127.0.0.1:3102' }]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: info.project.name.startsWith('mobile') ? 360 : 1280, height: 640 });
  await page.goto('/search?q=missing-fixture');
  await expect(page.getByRole('heading', { name: 'Δεν βρέθηκαν αγγελίες' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Δεν το βρήκες; Δημοσίευσε τι χρειάζεσαι' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Πού ψάχνεις;' })).toBeVisible();
  await noOverflow(page);
  await capture(page, `empty-greek-${info.project.name}.png`);
});
