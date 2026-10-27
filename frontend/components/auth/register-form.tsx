'use client';

import { useId, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { useI18n } from '@/contexts/i18n-context';
import { registerSchema, type RegisterInput } from '@/lib/validations/auth';
import styles from './auth-dialog.module.css';

export interface RegisterFormProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated?: () => void;
  onBusyChange?: (busy: boolean) => void;
  onBackToLogin?: () => void;
  title?: string;
}

export function RegisterForm({ isOpen, onClose, onAuthenticated, onBusyChange }: RegisterFormProps) {
  const { register: signUp } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();
  const id = useId();
  const [error, setError] = useState('');
  const [visiblePasswords, setVisiblePasswords] = useState({ password: false, confirmPassword: false });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: '', email: '', phoneNumber: '', password: '', confirmPassword: '' },
  });

  const fields = [
    { name: 'fullName', label: t('auth.fullName', 'Full name'), type: 'text', autoComplete: 'name', placeholder: t('auth.fullName.placeholder', 'Your full name'), validation: t('auth.validation.name', 'Enter a name with at least 2 and at most 50 characters.') },
    { name: 'email', label: t('auth.email', 'Email'), type: 'email', autoComplete: 'email', placeholder: 'you@example.com', validation: t('auth.validation.email', 'Please enter a valid email address.') },
    { name: 'phoneNumber', label: t('auth.phoneNumber', 'Phone number'), type: 'tel', autoComplete: 'tel', placeholder: '+306991234567', hint: t('auth.phoneHint', 'Include the country code, for example +306991234567.'), validation: t('auth.validation.phone', 'Enter a valid international phone number without spaces (10–15 characters).') },
    { name: 'password', label: t('auth.password', 'Password'), type: 'password', autoComplete: 'new-password', hint: t('auth.passwordHint', 'Use 8–100 characters with uppercase and lowercase letters, a number and a symbol (@$!%*?&).'), validation: t('auth.validation.password', 'Use 8–100 characters with uppercase and lowercase letters, a number and a symbol (@$!%*?&).') },
    { name: 'confirmPassword', label: t('auth.confirmPassword', 'Confirm password'), type: 'password', autoComplete: 'new-password', validation: t('auth.validation.confirmPassword', 'Passwords do not match.') },
  ] as const;

  async function submit(data: RegisterInput) {
    setError('');
    onBusyChange?.(true);
    try {
      const result = await signUp(data);
      // Email confirmation still needs instructions; an authenticated continuation has its own next screen.
      if (result.requiresEmailConfirmation || !onAuthenticated) toast({ title: t('auth.register.success', 'Account created'), description: result.requiresEmailConfirmation
        ? t('auth.register.confirm', 'Check your email to confirm your account before signing in.')
        : t('auth.register.ready', 'Your account is ready. Welcome to Needs.') });
      if (result.requiresEmailConfirmation) onClose();
      else (onAuthenticated ?? onClose)();
    } catch {
      setError(t('auth.error.register', 'Unable to create your account. Check your details and try again. If you already have an account, sign in or reset your password.'));
    } finally { onBusyChange?.(false); }
  }

  if (!isOpen) return null;
  return <form onSubmit={handleSubmit(submit)} noValidate aria-busy={isSubmitting} className={`${styles.form} ${styles.registrationForm}`}>
    {fields.map(field => {
      const inputId = `${id}-${field.name}`;
      const invalid = !!errors[field.name];
      const hint = 'hint' in field ? field.hint : undefined;
      const passwordField = field.name === 'password' || field.name === 'confirmPassword' ? field.name : null;
      const visible = passwordField ? visiblePasswords[passwordField] : false;
      const toggleLabel = passwordField === 'confirmPassword'
        ? visible ? t('auth.hidePasswordConfirmation', 'Hide password confirmation') : t('auth.showPasswordConfirmation', 'Show password confirmation')
        : visible ? t('auth.hidePassword', 'Hide password') : t('auth.showPassword', 'Show password');
      return <div key={field.name} className={styles.field}>
        <Label htmlFor={inputId}>{field.label}</Label>
        <div className={styles.inputWrap}>
          <Input id={inputId} type={visible ? 'text' : field.type} autoComplete={field.autoComplete} placeholder={'placeholder' in field ? field.placeholder : undefined} {...register(field.name, field.name === 'phoneNumber' ? { setValueAs: (value: string) => value.replace(/[\s()-]/g, '') } : undefined)} disabled={isSubmitting} aria-invalid={invalid} aria-describedby={invalid ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined} className={`${styles.input} ${passwordField ? styles.withToggle : ''}`} />
          {passwordField && <button type="button" className={styles.visibilityToggle} aria-label={toggleLabel} aria-pressed={visible} aria-controls={inputId} disabled={isSubmitting} onClick={() => setVisiblePasswords(current => ({ ...current, [passwordField]: !current[passwordField] }))}>{visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>}
        </div>
        {invalid ? <p id={`${inputId}-error`} role="alert" className="text-sm text-destructive">{field.validation}</p> : hint ? <p id={`${inputId}-hint`} className="text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
      </div>;
    })}
    {error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm leading-relaxed text-destructive">{error}</p>}
    <Button type="submit" disabled={isSubmitting} className={styles.submit}>
      {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{t('auth.register.busy', 'Creating account...')}</> : <>{t('auth.register.submit', 'Create account')}<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></>}
    </Button>
  </form>;
}
