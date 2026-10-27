import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPaymentsReconciliationWorker } from '../../scripts/payments-reconciliation-worker.mjs';

const env = { NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3002', PAYMENTS_WORKER_SECRET: 's'.repeat(64) };
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('a scheduled run sends only its server secret to the exact app endpoint', async () => {
  await runPaymentsReconciliationWorker({ env, once: true, log() {}, fetchImpl: async (url, options) => {
    assert.equal(url.href, 'http://127.0.0.1:3002/api/internal/payments/reconcile');
    assert.equal(options.redirect, 'error'); assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, `Bearer ${env.PAYMENTS_WORKER_SECRET}`);
    return response(200, { claimed: 1, completed: 1, failed: 0 });
  } });
});
test('refuses insecure remote origins, credentials and unconfigured secrets', async () => {
  for (const origin of ['http://remote.example', 'https://user:password@example.com', 'https://example.com/other']) {
    await assert.rejects(runPaymentsReconciliationWorker({ env: { ...env, NEXT_PUBLIC_APP_URL: origin }, once: true }));
  }
  await assert.rejects(runPaymentsReconciliationWorker({ env: { ...env, PAYMENTS_WORKER_SECRET: '' }, once: true }));
});
test('authentication errors stop and failed runs produce non-success without leaking the secret', async () => {
  await assert.rejects(runPaymentsReconciliationWorker({ env, once: true, fetchImpl: async () => response(401, {}) }), /authorization failed/);
  const logs = [];
  await assert.rejects(runPaymentsReconciliationWorker({ env, once: true, log: value => logs.push(value), fetchImpl: async () => response(503, { failed: 1 }) }), /did not complete/);
  assert.ok(!logs.join('').includes(env.PAYMENTS_WORKER_SECRET));
});
test('continuous retries wait five minutes and honor shutdown', async () => {
  const controller = new AbortController(); let attempts = 0;
  await runPaymentsReconciliationWorker({ env, signal: controller.signal, log() {}, fetchImpl: async () => {
    attempts++; return response(200, { claimed: 0, completed: 0, failed: 0 });
  }, wait: async milliseconds => { assert.equal(milliseconds, 300000); controller.abort(); } });
  assert.equal(attempts, 1);
});
test('successful batches drain promptly until the database queue is empty', async () => {
  const controller = new AbortController(); let attempts = 0; const waits = [];
  await runPaymentsReconciliationWorker({ env, signal: controller.signal, log() {}, fetchImpl: async () => {
    attempts++; return response(200, { claimed: attempts === 1 ? 2 : 0, completed: attempts === 1 ? 2 : 0, failed: 0 });
  }, wait: async milliseconds => { waits.push(milliseconds); if (waits.length === 2) controller.abort(); } });
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [1000, 300000]);
});
