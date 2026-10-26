import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;

/** Local-only polling. Provider requests and claims remain inside the app API. */
export async function runContactEmailWorker({
  env = process.env, fetchImpl = fetch, signal,
  wait = (ms, abortSignal) => delay(ms, undefined, { signal: abortSignal }),
  log = message => console.log(message),
} = {}) {
  if (![env.RESEND_API_KEY, env.CONTACT_EMAIL_FROM, env.CONTACT_NOTIFY_TO].every(value => value?.trim())) {
    log('Contact email delivery is not configured; saved messages remain queued.');
    return;
  }
  const secret = env.CRON_SECRET || '';
  if (secret.length < 32) throw new Error('Contact email worker requires CRON_SECRET with at least 32 characters.');
  const baseUrl = new URL(env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3002');
  if (baseUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(baseUrl.hostname) || baseUrl.username || baseUrl.password) {
    throw new Error('Contact email worker must target local HTTP on 127.0.0.1 or localhost.');
  }
  const endpoint = new URL('/api/internal/contact/dispatch', baseUrl.origin);
  while (!signal?.aborted) {
    const requestController = new AbortController();
    const stopRequest = () => requestController.abort();
    signal?.addEventListener('abort', stopRequest, { once: true });
    const timeout = setTimeout(stopRequest, 125_000);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST', headers: { Authorization: `Bearer ${secret}` },
        redirect: 'error', signal: requestController.signal,
      });
      if (response.status === 401) throw new WorkerConfigurationError();
      if (!response.ok) log('Contact email worker is waiting for the app; retrying in 60 seconds.');
      else {
        const result = await response.json();
        if (result.configured === false) {
          log('Contact email delivery is not configured; saved messages remain queued.');
          return;
        }
        if (result.claimed > 0) log(`Contact email queue processed: ${Number(result.accepted) || 0} accepted, ${Number(result.pending) || 0} awaiting retry or review.`);
      }
    } catch (error) {
      if (error instanceof WorkerConfigurationError) throw new Error('Contact email worker authorization failed. Restart the app and worker with matching configuration.');
      if (!signal?.aborted) log('Contact email worker is waiting for the app; retrying in 60 seconds.');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', stopRequest);
    }
    if (signal?.aborted) return;
    try { await wait(60_000, signal); }
    catch (error) { if (signal?.aborted) return; throw error; }
  }
}

class WorkerConfigurationError extends Error {}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnvConfig(dirname(dirname(fileURLToPath(import.meta.url))));
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try { await runContactEmailWorker({ signal: controller.signal }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
