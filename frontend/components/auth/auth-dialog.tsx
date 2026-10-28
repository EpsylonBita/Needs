'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

import { ArrowRight, MapPin } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/contexts/i18n-context';

import { LoginForm } from './login-form';
import { RegisterForm } from './register-form';
import styles from './auth-dialog.module.css';

export interface AuthDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated?: () => void;
  onAwaitingConfirmation?: () => void;
  onNavigateAway?: () => void;
  purpose?: 'request' | 'offer' | 'listing' | 'conversation';
  listingTitle?: string;
  initialMode?: 'signin' | 'signup';
}

export function AuthDialog({ isOpen, onClose, onAuthenticated, onAwaitingConfirmation, onNavigateAway, purpose, listingTitle, initialMode = 'signin' }: AuthDialogProps) {
  const [mode, setMode] = useState(initialMode);
  const [busy, setBusy] = useState(false);
  const { t } = useI18n();
  const pathname = usePathname();
  const previousPath = useRef(pathname);
  const wasOpen = useRef(isOpen);
  const purposeCopy = purpose === 'request' ? t('auth.continue.request', 'Sign in to publish what you need. You will review your listing before publishing.')
    : purpose === 'offer' ? t('auth.continue.offer', 'Sign in to offer an item or service. You will review your listing before publishing.')
      : purpose === 'listing' ? t('auth.continue.listing', 'Sign in to create your listing. Nothing is published until you confirm.')
        : purpose === 'conversation' ? t('auth.continue.conversation', 'Sign in to discuss “{title}” with its creator.').replace('{title}', listingTitle || t('auth.continue.thisListing', 'this listing')) : null;

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    if (isOpen) (onNavigateAway ?? onClose)();
  }, [isOpen, onClose, onNavigateAway, pathname]);

  useEffect(() => {
    if (isOpen && !wasOpen.current) setMode(initialMode);
    wasOpen.current = isOpen;
  }, [initialMode, isOpen]);

  return <Dialog open={isOpen} onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent closeLabel={t('auth.close', 'Close')} closeDisabled={busy} className={styles.dialog} overlayClassName={styles.overlay}>
      <div className={styles.scene} aria-hidden="true">
        <div className={styles.wordmark}><span>.</span>needs</div>
        <div className={styles.sceneCopy}>
          <span className={styles.sceneLocation}><MapPin size={14} />{t('auth.scene.location', 'Athens, a little closer')}</span>
          <p className={styles.sceneTitle}>{t('auth.scene.title', 'Your neighborhood. Your people.')}</p>
          <p className={styles.sceneDescription}>{t('auth.scene.description', 'Find something you need. Share something you love.')}</p>
        </div>
      </div>
      <div className={styles.content}>
        <div className={`${styles.wordmark} ${styles.mobileBrand}`} aria-hidden="true"><span>.</span>needs</div>
        <DialogHeader className={styles.header}>
          <span className={styles.eyebrow}>{mode === 'signin' ? t('auth.signIn.cta', 'Sign in') : t('auth.register.submit', 'Create account')}</span>
          <DialogTitle className={styles.title}>{mode === 'signin' ? t('auth.welcome', 'Welcome back') : t('auth.join', 'Make room for possibilities')}</DialogTitle>
          <DialogDescription className={styles.description}>{purposeCopy ?? (mode === 'signin' ? t('auth.redesign.signInDescription', 'Sign in and pick up where you left off.') : t('auth.createAccount.desc', 'Create your account to share what you have and find what you need.'))}</DialogDescription>
        </DialogHeader>
        {mode === 'signin'
          ? <LoginForm isOpen={isOpen} onClose={onClose} onAuthenticated={onAuthenticated} onBusyChange={setBusy} />
          : <RegisterForm isOpen={isOpen} onClose={onClose} onAuthenticated={onAuthenticated} onAwaitingConfirmation={onAwaitingConfirmation} onBusyChange={setBusy} />}
        <div className={styles.switchMode}>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setMode(current => current === 'signin' ? 'signup' : 'signin')} className={styles.switchButton}>
            {mode === 'signin' ? t('auth.toggle.signup', 'Need an account? Sign up') : t('auth.toggle.signin', 'Already have an account? Sign in')}
            <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
