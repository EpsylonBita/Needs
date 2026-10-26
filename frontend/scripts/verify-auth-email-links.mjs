// Temporary-account Auth checks. Generates links; never calls an email-send API.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;
const checked = (result, label) => {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};

export function authLinkOptions(args) {
  let appUrl = 'http://127.0.0.1:3002';
  let allowTestWrites = false;
  let verifyPasswordUpdate = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--allow-test-writes') allowTestWrites = true;
    else if (argument === '--verify-password-update') verifyPasswordUpdate = true;
    else if (argument === '--app-url') {
      appUrl = args[++index];
      if (!appUrl || appUrl.startsWith('--')) throw new Error('--app-url requires an origin');
    } else if (argument.startsWith('--app-url=')) appUrl = argument.slice('--app-url='.length);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!allowTestWrites) throw new Error('Pass --allow-test-writes to create and clean up a temporary account.');
  const origin = new URL(appUrl);
  const localHttp = origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname);
  if ((!localHttp && origin.protocol !== 'https:') || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('--app-url must be an HTTPS origin or a local HTTP origin, without credentials, path, query or fragment');
  }
  return { appUrl: origin.origin, verifyPasswordUpdate };
}

export async function verifyAuthEmailLinks({ admin, client, appUrl, verifyPasswordUpdate = false, log = console.log }) {
  const email = `needs-auth-check-${randomUUID()}@example.com`;
  const sessions = new Set();
  let userId;
  let failure;
  const sessionResult = (result, label) => {
    const data = checked(result, label);
    // Keep every issued session even if another login replaces the SDK session.
    // Never print these credentials.
    if (data.session?.access_token) sessions.add(data.session.access_token);
    assert.equal(data.user?.id, userId);
    assert.ok(data.session?.access_token, `${label} must issue a session`);
    return data;
  };
  try {
    const initialPassword = `${randomUUID()}Aa1!`;
    const signupUrl = new URL('/auth/confirm', appUrl).toString();
    const recoveryUrl = new URL('/auth/reset-password', appUrl).toString();
    const signup = checked(await admin.auth.admin.generateLink({ type: 'signup', email, password: initialPassword,
      options: { redirectTo: signupUrl } }), 'Generate signup link');
    userId = signup.user.id;
    assert.equal(signup.properties.redirect_to, signupUrl);
    sessionResult(await client.auth.verifyOtp({ type: 'signup', token_hash: signup.properties.hashed_token }), 'Consume signup token');
    log('PASS signup token and configured callback URL');
    const replay = await client.auth.verifyOtp({ type: 'signup', token_hash: signup.properties.hashed_token });
    if (replay.data?.session?.access_token) sessions.add(replay.data.session.access_token);
    assert.equal(replay.error?.code, 'otp_expired', 'Used confirmation tokens must be rejected as invalid/expired');
    log('PASS confirmation token rejects reuse');

    const recovery = checked(await admin.auth.admin.generateLink({ type: 'recovery', email,
      options: { redirectTo: recoveryUrl } }), 'Generate recovery link');
    assert.equal(recovery.properties.redirect_to, recoveryUrl);
    sessionResult(await client.auth.verifyOtp({ type: 'recovery', token_hash: recovery.properties.hashed_token }), 'Consume recovery token');
    const recoveryReplay = await client.auth.verifyOtp({ type: 'recovery', token_hash: recovery.properties.hashed_token });
    if (recoveryReplay.data?.session?.access_token) sessions.add(recoveryReplay.data.session.access_token);
    assert.equal(recoveryReplay.error?.code, 'otp_expired', 'Used recovery tokens must be rejected as invalid/expired');
    log('PASS recovery token, configured callback URL and rejected reuse');

    if (verifyPasswordUpdate) {
      log('Password mutation enabled: Supabase may send a password-change notification depending on its configuration.');
      const newPassword = `${randomUUID()}Bb2!`;
      checked(await client.auth.updateUser({ password: newPassword }), 'Update temporary password');
      checked(await client.auth.signOut({ scope: 'global' }), 'Sign out all temporary-user sessions');
      const oldPassword = await client.auth.signInWithPassword({ email, password: initialPassword });
      if (oldPassword.data?.session?.access_token) sessions.add(oldPassword.data.session.access_token);
      assert.equal(oldPassword.error?.code, 'invalid_credentials', 'The old password must be rejected after reset, not fail due to transport/rate limiting');
      sessionResult(await client.auth.signInWithPassword({ email, password: newPassword }), 'Sign in with new temporary password');
      log('PASS password update, old-password rejection and new-password sign-in');
    } else log('SKIP password mutation and sign-in checks; use --verify-password-update only when provider notifications are understood.');

    const invalid = await client.auth.verifyOtp({ type: 'recovery', token_hash: randomUUID().replaceAll('-', '') });
    if (invalid.data?.session?.access_token) sessions.add(invalid.data.session.access_token);
    assert.equal(invalid.error?.code, 'otp_expired', 'Invalid recovery tokens must be rejected as invalid/expired');
    log('PASS invalid recovery token rejected');
  } catch (error) { failure = error; }

  // Deletion still runs if logout fails. Global logout revokes all refresh
  // sessions for this fixture, including sessions replaced in the SDK.
  const cleanupErrors = [];
  for (const token of sessions) {
    try {
      const result = await admin.auth.admin.signOut(token, 'global');
      const alreadyAbsent = result.error?.name === 'AuthSessionMissingError' && result.error.status === 400;
      if (result.error && !alreadyAbsent && ![401, 403, 404].includes(result.error.status)) checked(result, 'Revoke temporary-user sessions');
    } catch (error) { cleanupErrors.push(error); }
  }
  if (userId) {
    try {
      checked(await admin.auth.admin.deleteUser(userId), 'Clean up temporary account');
      log('Temporary Auth account deleted.');
    } catch (error) { cleanupErrors.push(error); }
  } else log('No temporary Auth account was created.');
  log('No email-send API was called. SMTP acceptance, inbox delivery and browser callbacks were not tested.');
  if (failure || cleanupErrors.length) throw new AggregateError([failure, ...cleanupErrors].filter(Boolean), 'Auth verification or cleanup failed');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = authLinkOptions(process.argv.slice(2));
    loadEnvConfig(dirname(dirname(fileURLToPath(import.meta.url))));
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    assert.equal(new URL(url).hostname, 'qczrqxmewjsydrrvjdil.supabase.co', 'Unexpected Supabase project');
    assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Missing Supabase credentials');
    const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
    await verifyAuthEmailLinks({ ...options,
      admin: createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth }),
      client: createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth }),
    });
  } catch (error) {
    console.error(error.message);
    if (error instanceof AggregateError) error.errors.forEach(cause => console.error(cause.message));
    process.exitCode = 1;
  }
}
