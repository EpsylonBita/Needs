// @vitest-environment node
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { authLinkOptions, verifyAuthEmailLinks } from '../../scripts/verify-auth-email-links.mjs';

function fixture({ replayAccepted = false, logoutFails = false, firstSessionGone = false, oldPasswordFailure = 'invalid_credentials', generationFails = false } = {}) {
  const calls = { links: [], sessions: [], revoked: [], deleted: [], updates: [], passwords: [], logs: [] };
  const tokens = new Set();
  let password;
  const success = () => {
    const token = `fixture-session-${calls.sessions.length}`;
    calls.sessions.push(token);
    return { data: { user: { id: 'temporary-user' }, session: { access_token: token } }, error: null };
  };
  const admin = { auth: { admin: {
    async generateLink(request) {
      calls.links.push(request);
      if (generationFails) return { data: null, error: new Error('unavailable') };
      if (request.password) password = request.password;
      tokens.add(request.type);
      return { data: { user: { id: 'temporary-user' }, properties: { redirect_to: request.options.redirectTo, hashed_token: request.type } }, error: null };
    },
    async signOut(token, scope) {
      calls.revoked.push({ token, scope });
      if (firstSessionGone && token === calls.sessions[0]) return { error: { name: 'AuthSessionMissingError', message: 'Auth session missing!', status: 400 } };
      return { error: logoutFails ? { message: 'logout unavailable', status: 503 } : null };
    },
    async deleteUser(id) { calls.deleted.push(id); return { data: null, error: null }; },
  } } };
  const client = { auth: {
    async verifyOtp({ type, token_hash: token }) {
      if (tokens.delete(token) || (replayAccepted && type === 'recovery' && token === 'recovery')) return success();
      return { data: {}, error: { code: 'otp_expired' } };
    },
    async updateUser({ password: next }) { calls.updates.push(next); password = next; return { data: { user: { id: 'temporary-user' } }, error: null }; },
    async signOut({ scope }) { assert.equal(scope, 'global'); return { error: null }; },
    async signInWithPassword(request) {
      calls.passwords.push(request.password);
      return request.password === password ? success() : { data: {}, error: { code: oldPasswordFailure } };
    },
  } };
  return { calls, options: { admin, client, appUrl: 'https://getneeds.app', log: message => calls.logs.push(message) } };
}

test('write authorization is required; password mutation is opt-in and origins are validated', () => {
  assert.throws(() => authLinkOptions([]), /allow-test-writes/);
  assert.deepEqual(authLinkOptions(['--allow-test-writes']), { appUrl: 'http://127.0.0.1:3002', verifyPasswordUpdate: false });
  assert.deepEqual(authLinkOptions(['--allow-test-writes', '--app-url', 'https://getneeds.app/', '--verify-password-update']), { appUrl: 'https://getneeds.app', verifyPasswordUpdate: true });
  for (const value of ['http://getneeds.app', 'https://user:password@getneeds.app', 'https://getneeds.app/auth/confirm', 'https://getneeds.app/?token=x']) {
    assert.throws(() => authLinkOptions(['--allow-test-writes', `--app-url=${value}`]));
  }
  assert.throws(() => authLinkOptions(['--allow-test-writes', '--app-url']), /requires an origin/);
});

test('default verifies production tokens/replay without password mutation and revokes every issued session', async () => {
  const { calls, options } = fixture();
  await verifyAuthEmailLinks(options);
  assert.deepEqual(calls.links.map(item => item.options.redirectTo), ['https://getneeds.app/auth/confirm', 'https://getneeds.app/auth/reset-password']);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.passwords.length, 0);
  assert.deepEqual(calls.revoked, calls.sessions.map(token => ({ token, scope: 'global' })));
  assert.deepEqual(calls.deleted, ['temporary-user']);
  assert.ok(calls.logs.some(message => message.includes('SMTP acceptance, inbox delivery and browser callbacks were not tested')));
  for (const token of calls.sessions) assert.ok(calls.logs.every(message => !message.includes(token)));
});

test('password opt-in verifies old rejection and new sign-in, with accurate notification caveat', async () => {
  const { calls, options } = fixture();
  await verifyAuthEmailLinks({ ...options, verifyPasswordUpdate: true });
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.passwords.length, 2);
  assert.notEqual(calls.passwords[0], calls.passwords[1]);
  assert.equal(calls.passwords[1], calls.updates[0]);
  assert.ok(calls.logs.some(message => message.includes('may send a password-change notification')));
  assert.deepEqual(calls.revoked, calls.sessions.map(token => ({ token, scope: 'global' })));
});

test('a reused recovery token being accepted fails verification and still cleans up all sessions', async () => {
  const { calls, options } = fixture({ replayAccepted: true });
  await assert.rejects(verifyAuthEmailLinks(options), error => error.errors.some(cause => /Used recovery tokens/.test(cause.message)));
  assert.deepEqual(calls.deleted, ['temporary-user']);
  assert.equal(calls.revoked.length, 3);
});

test('transport or rate limiting cannot masquerade as old-password rejection', async () => {
  const { calls, options } = fixture({ oldPasswordFailure: 'over_request_rate_limit' });
  await assert.rejects(verifyAuthEmailLinks({ ...options, verifyPasswordUpdate: true }), error => error.errors.some(cause => /old password/.test(cause.message)));
  assert.deepEqual(calls.deleted, ['temporary-user']);
});

test('logout failures cannot prevent deletion and make verification fail', async () => {
  const { calls, options } = fixture({ logoutFails: true });
  await assert.rejects(verifyAuthEmailLinks(options), AggregateError);
  assert.deepEqual(calls.deleted, ['temporary-user']);
  assert.equal(calls.revoked.length, 2);
});

test('an already-invalidated earlier session does not prevent remaining revocation and deletion', async () => {
  const { calls, options } = fixture({ firstSessionGone: true });
  await verifyAuthEmailLinks(options);
  assert.equal(calls.revoked.length, 2);
  assert.deepEqual(calls.deleted, ['temporary-user']);
});

test('generation failure does not falsely claim an account was cleaned up', async () => {
  const { calls, options } = fixture({ generationFails: true });
  await assert.rejects(verifyAuthEmailLinks(options), AggregateError);
  assert.equal(calls.deleted.length, 0);
  assert.ok(calls.logs.includes('No temporary Auth account was created.'));
  assert.ok(!calls.logs.includes('Temporary Auth account deleted.'));
});
