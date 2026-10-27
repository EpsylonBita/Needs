// Local Stripe event forwarding. Never accepts live keys or public bind hosts.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import nextEnv from '@next/env';
import { stripeListenerArguments, stripeListenerReady } from '../lib/stripe/api-version.mjs';

const { loadEnvConfig } = nextEnv;

const require = createRequire(import.meta.url);
const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.argv[2] || 'dev';
if (!['dev', 'start', 'listen'].includes(mode)) throw new Error('Use dev, start, or listen.');
process.env.NODE_ENV = mode === 'dev' ? 'development' : 'production';
loadEnvConfig(projectDir, mode === 'dev');
const apiKey = process.env.STRIPE_SECRET_KEY || '';
if (!/^(sk|rk|rkcs)_test_/.test(apiKey)) throw new Error('Local payment testing requires a Stripe test key.');
const baseUrl = new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3002');
if (baseUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(baseUrl.hostname) || baseUrl.username || baseUrl.password) {
  throw new Error('Local payments must target http://127.0.0.1 or http://localhost.');
}
const port = baseUrl.port || '80';
const platformPackage = `@stripe/cli-${process.platform}-${process.arch}`;
const binary = join(dirname(require.resolve(`${platformPackage}/package.json`)), 'bin', process.platform === 'win32' ? 'stripe.exe' : 'stripe');
const env = { ...process.env, STRIPE_API_KEY: apiKey, STRIPE_DEVICE_NAME: 'needs-local', NEXT_PUBLIC_APP_URL: baseUrl.origin,
  PAYMENTS_WORKER_SECRET: process.env.PAYMENTS_WORKER_SECRET || randomBytes(32).toString('hex'),
};
let next;
let emailWorker;
let paymentWorker;
let stopping = false;
let ready = false;
function stopChild(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else child.kill();
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(startupTimeout);
  stopChild(emailWorker);
  stopChild(paymentWorker);
  stopChild(next);
  stopChild(listener);
  process.exitCode = code;
}
const listener = spawn(binary, stripeListenerArguments(baseUrl.origin), {
  cwd: projectDir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
const startupTimeout = setTimeout(() => {
  console.error('Stripe event forwarding did not become ready within 45 seconds.');
  stop(1);
}, 45_000);

const redact = line => line.replace(/(?:whsec_|(?:sk|rk|rkcs|pk)_(?:test|live)_)[A-Za-z0-9_]+/g, '[redacted]');
function receive(line) {
  if (stopping) return;
  let listenerReady;
  try { listenerReady = stripeListenerReady(line); }
  catch (error) { console.error(error.message); stop(1); return; }
  if (listenerReady && !ready) {
    const { signingSecret, apiVersion } = listenerReady;
    ready = true;
    clearTimeout(startupTimeout);
    console.log(`Stripe test webhook forwarding is ready on API ${apiVersion}. Signing secret is kept private.`);
    if (mode === 'listen') {
      if (process.env.STRIPE_WEBHOOK_SECRET !== signingSecret) {
        console.error('The running app must use this listener signing secret. Use npm run dev:payments or npm run start:payments to configure both together.');
        stop(1);
      }
    } else {
      next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), mode, '--hostname', baseUrl.hostname, '-p', port], {
        cwd: projectDir, env: { ...env, STRIPE_WEBHOOK_SECRET: signingSecret }, windowsHide: true, stdio: 'inherit',
      });
      next.on('error', () => { console.error('Could not start Needs.'); stop(1); });
      next.on('exit', code => stop(code ?? 1));
      paymentWorker = spawn(process.execPath, [join(projectDir, 'scripts', 'payments-reconciliation-worker.mjs')], {
        cwd: projectDir, env, windowsHide: true, stdio: 'inherit',
      });
      paymentWorker.on('error', () => { console.error('Could not start payment reconciliation.'); stop(1); });
      paymentWorker.on('exit', code => {
        if (!stopping && code) { console.error('Payment reconciliation stopped.'); stop(code); }
      });
      emailWorker = spawn(process.execPath, [join(projectDir, 'scripts', 'contact-email-worker.mjs')], {
        cwd: projectDir, env, windowsHide: true, stdio: 'inherit',
      });
      emailWorker.on('error', () => { console.error('Could not start the contact email worker.'); stop(1); });
      emailWorker.on('exit', code => {
        if (!stopping && code) { console.error('Contact email retries stopped.'); stop(code); }
      });
    }
  } else if (line.trim()) {
    console.log(redact(line));
  }
}
for (const stream of [listener.stdout, listener.stderr]) {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    pending += chunk;
    const lines = pending.split(/[\r\n]+/);
    pending = lines.pop() || '';
    for (const line of lines) receive(line);
    // The ready prompt can omit a newline; never print a partial secret.
    if (/whsec_[A-Za-z0-9]+\s/.test(pending)) { receive(pending); pending = ''; }
  });
  stream.on('end', () => { if (pending) receive(pending); });
}
listener.on('error', () => { console.error('Could not start the installed Stripe CLI. Run npm ci.'); stop(1); });
listener.on('exit', code => {
  if (!stopping) console.error('Stripe event forwarding stopped; stopping Needs to avoid missing payment events.');
  stop(code || 1);
});
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
