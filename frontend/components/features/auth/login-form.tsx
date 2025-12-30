"use client";

import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from "lucide-react";
import { useForm } from 'react-hook-form';

import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from '@/contexts/auth-context';
import { useI18n } from '@/contexts/i18n-context';
import { loginSchema, type LoginInput } from '@/lib/validations/auth';

/**
 * Login form props interface
 */
export interface LoginFormProps {
  /** Controls visibility of the login modal */
  isOpen: boolean;
  /** Handler to close the login modal */
  onClose: () => void;
  /** Optional handler to switch to registration form */
  onRegister?: () => void;
  /** Optional title for the login dialog */
  title?: string;
}

/**
 * LoginForm Component
 * 
 * A form component for user authentication, featuring email/password login.
 */
export function LoginForm({ 
  isOpen: _isOpen, 
  onClose 
}: LoginFormProps) {
  const { login } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const { t } = useI18n();

  // Initialize form with validation
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: ''
    }
  });

  const onSubmit = async (data: LoginInput) => {
    setIsLoading(true);
    setLoginError(null);
    
    try {
      await login({ email: data.email, password: data.password });
      toast({
        title: t('login.success'),
        description: t('login.welcome_back')
      });
      onClose();
      form.reset();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('login.unexpected_error');
      setLoginError(errorMessage);
      toast({
        variant: "destructive",
        title: t('login.error'),
        description: errorMessage
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {loginError && (
          <div className="text-sm text-red-500 bg-red-50 p-3 rounded-md">
            {loginError}
          </div>
        )}
        
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('auth.email')}</FormLabel>
              <FormControl>
                <Input 
                  type="email" 
                  placeholder={t('auth.email_placeholder')} 
                  {...field} 
                  disabled={isLoading}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('auth.password')}</FormLabel>
              <FormControl>
                <Input 
                  type="password" 
                  placeholder={t('auth.password_placeholder')} 
                  {...field} 
                  disabled={isLoading}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <Button 
          type="submit" 
          className="w-full" 
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              {t('auth.signing_in')}
            </>
          ) : (
            t('auth.sign_in')
          )}
        </Button>
      </form>
    </Form>
  );
}
