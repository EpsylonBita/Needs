
import { authEmailRedirectUrl } from '@/lib/auth/email-links';
import { supabase } from '@/lib/supabase/client';
import type { EmailOtpType } from '@supabase/supabase-js';

const invalidLink = 'This email link is invalid or has expired. Please request a new one.';
const emailTypes = new Set<EmailOtpType>(['signup', 'email', 'email_change', 'recovery', 'invite', 'magiclink']);

export interface AuthEmailResult {
  type: string;
  status: 'confirmed' | 'pending';
  recovery?: { userId: string; expiresAt: number };
}

function validEmail(value: string): string {
  const email = value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Please enter a valid email address');
  return email;
}

export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(validEmail(email), {
    redirectTo: authEmailRedirectUrl('/auth/reset-password'),
  });
  if (error) throw error;
}

export async function resendConfirmation(email: string): Promise<void> {
  const { error } = await supabase.auth.resend({
    type: 'signup', email: validEmail(email),
    options: { emailRedirectTo: authEmailRedirectUrl('/auth/confirm') },
  });
  if (error) throw error;
}

/** Consumes only the supplied email link; an unrelated stored session is never proof. */
export async function completeAuthEmailLink(href: string, requireRecovery = false): Promise<AuthEmailResult> {
  const url = new URL(href);
  const params = new URLSearchParams(url.search);
  new URLSearchParams(url.hash.slice(1)).forEach((value, key) => params.set(key, value));
  if (params.has('error') || params.has('error_code') || params.has('error_description')) throw new Error(invalidLink);

  let type = params.get('type') || '';
  let result;
  if (params.has('token_hash')) {
    if (!emailTypes.has(type as EmailOtpType) || (requireRecovery && type !== 'recovery')) throw new Error(invalidLink);
    result = await supabase.auth.verifyOtp({ token_hash: params.get('token_hash')!, type: type as EmailOtpType });
  } else if (params.has('code')) {
    result = await supabase.auth.exchangeCodeForSession(params.get('code')!);
    // Supabase stores the recovery intent alongside the PKCE verifier. Do not
    // infer recovery merely from the route or caller-controlled query string.
    type = 'redirectType' in result.data && result.data.redirectType === 'recovery' ? 'recovery' : 'email';
  } else if (params.has('access_token') && params.has('refresh_token')) {
    if (!emailTypes.has(type as EmailOtpType) || (requireRecovery && type !== 'recovery')) throw new Error(invalidLink);
    result = await supabase.auth.setSession({ access_token: params.get('access_token')!, refresh_token: params.get('refresh_token')! });
  } else {
    // With secure email changes Supabase may acknowledge the first of two
    // confirmations without issuing a session. Never label this as completed.
    if (!requireRecovery && params.has('message')) return { type: 'email_change', status: 'pending' };
    throw new Error(invalidLink);
  }

  if (result.error) throw new Error(invalidLink);
  if (requireRecovery && type !== 'recovery') throw new Error(invalidLink);
  if (!result.data.session || !result.data.user) {
    if (type === 'email_change' && !requireRecovery) return { type, status: 'pending' };
    throw new Error(invalidLink);
  }
  const recovery = type === 'recovery' ? {
    userId: result.data.user.id,
    expiresAt: Math.min(Date.now() + 15 * 60 * 1000, (result.data.session.expires_at || 0) * 1000),
  } : undefined;
  return { type, status: 'confirmed', recovery };
}

export async function completePasswordReset(password: string, recovery: AuthEmailResult['recovery']): Promise<void> {
  if (!recovery || recovery.expiresAt <= Date.now()) throw new Error(invalidLink);
  if (password.length < 8 || password.length > 100) throw new Error('Password must be between 8 and 100 characters');
  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user || data.user.id !== recovery.userId) throw new Error(invalidLink);
  const { data: updated, error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  if (!updated.user) throw new Error('Your password could not be updated. Please request a new reset link.');
  recovery.expiresAt = 0;
}
