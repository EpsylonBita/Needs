import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

/** External schedulers can call the same authenticated endpoint every five minutes. */
export async function runPaymentsReconciliationWorker({ env = process.env, fetchImpl = fetch, signal, once = false, wait = delay, log = console.log } = {}) {
  const secret = env.PAYMENTS_WORKER_SECRET || '';
  if (secret.length < 32) throw new Error('PAYMENTS_WORKER_SECRET must contain at least 32 characters.');
  const origin = new URL(env.NEXT_PUBLIC_APP_URL || '');
  const local = ['localhost', '127.0.0.1'].includes(origin.hostname);
  if ((!local || origin.protocol !== 'http:') && origin.protocol !== 'https:') throw new Error('Use local HTTP or deployed HTTPS.');
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Use an application origin without credentials or a path.');
  const endpoint = new URL('/api/internal/payments/reconcile', origin);
  while (!signal?.aborted) {
    const timeout = AbortSignal.timeout(125_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let succeeded = false;
    let processedWork = false;
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST', headers: { Authorization: `Bearer ${secret}` }, redirect: 'error', signal: requestSignal,
      });
      if (response.status === 401) throw new WorkerAuthenticationError();
      const result = await response.json().catch(() => null);
      succeeded = response.ok && Number.isInteger(result?.claimed) && Number.isInteger(result?.completed)
        && result?.failed === 0 && result.claimed === result.completed;
      processedWork = succeeded && result.claimed > 0;
      if (succeeded && result.claimed) log(`Payment reconciliation: ${result.completed} checked.`);
      if (!succeeded) log('Payment reconciliation needs attention; the next run will retry.');
    } catch (error) {
      if (error instanceof WorkerAuthenticationError) throw new Error('Payment worker authorization failed. Match the worker and application secrets.');
      if (signal?.aborted) return;
      log('Payment reconciliation could not reach the app; the next run will retry.');
    }
    if (once) {
      if (!succeeded) throw new Error('Payment reconciliation did not complete successfully.');
      return;
    }
    // Drain queued batches promptly. Sleep five minutes once idle or on failure;
    // otherwise a small fixed batch would fall behind as order volume grows.
    try { await wait(processedWork ? 1_000 : 300_000, undefined, { signal }); }
    catch (error) { if (signal?.aborted) return; throw error; }
  }
}
class WorkerAuthenticationError extends Error {}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try { await runPaymentsReconciliationWorker({ signal: controller.signal, once: process.argv.includes('--once') }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
