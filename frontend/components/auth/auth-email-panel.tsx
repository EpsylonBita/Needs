'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { ArrowLeft, CheckCircle2, Loader2, Mail } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/contexts/i18n-context';
import { useAuth } from '@/contexts/auth-context';
import { clearAuthContinuation, readAuthContinuation } from '@/lib/auth/return-path';
import {
  completeAuthEmailLink, completePasswordReset, requestPasswordReset, resendConfirmation,
  type AuthEmailResult,
} from '@/lib/services/auth-email-service';

type RequestMode = 'forgot' | 'resend';
type PanelMode = RequestMode | 'confirm' | 'reset';
const noticeClass = 'rounded-xl border border-border bg-muted/50 p-4 text-sm leading-relaxed text-muted-foreground';
const errorClass = 'rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm leading-relaxed text-destructive';

function emailError(failure: unknown, locale: string, fallback: string, t: (key: string, fallback: string) => string) {
  const message = failure instanceof Error ? failure.message : '';
  if (/rate.limit|too.many.requests|security purposes/i.test(message)) return t('auth.email.rateLimit', 'Please wait a little before requesting another email.');
  if (/different|same.password/i.test(message)) return t('auth.email.differentPassword', 'Password must be different from your current password.');
  return locale === 'el' || !message ? fallback : message;
}

export function AuthEmailRequestForm({ mode, initialEmail = '' }: { mode: RequestMode; initialEmail?: string }) {
  const { t, locale } = useI18n();
  const id = useId();
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || cooldown) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await (mode === 'forgot' ? requestPasswordReset(email) : resendConfirmation(email));
      setNotice(mode === 'forgot'
        ? t('auth.email.resetNotice', 'If an account exists for this address, you will receive a password reset email. Check your inbox and spam folder.')
        : t('auth.email.confirmNotice', 'If this address has an unconfirmed account, you will receive a confirmation email. Check your inbox and spam folder.'));
      setCooldown(60);
    } catch (failure) {
      setError(emailError(failure, locale, t('auth.email.requestError', 'The email could not be requested. Please try again.'), t));
    } finally { setBusy(false); }
  }

  return <form onSubmit={submit} aria-busy={busy} aria-describedby={error ? `${id}-error` : undefined} className="space-y-5">
    <div className="space-y-2">
      <Label htmlFor={`${id}-email`}>{t('auth.email', 'Email')}</Label>
      <Input id={`${id}-email`} type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="you@example.com" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} disabled={busy} className="h-12 rounded-xl bg-background px-4" />
    </div>
    {error && <p id={`${id}-error`} role="alert" className={errorClass}>{error}</p>}
    {notice && <p role="status" className={noticeClass}>{notice}</p>}
    <Button type="submit" disabled={busy || cooldown > 0} className="min-h-12 h-auto w-full whitespace-normal rounded-xl py-3">
      {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
      {busy ? t('auth.email.requesting', 'Requesting email...') : cooldown ? t('auth.email.cooldown', 'Try again in {seconds}s').replace('{seconds}', String(cooldown)) : mode === 'forgot' ? t('auth.email.sendReset', 'Send reset link') : t('auth.email.resend', 'Resend confirmation email')}
    </Button>
  </form>;
}

