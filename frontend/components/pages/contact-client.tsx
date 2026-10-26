'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';

import { ArrowRight, CheckCircle2, LifeBuoy, Loader2, MessageSquare, ShieldCheck } from 'lucide-react';

import { contactSchema } from '@/app/api/contact/validation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/contexts/i18n-context';
import { getCsrfToken } from '@/lib/utils/csrf';

type ContactField = 'firstName' | 'lastName' | 'email' | 'subject' | 'message';
class ContactRequestError extends Error {}

export default function ContactClient() {
  const { t } = useI18n();
  const id = useId();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ContactField, string>>>({});
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [messageLength, setMessageLength] = useState(0);
  const submission = useRef<{ fingerprint: string; key: string } | null>(null);
  const submitting = useRef(false);
  const status = useRef<HTMLDivElement>(null);

  useEffect(() => { if (savedMessage) status.current?.focus(); }, [savedMessage]);

  const validationMessages: Record<ContactField, string> = {
    firstName: t('contact.validation.firstName', 'Enter your first name (up to 100 characters).'),
    lastName: t('contact.validation.lastName', 'Enter your last name (up to 100 characters).'),
    email: t('auth.validation.email', 'Please enter a valid email address.'),
    subject: t('contact.validation.subject', 'Add a subject with up to 200 characters.'),
    message: t('contact.validation.message', 'Write a message with 10–5,000 characters.'),
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const parsed = contactSchema.safeParse(Object.fromEntries(new FormData(form)));
    setError(null);
    setSavedMessage(null);
    setFieldErrors({});
    if (!parsed.success) {
      const invalid: Partial<Record<ContactField, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as ContactField;
        if (field in validationMessages) invalid[field] = validationMessages[field];
      }
      setFieldErrors(invalid);
      setError(t('contact.validation.summary', 'Please check the highlighted fields.'));
      const first = form.elements.namedItem(String(parsed.error.issues[0]?.path[0]));
      if (first instanceof HTMLElement) first.focus();
      return;
    }
    submitting.current = true;
    setIsSubmitting(true);
    try {
      const fingerprint = JSON.stringify(parsed.data);
      if (!submission.current || submission.current.fingerprint !== fingerprint) {
        submission.current = { fingerprint, key: crypto.randomUUID() };
      }
      const token = await getCsrfToken().catch(() => null);
      if (!token) throw new ContactRequestError(t('contact.prepareError', 'Unable to prepare your message. Please try again.'));
      const response = await fetch('/api/contact', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token, 'Idempotency-Key': submission.current.key },
        body: JSON.stringify(parsed.data),
      });
      const result = await response.json();
      if (response.status === 429) throw new ContactRequestError(t('contact.rateLimit', 'Please wait a little before sending another message. Your draft is still here.'));
      if (!response.ok || !result.saved) throw new ContactRequestError(t('contact.saveError', 'Unable to save your message. Please try again.'));
      form.reset();
      setMessageLength(0);
      submission.current = null;
      setSavedMessage(result.notification === 'accepted'
        ? t('contact.saved.notified', 'Your message has been saved. The support email notification has been accepted for delivery.')
        : result.notification === 'pending'
          ? t('contact.saved.pending', 'Your message has been saved. The support email notification is pending.')
          : result.notification === 'unavailable'
            ? t('contact.saved.unavailable', 'Your message has been saved. Email notifications are currently unavailable.')
            : t('contact.saved', 'Your message has been saved for the support team.'));
    } catch (failure) {
      setError(failure instanceof ContactRequestError ? failure.message : t('contact.saveError', 'Unable to save your message. Please try again.'));
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  const field = (name: Exclude<ContactField, 'message'>, label: string, placeholder: string, autoComplete?: string) => <div className="space-y-2">
    <Label htmlFor={`${id}-${name}`}>{label}</Label>
    <Input id={`${id}-${name}`} name={name} type={name === 'email' ? 'email' : 'text'} autoComplete={autoComplete} disabled={isSubmitting} required maxLength={name === 'email' ? 254 : name === 'subject' ? 200 : 100} placeholder={placeholder} aria-invalid={!!fieldErrors[name]} aria-describedby={fieldErrors[name] ? `${id}-${name}-error` : undefined} className="h-12 rounded-xl bg-background px-4" />
    {fieldErrors[name] && <p id={`${id}-${name}-error`} className="text-sm text-destructive">{fieldErrors[name]}</p>}
  </div>;

  return <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16 lg:px-8">
    <header className="mb-8 max-w-2xl sm:mb-12">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary"><LifeBuoy className="h-4 w-4" aria-hidden="true" />{t('contact.eyebrow', 'Here to help')}</p>
      <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t('contact.heading', 'Let’s talk about your Needs.')}</h1>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">{t('contact.description', 'A question, a problem or an idea? Send a message to the Needs support team using the form below.')}</p>
    </header>
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10">
      <section aria-labelledby={`${id}-form-title`} className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">
        <div className="mb-7">
          <h2 id={`${id}-form-title`} className="text-xl font-semibold tracking-tight">{t('contact.formTitle', 'Send us a message')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t('contact.requiredHint', 'All fields are required. Use an email where we can reach you.')}</p>
        </div>
        <form className="space-y-5" onSubmit={handleSubmit} noValidate aria-busy={isSubmitting} aria-describedby={error ? `${id}-error` : undefined}>
          <div className="grid gap-5 sm:grid-cols-2">
            {field('firstName', t('contact.firstName', 'First Name'), t('contact.firstName.placeholder', 'Your first name'), 'given-name')}
            {field('lastName', t('contact.lastName', 'Last Name'), t('contact.lastName.placeholder', 'Your last name'), 'family-name')}
          </div>
          {field('email', t('auth.email', 'Email'), 'you@example.com', 'email')}
          {field('subject', t('contact.subject', 'Subject'), t('contact.subject.placeholder', 'What is this regarding?'))}
          <div className="space-y-2">
            <Label htmlFor={`${id}-message`}>{t('contact.message', 'Message')}</Label>
            <Textarea id={`${id}-message`} name="message" disabled={isSubmitting} required minLength={10} maxLength={5000} rows={6} onChange={event => setMessageLength(event.target.value.length)} aria-invalid={!!fieldErrors.message} aria-describedby={`${id}-message-help${fieldErrors.message ? ` ${id}-message-error` : ''}`} className="min-h-40 resize-y rounded-xl bg-background p-4" placeholder={t('contact.message.placeholder', 'Tell us how we can help...')} />
            <div id={`${id}-message-help`} className="flex justify-between gap-4 text-xs leading-relaxed text-muted-foreground"><span>{t('contact.messageHint', 'Include a listing link or the steps that led to the problem.')}</span><span className="shrink-0 tabular-nums" aria-hidden="true">{messageLength.toLocaleString()} / 5,000</span></div>
            {fieldErrors.message && <p id={`${id}-message-error`} className="text-sm text-destructive">{fieldErrors.message}</p>}
          </div>
          {error && <p id={`${id}-error`} role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}
          {savedMessage && <div ref={status} tabIndex={-1} role="status" className="flex gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" /><p>{savedMessage}</p></div>}
          <div className="flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">{t('contact.privacyHint', 'Please do not include passwords, card details or other sensitive information.')}</p>
            <Button type="submit" disabled={isSubmitting} className="h-12 shrink-0 rounded-xl px-6">{isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{t('contact.saving', 'Saving...')}</> : <>{t('contact.send', 'Send Message')}<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></>}</Button>
          </div>
        </form>
      </section>
      <aside aria-label={t('contact.helpLabel', 'Support information')} className="space-y-5">
        <div className="rounded-2xl border border-primary/10 bg-primary/5 p-6">
          <MessageSquare className="mb-4 h-6 w-6 text-primary" aria-hidden="true" />
          <h2 className="text-lg font-semibold">{t('contact.helpTitle', 'A little context goes a long way')}</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t('contact.helpBody', 'Tell us what you were trying to do and what happened. For a listing or payment question, include its reference so we can understand the issue.')}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <ShieldCheck className="mb-4 h-6 w-6 text-primary" aria-hidden="true" />
          <h2 className="text-lg font-semibold">{t('contact.accountTitle', 'Need help signing in?')}</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t('contact.accountBody', 'You can request a password reset or a new confirmation email without sending a support message.')}</p>
          <Link href="/auth/forgot-password" className="mt-3 flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('auth.forgotLink', 'Forgot password?')}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          <Link href="/auth/resend" className="flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('auth.resendLink', 'Resend confirmation')}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </div>
        <p className="px-1 text-sm leading-relaxed text-muted-foreground">{t('contact.aboutNeeds', 'Needs brings people together to share items, skills and opportunities. This form is for questions about using the platform.')}</p>
      </aside>
    </div>
  </div>;
}
