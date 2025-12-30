'use client';

import { useState, ReactNode } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useI18n } from '@/contexts/i18n-context';

import { LoginForm } from './login-form';
import { RegisterForm } from './register-form';

interface AuthDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'signin' | 'signup';
}

function AuthFormWrapper({ title, description, children }: { 
  title: string; 
  description: string;
  children: ReactNode 
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="py-4">
        {children}
      </div>
    </>
  )
}

export function AuthDialog({ isOpen, onClose, initialMode = 'signin' }: AuthDialogProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const { t } = useI18n();

  const handleToggleMode = () => {
    setMode(prevMode => prevMode === 'signin' ? 'signup' : 'signin');
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        {mode === 'signin' ? (
          <AuthFormWrapper 
            title={t('auth.signIn','Sign In')} 
            description={t('auth.signIn.desc','Enter your credentials to sign in to your account.')}
          >
            <LoginForm isOpen={isOpen} onClose={onClose} />
          </AuthFormWrapper>
        ) : (
          <AuthFormWrapper 
            title={t('auth.createAccount','Create Account')} 
            description={t('auth.createAccount.desc','Fill out the form below to create a new account.')}
          >
            <RegisterForm isOpen={isOpen} onClose={onClose} />
          </AuthFormWrapper>
        )}
        
        <div className="mt-4 text-center">
          <button 
            onClick={handleToggleMode}
            className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            {mode === 'signin' ? t('auth.toggle.signup','Need an account? Sign up') : t('auth.toggle.signin','Already have an account? Sign in')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
