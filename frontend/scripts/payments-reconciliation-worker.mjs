import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

const HEALTH_MAX_AGE_MS = 450_000; // Five-minute idle interval plus the bounded request timeout.
const validBatch = value => Number.isInteger(value?.claimed) && value.claimed >= 0 && value.claimed <= 2
  && value.completed === value.claimed && value.failed === 0;

function healthPath(env, required = false) {
  const file = env.PAYMENTS_WORKER_HEALTH_FILE;
  if (!file && !required) return null;
  if (typeof file !== 'string' || !isAbsolute(file)) throw new Error('PAYMENTS_WORKER_HEALTH_FILE must be an absolute path in a private writable directory.');
  return file;
}

async function writeHealth(file, state) {
  if (!file) return;
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify({ version: 1, ...state })}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } catch { throw new Error('Payment worker could not persist its health state.'); }
  finally { await rm(temporary, { force: true }).catch(() => {}); }
}

/** Local probe only: never sends a request, reads credentials or changes payments. */
export async function checkPaymentsWorkerHealth({ env = process.env, now = Date.now } = {}) {
  const file = healthPath(env, true);
  let state;
  try { state = JSON.parse(await readFile(file, 'utf8')); }
  catch { return { healthy: false, reason: 'Health state is missing or unreadable.' }; }
  const updated = Date.parse(state?.updatedAt);
  if (state?.version !== 1 || state.status !== 'healthy' || !Number.isFinite(updated)
      || state.lastSuccessAt !== state.updatedAt || state.consecutiveFailures !== 0 || !validBatch(state.batch)) {
    return { healthy: false, reason: 'The latest reconciliation round has not completed successfully.' };
  }
  const ageMs = now() - updated;
  if (ageMs < -30_000 || ageMs > HEALTH_MAX_AGE_MS) return { healthy: false, reason: 'Payment worker health state is stale or its clock is invalid.' };
  return { healthy: true, ageMs: Math.max(0, ageMs) };
}

/** External schedulers can call the same authenticated endpoint every five minutes. */
export async function runPaymentsReconciliationWorker({ env = process.env, fetchImpl = fetch, signal, once = false, wait = delay, log = console.log, now = Date.now } = {}) {
  const secret = env.PAYMENTS_WORKER_SECRET || '';
  if (secret.length < 32) throw new Error('PAYMENTS_WORKER_SECRET must contain at least 32 characters.');
  const origin = new URL(env.NEXT_PUBLIC_APP_URL || '');
  const local = ['localhost', '127.0.0.1'].includes(origin.hostname);
  if ((!local || origin.protocol !== 'http:') && origin.protocol !== 'https:') throw new Error('Use local HTTP or deployed HTTPS.');
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Use an application origin without credentials or a path.');
  const endpoint = new URL('/api/internal/payments/reconcile', origin);
  const file = healthPath(env);
  let lastSuccessAt = null;
  let consecutiveFailures = 0;
  const record = async (status, batch = null) => {
    const updatedAt = new Date(now()).toISOString();
    if (status === 'healthy') lastSuccessAt = updatedAt;
    await writeHealth(file, { status, updatedAt, lastSuccessAt, consecutiveFailures, batch });
  };
  await record('starting');
  try { while (!signal?.aborted) {
    const timeout = AbortSignal.timeout(125_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let succeeded = false;
    let processedWork = false;
    let batch = null;
    let authenticationFailed = false;
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST', headers: { Authorization: `Bearer ${secret}` }, redirect: 'error', signal: requestSignal,
      });
      if (response.status === 401) throw new WorkerAuthenticationError();
      const result = await response.json().catch(() => null);
      succeeded = response.ok && validBatch(result);
      if (succeeded) batch = { claimed: result.claimed, completed: result.completed, failed: 0 };
      processedWork = succeeded && result.claimed > 0;
      if (succeeded && result.claimed) log(`Payment reconciliation: ${result.completed} checked.`);
      if (!succeeded) log('Payment reconciliation needs attention; the next run will retry.');
    } catch (error) {
      authenticationFailed = error instanceof WorkerAuthenticationError;
      if (signal?.aborted) return;
      if (!authenticationFailed) log('Payment reconciliation could not reach the app; the next run will retry.');
    }
    consecutiveFailures = succeeded ? 0 : consecutiveFailures + 1;
    await record(succeeded ? 'healthy' : 'failed', batch);
    if (authenticationFailed) throw new Error('Payment worker authorization failed. Match the worker and application secrets.');
    if (once) {
      if (!succeeded) throw new Error('Payment reconciliation did not complete successfully.');
      return;
    }
    // Drain queued batches promptly. Sleep five minutes once idle or on failure;
    // otherwise a small fixed batch would fall behind as order volume grows.
    try { await wait(processedWork ? 1_000 : 300_000, undefined, { signal }); }
    catch (error) { if (signal?.aborted) return; throw error; }
  } } finally { if (signal?.aborted) await record('stopped'); }
}
class WorkerAuthenticationError extends Error {}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    if (process.argv.includes('--health-check')) {
      const result = await checkPaymentsWorkerHealth();
      console.log(result.healthy ? 'Payment worker is healthy.' : result.reason);
      if (!result.healthy) process.exitCode = 1;
    } else await runPaymentsReconciliationWorker({ signal: controller.signal, once: process.argv.includes('--once') });
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
