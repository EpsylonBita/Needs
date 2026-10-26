import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(), resend: vi.fn(), verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(), setSession: vi.fn(), getSession: vi.fn(),
  getUser: vi.fn(), updateUser: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth } }));

import { authEmailRedirectUrl, handlesAuthEmailUrl } from '@/lib/auth/email-links';
import { completeAuthEmailLink, completePasswordReset, requestPasswordReset, resendConfirmation } from '@/lib/services/auth-email-service';

const success = () => ({ data: { user: { id: 'recovery-user' }, session: { expires_at: Date.now() / 1000 + 3600 } }, error: null });
const link = (parameters: string) => `http://localhost:3000/auth/reset-password${parameters}`;

beforeEach(() => {
  vi.resetAllMocks();
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  auth.resend.mockResolvedValue({ error: null });
  auth.verifyOtp.mockResolvedValue(success());
  auth.setSession.mockResolvedValue(success());
  auth.exchangeCodeForSession.mockResolvedValue({ ...success(), data: { ...success().data, redirectType: 'recovery' } });
  auth.getUser.mockResolvedValue({ data: { user: { id: 'recovery-user' } }, error: null });
  auth.updateUser.mockResolvedValue({ data: { user: { id: 'recovery-user' } }, error: null });
});

describe('auth email requests', () => {
  it('uses exact same-origin callback destinations', async () => {
    await requestPasswordReset(' person@example.com ');
    await resendConfirmation('person@example.com');
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('person@example.com', { redirectTo: `${window.location.origin}/auth/reset-password` });
    expect(auth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'person@example.com', options: { emailRedirectTo: `${window.location.origin}/auth/confirm` } });
    expect(authEmailRedirectUrl('/auth/confirm', 'https://needs.example/something')).toBe('https://needs.example/auth/confirm');
    expect(() => authEmailRedirectUrl('/auth/confirm', 'javascript:alert(1)')).toThrow('invalid');
  });

  it('rejects invalid addresses before contacting the provider', async () => {
    await expect(requestPasswordReset('bad')).rejects.toThrow('valid email');
    await expect(resendConfirmation('bad')).rejects.toThrow('valid email');
    expect(auth.resend).not.toHaveBeenCalled();
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('propagates rate limiting and email provider failure', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: new Error('Please wait before requesting another email') });
    auth.resend.mockResolvedValue({ error: new Error('Email service unavailable') });
    await expect(requestPasswordReset('person@example.com')).rejects.toThrow('Please wait');
    await expect(resendConfirmation('person@example.com')).rejects.toThrow('Email service unavailable');
  });
});

describe('email link completion', () => {
  it.each(['', '?error=access_denied&error_code=otp_expired', '#error=access_denied&error_description=Expired', '?type=recovery', '?token_hash=x&type=unexpected'])('rejects missing or expired link %s without accepting an existing session', async suffix => {
    auth.getSession.mockResolvedValue(success());
    await expect(completeAuthEmailLink(link(suffix), true)).rejects.toThrow('invalid or has expired');
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(auth.setSession).not.toHaveBeenCalled();
  });

  it('verifies token hashes and binds the recovery grant to that user', async () => {
    const result = await completeAuthEmailLink(link('?token_hash=one-time-hash&type=recovery'), true);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'one-time-hash', type: 'recovery' });
    expect(result.recovery?.userId).toBe('recovery-user');
    expect(result.recovery!.expiresAt).toBeGreaterThan(Date.now());
  });

  it('exchanges implicit callback credentials without exposing them in errors', async () => {
    await completeAuthEmailLink(link('#access_token=access-secret&refresh_token=refresh-secret&type=recovery'), true);
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'access-secret', refresh_token: 'refresh-secret' });
    auth.setSession.mockResolvedValue({ data: { session: null, user: null }, error: new Error('access-secret') });
    await expect(completeAuthEmailLink(link('#access_token=access-secret&refresh_token=refresh-secret&type=recovery'), true)).rejects.not.toThrow('access-secret');
  });

  it('accepts PKCE recovery intent from the stored verifier, not an untrusted type parameter', async () => {
    expect((await completeAuthEmailLink(link('?code=one-time-code'), true)).recovery).toBeDefined();
    auth.exchangeCodeForSession.mockResolvedValue({ ...success(), data: { ...success().data, redirectType: null } });
    await expect(completeAuthEmailLink(link('?code=signup-code&type=recovery'), true)).rejects.toThrow('invalid or has expired');
  });

  it('does not accept a signup link as a password reset', async () => {
    await expect(completeAuthEmailLink(link('?token_hash=signup&type=signup'), true)).rejects.toThrow('invalid or has expired');
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('reports secure email change awaiting its second confirmation as pending', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: null, user: null }, error: null });
    expect(await completeAuthEmailLink(link('?token_hash=email-change&type=email_change'))).toEqual({ type: 'email_change', status: 'pending' });
    expect(await completeAuthEmailLink(link('?message=Confirmation+accepted'))).toEqual({ type: 'email_change', status: 'pending' });
  });

  it('returns no recovery capability from a normal confirmation', async () => {
    expect((await completeAuthEmailLink(link('?token_hash=signup&type=email'))).recovery).toBeUndefined();
    expect(handlesAuthEmailUrl('/auth/confirm')).toBe(true);
    expect(handlesAuthEmailUrl('/auth/reset-password/')).toBe(true);
    expect(handlesAuthEmailUrl('/')).toBe(false);
  });
});

describe('password update authorization', () => {
  it('updates only the same user authorized by the valid recovery link', async () => {
    const result = await completeAuthEmailLink(link('?token_hash=valid&type=recovery'), true);
    await completePasswordReset('NewPassword!1', result.recovery);
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'NewPassword!1' });
    await expect(completePasswordReset('NewPassword!2', result.recovery)).rejects.toThrow('invalid or has expired');
    expect(auth.updateUser).toHaveBeenCalledTimes(1);
  });

  it('rejects missing/expired recovery authorization and a switched account', async () => {
    await expect(completePasswordReset('NewPassword!1', undefined)).rejects.toThrow('invalid or has expired');
    await expect(completePasswordReset('NewPassword!1', { userId: 'recovery-user', expiresAt: Date.now() - 1 })).rejects.toThrow('invalid or has expired');
    await expect(completePasswordReset('NewPassword!1', { userId: 'another-user', expiresAt: Date.now() + 60000 })).rejects.toThrow('invalid or has expired');
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('surfaces password update rejection and rejects too short passwords', async () => {
    const grant = { userId: 'recovery-user', expiresAt: Date.now() + 60000 };
    await expect(completePasswordReset('short', grant)).rejects.toThrow('between 8 and 100');
    auth.updateUser.mockResolvedValue({ error: new Error('Password must be different') });
    await expect(completePasswordReset('NewPassword!1', grant)).rejects.toThrow('must be different');
  });
});
