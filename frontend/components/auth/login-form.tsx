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

  // Handle form submission
  const onSubmit = async (data: LoginInput) => {
    try {
      setIsLoading(true);
      setLoginError(null);
      
      await login({
        email: data.email,
        password: data.password
      });
      
      toast({
        title: t('auth.login.success.title','Login successful'),
        description: t('auth.login.success.desc','You have been logged in successfully.'),
      });
      
      // Dispatch login success event
      const loginSuccessEvent = new CustomEvent('auth:login-success', {
        detail: { email: data.email }
      });
      window.dispatchEvent(loginSuccessEvent);
      
      // Close the dialog
      onClose();
      
    } catch (error) {
      console.error('Login error:', error);
      let errorMessage = error instanceof Error ? error.message : 'An error occurred during login';
      
      if (errorMessage.includes('Network Error')) {
        errorMessage = 'Network Error: Cannot connect to the authentication server. Please ensure the backend server is running on port 3002 and check your network connection.';
      } else if (errorMessage.includes('timeout')) {
        errorMessage = 'Request timeout: The server took too long to respond. Please try again later.';
      } else if (errorMessage.includes('401')) {
        errorMessage = 'Invalid credentials. Please check your email and password.';
      } else if (errorMessage.includes('403')) {
        errorMessage = 'Access denied. You do not have permission to log in.';
      }
      
      setLoginError(errorMessage);
      toast({
        title: t('auth.login.failed.title','Login failed'),
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {loginError && (
          <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 text-sm">
            {loginError}
          </div>
        )}
        
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('auth.email','Email')}</FormLabel>
              <FormControl>
                <Input 
                  placeholder={t('auth.email.placeholder','your.email@example.com')} 
                  {...field} 
                  disabled={isLoading}
                  className="bg-background"
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
              <FormLabel>{t('auth.password','Password')}</FormLabel>
              <FormControl>
                <Input 
                  type="password" 
                  placeholder="••••••••" 
                  {...field} 
                  disabled={isLoading}
                  className="bg-background"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <div className="flex justify-between items-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground text-sm"
            disabled={isLoading}
            onClick={() => {
              form.reset();
              onClose();
            }}
          >
            {t('common.cancel','Cancel')}
          </Button>
          
          <Button type="submit" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                {t('auth.signingIn','Signing in...')}
              </>
            ) : (
              t('auth.signIn.cta','Sign in')
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
