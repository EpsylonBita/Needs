'use client';

import { useId, useState } from 'react';
import Link from 'next/link';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, Mail } from 'lucide-react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { useI18n } from '@/contexts/i18n-context';
import { loginSchema, type LoginInput } from '@/lib/validations/auth';
import styles from './auth-dialog.module.css';

export interface LoginFormProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated?: () => void;
  onBusyChange?: (busy: boolean) => void;
  onRegister?: () => void;
  title?: string;
}

export function LoginForm({ onClose, onAuthenticated, onBusyChange }: LoginFormProps) {
  const { login } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();
  const id = useId();
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' },
  });

  async function submit(data: LoginInput) {
    setError('');
    onBusyChange?.(true);
    try {
      await login(data);
      toast({ title: t('auth.login.success.title', 'Login successful'), description: t('auth.login.success.desc', 'You have been logged in successfully.') });
      window.dispatchEvent(new CustomEvent('auth:login-success', { detail: { email: data.email } }));
      (onAuthenticated ?? onClose)();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '';
      setError(/invalid.*(credential|login)|401/i.test(message)
        ? t('auth.error.credentials', 'The email or password is incorrect. Please try again.')
        : /not.confirmed/i.test(message)
          ? t('auth.error.unconfirmed', 'Confirm your email before signing in. You can request another email below.')
          : t('auth.error.login', 'Unable to sign in. Check your details and connection, then try again.'));
    } finally { onBusyChange?.(false); }
  }

  return <form onSubmit={handleSubmit(submit)} noValidate aria-busy={isSubmitting} className={styles.form}>
    <div className={styles.field}>
      <Label htmlFor={`${id}-email`}>{t('auth.email', 'Email')}</Label>
      <div className={styles.inputWrap}>
        <Mail size={18} aria-hidden="true" className={styles.inputIcon} />
        <Input id={`${id}-email`} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="you@example.com" {...register('email')} disabled={isSubmitting} aria-invalid={!!errors.email} aria-describedby={errors.email ? `${id}-email-error` : undefined} className={`${styles.input} ${styles.withIcon}`} />
      </div>
      {errors.email && <p id={`${id}-email-error`} role="alert" className="text-sm text-destructive">{t('auth.validation.email', 'Please enter a valid email address.')}</p>}
    </div>
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <Label htmlFor={`${id}-password`}>{t('auth.password', 'Password')}</Label>
        <Link href="/auth/forgot-password" className={styles.recoveryLink} aria-disabled={isSubmitting} tabIndex={isSubmitting ? -1 : undefined} onClick={event => { if (isSubmitting) event.preventDefault(); }}>{t('auth.forgotLink', 'Forgot password?')}</Link>
      </div>
      <div className={styles.inputWrap}>
        <LockKeyhole size={18} aria-hidden="true" className={styles.inputIcon} />
        <Input id={`${id}-password`} type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder={t('auth.password.placeholder', 'Your password')} {...register('password')} disabled={isSubmitting} aria-invalid={!!errors.password} aria-describedby={errors.password ? `${id}-password-error` : undefined} className={`${styles.input} ${styles.withIcon} ${styles.withToggle}`} />
        <button type="button" className={styles.visibilityToggle} aria-label={showPassword ? t('auth.hidePassword', 'Hide password') : t('auth.showPassword', 'Show password')} aria-pressed={showPassword} aria-controls={`${id}-password`} disabled={isSubmitting} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>
      </div>
      {errors.password && <p id={`${id}-password-error`} role="alert" className="text-sm text-destructive">{t('auth.validation.passwordRequired', 'Enter your password.')}</p>}
    </div>
    {error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm leading-relaxed text-destructive">{error}</p>}
    <Button type="submit" disabled={isSubmitting} className={styles.submit}>
      {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{t('auth.signingIn', 'Signing in...')}</> : <>{t('auth.signIn.cta', 'Sign in')}<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></>}
    </Button>
    <Link href="/auth/resend" className={styles.resendLink} aria-disabled={isSubmitting} tabIndex={isSubmitting ? -1 : undefined} onClick={event => { if (isSubmitting) event.preventDefault(); }}>{t('auth.resendLink', 'Resend confirmation')}</Link>
  </form>;
}