function EmailLinkForm({ mode }: { mode: 'confirm' | 'reset' }) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const id = useId();
  const request = useRef<Promise<AuthEmailResult> | null>(null);
  const confirmationInput = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<AuthEmailResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let active = true;
    // StrictMode must not consume the same one-time link twice.
    request.current ??= completeAuthEmailLink(window.location.href, mode === 'reset');
    request.current.then(value => { if (active) setResult(value); })
      .catch(() => { if (active) setError('expired'); })
      .finally(() => {
        if (!active) return;
        window.history.replaceState(window.history.state, '', window.location.pathname);
        setLoading(false);
      });
    return () => { active = false; };
  }, [mode]);

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    if (busy || completed) return;
    if (password !== confirmation) {
      setMismatch(true);
      setError(t('auth.email.passwordMismatch', 'Passwords do not match'));
      confirmationInput.current?.focus();
      return;
    }
    setMismatch(false);
    setBusy(true);
    setError('');
    try {
      await completePasswordReset(password, result?.recovery);
      setPassword('');
      setConfirmation('');
      setCompleted(true);
    } catch (failure) {
      setError(emailError(failure, locale, t('auth.email.passwordError', 'Your password could not be updated. Please try again.'), t));
    } finally { setBusy(false); }
  }

  const continuation = readAuthContinuation(user?.id);
  const continueLink = <Button asChild className="h-12 w-full rounded-xl"><Link href={continuation || '/dashboard'} onClick={clearAuthContinuation}>{continuation ? t('auth.continue.action', 'Continue where you left off') : t('auth.email.continue', 'Continue to your account')}</Link></Button>;
  if (loading) return <p role="status" className={`${noticeClass} flex items-center gap-3`}><Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden="true" />{t('auth.email.checking', 'Checking your email link...')}</p>;
  if (completed) return <div className="space-y-5"><p role="status" className={`${noticeClass} flex items-center gap-3`}><CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />{t('auth.email.passwordSaved', 'Your password has been updated.')}</p>{continueLink}</div>;
  if (result?.recovery) return <form onSubmit={savePassword} aria-busy={busy} aria-describedby={error ? `${id}-error` : undefined} className="space-y-5">
    <div className="space-y-2">
      <Label htmlFor={`${id}-password`}>{t('auth.email.newPassword', 'New password')}</Label>
      <Input id={`${id}-password`} type="password" autoComplete="new-password" minLength={8} maxLength={100} required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} aria-describedby={`${id}-hint`} className="h-12 rounded-xl bg-background px-4" />
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">{t('auth.email.passwordHint', 'Choose a password with 8–100 characters.')}</p>
    </div>
    <div className="space-y-2">
      <Label htmlFor={`${id}-confirm`}>{t('auth.email.confirmPassword', 'Confirm new password')}</Label>
      <Input id={`${id}-confirm`} ref={confirmationInput} type="password" autoComplete="new-password" minLength={8} maxLength={100} required value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} aria-invalid={mismatch} aria-describedby={mismatch ? `${id}-error` : undefined} className="h-12 rounded-xl bg-background px-4" />
    </div>
    {error && <p id={`${id}-error`} role="alert" className={errorClass}>{error}</p>}
    <Button type="submit" disabled={busy} className="h-12 w-full rounded-xl">{busy ? t('auth.email.saving', 'Saving...') : t('auth.email.savePassword', 'Save new password')}</Button>
  </form>;
  if (result) return <div className="space-y-5">
    <p role="status" className={noticeClass}>{result.status === 'pending'
      ? t('auth.email.changePending', 'Your email change may require confirmation from both addresses. Please open the confirmation email sent to your other address to finish.')
      : t('auth.email.confirmed', 'Your email has been confirmed.')}</p>
    {continueLink}
  </div>;
  return <div className="space-y-5">
    <p role="alert" className={errorClass}>{t('auth.email.expired', 'This email link is invalid or has expired. Please request a new one.')}</p>
    <Button asChild className="h-12 w-full rounded-xl"><Link href={mode === 'reset' ? '/auth/forgot-password' : '/auth/resend'}>{t('auth.email.requestNew', 'Request a new email')}</Link></Button>
    {mode === 'confirm' && <p className="text-sm leading-relaxed text-muted-foreground">{t('auth.email.changeHelp', 'For an email address change, sign in and save your new address again in your profile.')}</p>}
  </div>;
}

export function AuthEmailPanel({ mode }: { mode: PanelMode }) {
  const router = useRouter();
  const { t } = useI18n();
  const titles = { forgot: t('auth.email.forgotTitle', 'Reset your password'), resend: t('auth.email.resendTitle', 'Confirm your email'), confirm: t('auth.email.confirmTitle', 'Email confirmation'), reset: t('auth.email.resetTitle', 'Set a new password') };
  const descriptions = { forgot: t('auth.email.forgotDescription', 'Enter your account email to request a reset link.'), resend: t('auth.email.resendDescription', 'Request another confirmation email for your account.'), confirm: t('auth.email.confirmDescription', 'Complete the request from your email.'), reset: t('auth.email.resetDescription', 'Choose a new password for your account.') };
  return <Dialog open onOpenChange={open => { if (!open) router.replace('/login'); }}>
    <DialogContent closeLabel={t('auth.close', 'Close')} className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[440px] gap-6 overflow-y-auto rounded-2xl border-border bg-card p-6 shadow-xl sm:rounded-2xl sm:p-8">
      <DialogHeader className="space-y-3 text-left">
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden="true"><Mail className="h-5 w-5" /></div>
        <DialogTitle className="pr-6 text-2xl font-semibold tracking-tight">{titles[mode]}</DialogTitle>
        <DialogDescription className="leading-relaxed text-muted-foreground">{descriptions[mode]}</DialogDescription>
      </DialogHeader>
      {mode === 'forgot' || mode === 'resend' ? <AuthEmailRequestForm mode={mode} /> : <EmailLinkForm mode={mode} />}
      <Link href="/login" className="flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t('auth.email.back', 'Back to sign in')}</Link>
    </DialogContent>
  </Dialog>;
}
