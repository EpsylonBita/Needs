'use client';

import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { ErrorBoundary } from '@/components/common/error-boundary';
import { ErrorFallback } from '@/components/common/error-fallbacks';
import { authEmailRedirectUrl } from '@/lib/auth/email-links';
import { supabase } from '@/lib/supabase/client';
import type { User as SupabaseUser } from '@supabase/supabase-js';

interface User {
  id: string;
  email: string;
  fullName: string;
  phoneNumber: string;
}

interface AuthContextState {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  isInitialized: boolean;
}

interface AuthContextActions {
  login: (data: { email: string; password: string }) => Promise<void>;
  register: (data: { email: string; password: string; fullName?: string; phoneNumber?: string }) => Promise<{ requiresEmailConfirmation: boolean }>;
  logout: () => Promise<void>;
}

interface AuthContextValue extends AuthContextState, AuthContextActions {}

interface AuthProviderProps {
  children: ReactNode;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Authentication context provider
 * Handles user authentication state and provides login/logout functionality
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const authVersion = useRef(0);

  const sessionUser = (account: SupabaseUser): User => ({
    id: account.id,
    email: account.email || '',
    fullName: account.user_metadata?.fullName || '',
    phoneNumber: account.user_metadata?.phoneNumber || '',
  });

  // Check storage and token availability on mount
  useEffect(() => {
    let active = true;
    let profileTimer: ReturnType<typeof setTimeout> | undefined;
    const applySession = (account: SupabaseUser | null) => {
      const version = ++authVersion.current;
      if (profileTimer) clearTimeout(profileTimer);
      setUser(account ? sessionUser(account) : null);
      setIsInitialized(true);
      setIsLoading(false);
      if (!account) return;
      // Auth callbacks run under Supabase's session lock. Defer profile I/O
      // until the callback returns, and never call getUser from this callback.
      profileTimer = setTimeout(async () => {
        try {
          const { data, error: profileError } = await supabase.from('profiles')
            .select('display_name').eq('user_id', account.id).limit(1);
          if (active && version === authVersion.current && !profileError) {
            setUser({ ...sessionUser(account), fullName: data?.[0]?.display_name || sessionUser(account).fullName });
          }
        } catch {
          // A profile lookup failure must not erase a valid authenticated session.
        }
      }, 0);
    };
    const initialize = async () => {
      const version = authVersion.current;
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (active && version === authVersion.current) applySession(session?.user ?? null);
      } catch (err) {
        if (active && version === authVersion.current) {
          setError('Failed to initialize authentication');
          applySession(null);
        }
      }
    };
    initialize();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) applySession(session?.user ?? null);
    });
    return () => {
      active = false;
      ++authVersion.current;
      if (profileTimer) clearTimeout(profileTimer);
      authListener.subscription.unsubscribe();
    };
  }, []);

  const login = async (data: { email: string; password: string }) => {
    setIsLoading(true);
    setError(null);
    try {
      const { data: res, error: signInError } = await supabase.auth.signInWithPassword(data);
      if (signInError) throw signInError;
      if (res.user) setUser(sessionUser(res.user));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (data: { email: string; password: string; fullName?: string; phoneNumber?: string }) => {
    try {
      setIsLoading(true);
      setError(null);
      const { data: result, error: signUpError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          emailRedirectTo: authEmailRedirectUrl('/auth/confirm'),
          data: {
            fullName: data.fullName,
            phoneNumber: data.phoneNumber,
          },
        },
      });
      if (signUpError) throw signUpError;
      if (result.session?.user) setUser(sessionUser(result.session.user));
      return { requiresEmailConfirmation: !result.session };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      setIsLoading(true);
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      ++authVersion.current;
      setUser(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign out failed');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  // Value object to provide through context
  const value: AuthContextValue = {
    user,
    isLoading,
    error,
    isInitialized,
    login,
    register,
    logout
  };

  return (
    <ErrorBoundary
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <ErrorFallback
            error={new Error('Authentication system error')}
            resetError={() => window.location.reload()}
            title="Authentication Error"
            description="There was an error initializing the authentication system. Please refresh the page."
          />
        </div>
      }
    >
      <AuthContext.Provider value={value}>
        {children}
      </AuthContext.Provider>
    </ErrorBoundary>
  );
}

/**
 * Hook to access auth context
 * @throws Error if used outside of AuthProvider
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
