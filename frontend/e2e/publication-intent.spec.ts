import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

async function publicationFixtures(page: Page) {
  const writes: string[] = [];
  const user = { id: '10000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'publication@example.test', user_metadata: { fullName: 'Publication Fixture', phoneNumber: '+306991234567' }, app_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'fixture-signature'].join('.');
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:3102' ? route.continue() : route.abort('blockedbyclient'));
  await page.route('https://api.mapbox.com/styles/**', route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await page.route('https://events.mapbox.com/**', route => route.fulfill({ status: 204 }));
  await page.route('https://needs-e2e.invalid/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/auth/v1/token') return route.fulfill({ json: { user, access_token: token, refresh_token: 'publication-fixture-refresh', token_type: 'bearer', expires_in: 3600 } });
    if (path === '/auth/v1/user') return route.fulfill({ json: user });
    if (path === '/rest/v1/profiles') return route.fulfill({ json: [{ id: '20000000-0000-4000-8000-000000000001', user_id: user.id, display_name: 'Publication Fixture' }] });
    if (path === '/rest/v1/notifications') return route.fulfill({ json: [], headers: { 'content-range': '*/0' } });
    if (request.method() !== 'GET') writes.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 400, json: { error: 'Unexpected fixture request' } });
  });
  await page.routeWebSocket('wss://needs-e2e.invalid/**', socket => socket.close());
  await page.route('**/api/admin/check', route => route.fulfill({ status: 403, json: { error: 'Not an admin' } }));
  await page.route('**/api/search?**', route => route.fulfill({ json: { listings: [], pagination: { total: 0, page: 1, limit: 20, totalPages: 0 }, locationApplied: true } }));
  return writes;
}

async function signIn(page: Page, greek = false) {
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type="email"]').fill('publication@example.test');
  await dialog.locator('input[autocomplete="current-password"]').fill('Local-fixture-only-123!');
  await dialog.getByRole('button', { name: greek ? 'Σύνδεση' : 'Sign in', exact: true }).click();
  await expect(page.getByRole('dialog', { name: greek ? 'Νέα αγγελία' : 'New listing', exact: true })).toBeVisible();
}

test('zero results retain request context through sign-in into the reviewable form', async ({ page }, testInfo) => {
  const writes = await publicationFixtures(page);
  await page.goto('/services?q=guitar+lessons&tags=acoustic&coordinates=23.72%2C37.98&location=Athens&distance=10');
  await page.getByRole('button', { name: 'Didn’t find it? Post what you need', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveAccessibleDescription(/publish what you need/);
  await signIn(page);
  const form = page.getByRole('dialog', { name: 'New listing', exact: true });
  await form.getByRole('button', { name: 'Skip photos', exact: true }).click();
  await expect(form.getByLabel('Title', { exact: true })).toHaveValue('guitar lessons');
  await expect(form.getByLabel('What would you like to list?', { exact: true })).toHaveValue('guitar lessons');
  await expect(form.getByRole('combobox', { name: 'Category', exact: true })).toHaveValue('Services');
  await expect(form.getByLabel('Listing type', { exact: true })).toHaveValue('I want');
  await expect(form.getByRole('combobox', { name: 'Location', exact: true })).toHaveValue('Athens');
  await expect(form.getByRole('button', { name: 'acoustic', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(form.getByRole('button', { name: 'Publish listing', exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('request-draft.png') });
  expect(writes).toEqual([]);
});

test('Greek home actions select requests and offers without publishing', async ({ page, context }) => {
  const writes = await publicationFixtures(page);
  await context.addCookies([{ name: 'locale', value: 'el', url: 'http://127.0.0.1:3102' }]);
  await page.goto('/');
  await page.getByRole('button', { name: 'Χρειάζομαι κάτι', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveAccessibleDescription(/δημοσιεύσεις τι χρειάζεσαι/);
  await signIn(page, true);
  await page.getByRole('button', { name: 'Χωρίς φωτογραφία', exact: true }).click();
  await expect(page.getByLabel('Είδος αγγελίας', { exact: true })).toHaveValue('Buy');
  await page.getByRole('button', { name: 'Κλείσιμο', exact: true }).click();
  await page.getByRole('button', { name: 'Έχω κάτι να προσφέρω', exact: true }).click();
  await page.getByRole('button', { name: 'Χωρίς φωτογραφία', exact: true }).click();
  await expect(page.getByLabel('Είδος αγγελίας', { exact: true })).toHaveValue('Sell');
  expect(writes).toEqual([]);
});

test('registration remains keyboard-accessible on a narrow, short viewport', async ({ page }, testInfo) => {
  const writes = await publicationFixtures(page);
  await page.setViewportSize({ width: 360, height: 480 });
  await page.goto('/');
  await page.getByRole('button', { name: 'I need something', exact: true }).click();
  await page.getByRole('button', { name: 'Need an account? Sign up', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/phone is stored in your account/)).toBeVisible();
  const screenshotDirectory = resolve('../output/playwright/final-verification');
  await mkdir(screenshotDirectory, { recursive: true });
  await dialog.evaluate(element => { element.scrollTop = 0; });
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  await page.screenshot({ path: resolve(screenshotDirectory, `registration-short-${testInfo.project.name}.png`), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Create account', exact: true }).focus();
  await expect(dialog.getByRole('button', { name: 'Create account', exact: true })).toBeInViewport();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Wait for scroll/focus repaint and settle animations before capturing the high-DPI viewport.
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  await page.screenshot({ path: resolve(screenshotDirectory, `registration-short-bottom-${testInfo.project.name}.png`), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(writes).toEqual([]);
});
