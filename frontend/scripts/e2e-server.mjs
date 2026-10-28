import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

// Explicitly opt in to read-only provider verification. Only the existing public
// Mapbox token is read; account/payment/email configuration stays isolated below.
let mapboxToken = 'pk.e2e-fixture';
if (process.env.NEEDS_E2E_REAL_MAPBOX === '1') {
  mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || parseEnv(await readFile('.env.local', 'utf8')).NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!mapboxToken) throw new Error('Real Mapbox verification requires the existing public token.');
}

// These values always replace .env.local. Browser fixtures never use a real account,
// public backend, payment key or contact-email delivery configuration.
const env = {
  ...process.env, NEEDS_E2E: '1', NODE_ENV: 'production',
  NEXT_PUBLIC_SUPABASE_URL: 'https://needs-e2e.invalid',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-e2e-fixture',
  SUPABASE_SERVICE_ROLE_KEY: 'server-e2e-fixture',
  PRICING_RETAIL_ENABLED: 'false',
  NEXT_PUBLIC_MAPBOX_TOKEN: mapboxToken,
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3102',
  NEXT_PUBLIC_API_URL: '', NEXT_PUBLIC_DOMAIN: '',
  NEXT_PUBLIC_PAYMENTS_ENABLED: 'false',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_e2e_fixture',
  STRIPE_SECRET_KEY: 'sk_test_e2e_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_e2e_fixture',
  RESEND_API_KEY: '', CONTACT_EMAIL_FROM: '', CONTACT_NOTIFY_TO: '', CRON_SECRET: '', PAYMENTS_WORKER_SECRET: '', ADMIN_EMAILS: '',
};
let child;
let stopping = false;
let originals = [];
const restore = () => Promise.all(originals.map(({ path, content }) => writeFile(path, content)));
function run(args) {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, ['node_modules/next/dist/bin/next', ...args], { env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Next exited with ${code}`)));
  });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  void (async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exited;
    }
    await restore();
    process.exit(0);
  })();
});
// Next generates route declarations in these shared files even with distDir.
// Restore them immediately after compilation so a test run does not edit source config.
originals = await Promise.all(['next-env.d.ts', 'tsconfig.json'].map(async path => ({ path, content: await readFile(path) })));
try {
  try { await run(['build', '--webpack']); }
  finally { await restore(); }
  if (stopping) process.exit(0);
  await run(['start', '--hostname', '127.0.0.1', '-p', '3102']);
} catch (error) { console.error(error.message); process.exitCode = 1; }
