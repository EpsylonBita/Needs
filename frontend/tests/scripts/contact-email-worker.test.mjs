// @vitest-environment node
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { runContactEmailWorker } from '../../scripts/contact-email-worker.mjs';

const env = { RESEND_API_KEY: 'test-only-key', CONTACT_EMAIL_FROM: 'contact@example.com', CONTACT_NOTIFY_TO: 'support@example.com', CRON_SECRET: 'test-only-secret-at-least-32-characters', NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3002' };

test('unconfigured delivery exits successfully without making a request', async () => {
  let called = false;
  await runContactEmailWorker({ env: {}, fetchImpl: async () => { called = true; }, log: () => {} });
  assert.equal(called, false);
});

test('worker rejects remote destinations and missing secrets before sending anything', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; };
  await assert.rejects(runContactEmailWorker({ env: { ...env, NEXT_PUBLIC_APP_URL: 'https://example.com' }, fetchImpl }), /local HTTP/);
  await assert.rejects(runContactEmailWorker({ env: { ...env, CRON_SECRET: '' }, fetchImpl }), /requires CRON_SECRET/);
  assert.equal(called, false);
});

test('app startup failures retry after 60 seconds and only call the fixed local POST endpoint', async () => {
  const controller = new AbortController();
  const calls = [];
  const waits = [];
  const logs = [];
  await runContactEmailWorker({
    env, signal: controller.signal, log: message => logs.push(message),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1) throw new Error('connection refused');
      return new Response(JSON.stringify({ configured: true, claimed: 1, accepted: 1, pending: 0 }));
    },
    wait: async ms => { waits.push(ms); if (waits.length === 2) controller.abort(); },
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [60_000, 60_000]);
  assert.equal(calls[1].url, 'http://127.0.0.1:3002/api/internal/contact/dispatch');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.redirect, 'error');
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${env.CRON_SECRET}`);
  assert.ok(logs.every(message => !message.includes(env.CRON_SECRET) && !message.includes(env.RESEND_API_KEY) && !message.includes(env.CONTACT_NOTIFY_TO)));
});

test('worker stops when the app reports unconfigured delivery or invalid authorization', async () => {
  let waited = false;
  await runContactEmailWorker({ env, fetchImpl: async () => new Response('{"configured":false}'), wait: async () => { waited = true; }, log: () => {} });
  assert.equal(waited, false);
  await assert.rejects(runContactEmailWorker({ env, fetchImpl: async () => new Response('{}', { status: 401 }) }), /authorization failed/);
});

test('abort cancels an in-flight request and exits without scheduling another pass', async () => {
  const controller = new AbortController();
  let waited = false;
  await runContactEmailWorker({
    env, signal: controller.signal, log: () => {}, wait: async () => { waited = true; },
    fetchImpl: async (_url, options) => {
      controller.abort();
      assert.equal(options.signal.aborted, true);
      throw new Error('aborted');
    },
  });
  assert.equal(waited, false);
});
