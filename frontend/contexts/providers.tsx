'use client';

import { ReactNode, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { AuthProvider } from './auth-context';
import { I18nProvider } from './i18n-context';
import { ProfileProvider } from './profile-context';

// Create a client
const createQueryClient = () => new QueryClient({
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
export function ContextProviders({ children, nonce, initialLocale }: { children: ReactNode; nonce?: string; initialLocale?: string }) {
  const [queryClient] = useState(createQueryClient);
  useEffect(() => {
    // Legacy proxy health-check removed after Supabase cutover
    // Always use real backend (Supabase)
    // @ts-ignore
    window.__USE_MOCK_BACKEND = false;
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem nonce={nonce}>
        <AuthProvider>
          <ProfileProvider>
            <I18nProvider initialLocale={initialLocale}>
              <NuqsAdapter>{children}</NuqsAdapter>
            </I18nProvider>
          </ProfileProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
