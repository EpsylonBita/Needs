'use client';

import { useState, ReactNode } from 'react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
 
import { LoginForm } from './login-form';
import { RegisterForm } from './register-form';

interface AuthDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'signin' | 'signup';
}

function AuthFormWrapper({ children }: { children: ReactNode }) {
    return (
        <>
            <DialogHeader>
                <DialogTitle>{children}</DialogTitle>
            </DialogHeader>
        </>
    )
}

export function AuthDialog({ isOpen, onClose, initialMode = 'signin' }: AuthDialogProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);

    const handleToggleMode = () => {
        setMode(prevMode => prevMode === 'signin' ? 'signup' : 'signin');
    };
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{mode === 'signin' ? 'Sign in to your account' : 'Create a new account'}</DialogTitle>
          <DialogDescription>
            {mode === 'signin' ? 'Enter your credentials to access your account' : 'Fill in your details to create a new account'}
          </DialogDescription>
        </DialogHeader>
            {mode === 'signin' ? (
                <AuthFormWrapper>
                    Sign In
                    <LoginForm isOpen={isOpen} onClose={onClose} />
                </AuthFormWrapper>
            ) : (
                <AuthFormWrapper>
                    Create Account
                    <RegisterForm isOpen={isOpen} onClose={onClose} />
                </AuthFormWrapper>

            )}
            <button onClick={handleToggleMode}>
                {mode === "signin" ? "Create Account" : "Sign In"}
            </button>
      </DialogContent>
    </Dialog>
  );
}
