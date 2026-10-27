import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPaymentsReconciliationWorker, checkPaymentsWorkerHealth } from '../../scripts/payments-reconciliation-worker.mjs';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const env = { NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3002', PAYMENTS_WORKER_SECRET: 's'.repeat(64) };
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const emptyBatch = { claimed: 0, completed: 0, failed: 0 };
const healthyFetch = async () => response(200, emptyBatch);
async function healthFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'needs-worker-health-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'health.json');
  return { directory, file, env: { ...env, PAYMENTS_WORKER_HEALTH_FILE: file } };
}

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

test('a malformed successful response cannot report a healthy reconciliation batch', async () => {
  for (const body of [
    { claimed: -1, completed: -1, failed: 0 },
    { claimed: 3, completed: 3, failed: 0 },
    { claimed: 1.5, completed: 1.5, failed: 0 },
    { claimed: 2, completed: 1, failed: 0 },
  ]) {
    await assert.rejects(runPaymentsReconciliationWorker({ env, once: true, log() {}, fetchImpl: async () => response(200, body) }), /did not complete/);
  }
});

test('healthy idle rounds are observable and become unhealthy after a stopped process goes stale', async t => {
  const fixture = await healthFixture(t); let clock = Date.UTC(2026, 9, 27);
  await runPaymentsReconciliationWorker({ env: fixture.env, once: true, now: () => clock, fetchImpl: healthyFetch });
  assert.equal((await checkPaymentsWorkerHealth({ env: fixture.env, now: () => clock + 425000 })).healthy, true);
  assert.equal((await checkPaymentsWorkerHealth({ env: fixture.env, now: () => clock + 450001 })).healthy, false);
  assert.equal((await checkPaymentsWorkerHealth({ env: fixture.env, now: () => clock - 30001 })).healthy, false);
  assert.deepEqual(await readdir(fixture.directory), ['health.json'], 'Atomic writes must not retain temporary state files.');
});

test('failure marks health unhealthy immediately and recovery clears failures without exposing secrets', async t => {
  const fixture = await healthFixture(t); const controller = new AbortController(); let attempts = 0;
  const states = []; const logs = [];
  await runPaymentsReconciliationWorker({ env: fixture.env, signal: controller.signal, log: value => logs.push(value), fetchImpl: async () => {
    attempts++;
    if (attempts === 2) throw new Error(`private response ${env.PAYMENTS_WORKER_SECRET}`);
    return response(200, { ...emptyBatch, unexpectedProviderData: env.PAYMENTS_WORKER_SECRET });
  }, wait: async () => {
    states.push(await checkPaymentsWorkerHealth({ env: fixture.env }));
    const raw = await readFile(fixture.file, 'utf8');
    assert.ok(!raw.includes(env.PAYMENTS_WORKER_SECRET));
    assert.equal(JSON.parse(raw).consecutiveFailures, attempts === 2 ? 1 : 0);
    if (attempts === 3) controller.abort();
  } });
  assert.deepEqual(states.map(state => state.healthy), [true, false, true]);
  assert.ok(!logs.join('').includes(env.PAYMENTS_WORKER_SECRET));
  assert.equal((await checkPaymentsWorkerHealth({ env: fixture.env })).healthy, false);
  assert.equal(JSON.parse(await readFile(fixture.file, 'utf8')).status, 'stopped');
});

test('starting a new worker clears an earlier healthy state before contacting the application', async t => {
  const fixture = await healthFixture(t);
  await runPaymentsReconciliationWorker({ env: fixture.env, once: true, fetchImpl: healthyFetch });
  await runPaymentsReconciliationWorker({ env: fixture.env, once: true, fetchImpl: async () => {
    assert.equal((await checkPaymentsWorkerHealth({ env: fixture.env })).healthy, false);
    assert.equal(JSON.parse(await readFile(fixture.file, 'utf8')).status, 'starting');
    return response(200, emptyBatch);
  } });
});

test('authorization and partial-batch failures leave an unhealthy state and --once fails', async t => {
  const fixture = await healthFixture(t);
  for (const result of [response(401, {}), response(200, { claimed: 2, completed: 1, failed: 1 })]) {
    await assert.rejects(runPaymentsReconciliationWorker({ env: fixture.env, once: true, log() {}, fetchImpl: async () => result }));
    assert.equal((await checkPaymentsWorkerHealth({ env: fixture.env })).healthy, false);
    assert.equal(JSON.parse(await readFile(fixture.file, 'utf8')).status, 'failed');
  }
});

test('a missing, corrupt or forged successful health state fails closed', async t => {
  const fixture = await healthFixture(t);
  assert.equal((await checkPaymentsWorkerHealth({ env: fixture.env })).healthy, false);
  for (const value of ['{', 'null', JSON.stringify({ version: 1, status: 'healthy', updatedAt: new Date().toISOString(), lastSuccessAt: 'older', consecutiveFailures: 0, batch: emptyBatch })]) {
    await writeFile(fixture.file, value);
    assert.equal((await checkPaymentsWorkerHealth({ env: fixture.env })).healthy, false);
  }
});

test('health requires an absolute private destination and persistence errors stop before payment requests', async t => {
  const fixture = await healthFixture(t); let called = false;
  for (const destination of ['relative-health.json', join(fixture.directory, 'absent', 'health.json')]) {
    await assert.rejects(runPaymentsReconciliationWorker({ env: { ...env, PAYMENTS_WORKER_HEALTH_FILE: destination }, once: true, fetchImpl: async () => { called = true; return response(200, emptyBatch); } }));
  }
  assert.equal(called, false);
  await assert.rejects(checkPaymentsWorkerHealth({ env: {} }), /absolute path/);
});

test('CLI health probe needs no application credentials and exits nonzero on unhealthy state', async t => {
  const fixture = await healthFixture(t);
  const script = fileURLToPath(new URL('../../scripts/payments-reconciliation-worker.mjs', import.meta.url));
  const probeEnv = { PAYMENTS_WORKER_HEALTH_FILE: fixture.file };
  await assert.rejects(promisify(execFile)(process.execPath, [script, '--health-check'], { env: probeEnv }), error => error.code === 1);
  await runPaymentsReconciliationWorker({ env: fixture.env, once: true, fetchImpl: healthyFetch });
  const result = await promisify(execFile)(process.execPath, [script, '--health-check'], { env: probeEnv });
  assert.match(result.stdout, /is healthy/);
});
