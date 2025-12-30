'use client';

import { ReactNode, useEffect } from 'react';
import { ThemeProvider } from 'next-themes';
import { AuthProvider } from './auth-context';
import { ProfileProvider } from './profile-context';
import { Toaster } from '@/components/ui/toaster';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from './i18n-context';

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Centralized provider that composes all context providers
 * This ensures consistent nesting order and simplifies the layout component
 */
export function ContextProviders({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Legacy proxy health-check removed after Supabase cutover
    // Always use real backend (Supabase)
    // @ts-ignore
    window.__USE_MOCK_BACKEND = false;
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <AuthProvider>
          <ProfileProvider>
            <I18nProvider>
              {children}
            </I18nProvider>
            <Toaster />
          </ProfileProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}