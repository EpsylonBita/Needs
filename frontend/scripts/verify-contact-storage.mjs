// Live app/database check with an exact temporary submission; never sends mail.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import nextEnv from '@next/env';

if (!process.argv.includes('--allow-test-writes')) throw new Error('Pass --allow-test-writes to create and remove a temporary contact record.');
nextEnv.loadEnvConfig(process.cwd());
assert.ok(!process.env.RESEND_API_KEY, 'This no-mail check requires email delivery to be unconfigured.');
const origin = process.env.NEXT_PUBLIC_APP_URL;
assert.equal(origin, 'http://127.0.0.1:3002');
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, 'qczrqxmewjsydrrvjdil.supabase.co');
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const submissionKey = randomUUID();
const marker = `needs-contact-verification-${submissionKey}`;
const csrfResponse = await fetch(`${origin}/api/csrf`);
assert.equal(csrfResponse.status, 200);
const { csrfToken } = await csrfResponse.json();
const headers = { 'Content-Type': 'application/json', Cookie: `csrf_token=${csrfToken}`,
  'X-CSRF-Token': csrfToken, 'Idempotency-Key': submissionKey };
const message = { firstName: 'Temporary', lastName: 'Verification', email: 'test@example.com',
  subject: marker, message: 'Temporary contact storage verification. No email should be sent.' };
try {
  const denied = await fetch(`${origin}/api/internal/contact/dispatch`, { method: 'POST' });
  assert.equal(denied.status, 401);
  const worker = await fetch(`${origin}/api/internal/contact/dispatch`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  assert.equal(worker.status, 200);
  assert.equal((await worker.json()).configured, false);
  console.log('PASS worker authorization and honest unconfigured-provider status');

  const first = await fetch(`${origin}/api/contact`, { method: 'POST', headers, body: JSON.stringify(message) });
  assert.equal(first.status, 201);
  const saved = await first.json();
  assert.equal(saved.saved, true);
  assert.equal(saved.notification, 'unavailable');
  const repeat = await fetch(`${origin}/api/contact`, { method: 'POST', headers, body: JSON.stringify(message) });
  assert.equal(repeat.status, 201);
  assert.equal((await repeat.json()).requestId, saved.requestId);
  const conflict = await fetch(`${origin}/api/contact`, {
    method: 'POST', headers, body: JSON.stringify({ ...message, message: `${message.message} Edited.` }),
  });
  assert.equal(conflict.status, 409);
  const { data, error } = await admin.from('support_requests')
    .select('id,notification_status,notification_attempts').eq('submission_key', submissionKey);
  if (error) throw new Error('Could not verify temporary contact record');
  assert.equal(data.length, 1);
  assert.equal(data[0].id, saved.requestId);
  assert.equal(data[0].notification_status, 'pending');
  assert.equal(data[0].notification_attempts, 0);
  console.log('PASS contact persistence, duplicate replay, changed-payload rejection and queued state');

  const invalidWebhook = await fetch(`${origin}/api/payments/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 'invalid' }, body: '{}',
  });
  assert.equal(invalidWebhook.status, 400);
  console.log('PASS invalid Stripe webhook signature rejected');
} finally {
  const { error } = await admin.from('support_requests').delete().eq('submission_key', submissionKey).eq('subject', marker);
  if (error) throw new Error(`Cleanup failed for temporary submission ${submissionKey}`);
  console.log('Temporary contact record cleaned up. No email was sent.');
}
