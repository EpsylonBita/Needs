'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/lib/supabase/client';
import { ErrorBoundary } from '@/components/common/error-boundary';
import { ErrorFallback } from '@/components/common/error-fallbacks';

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
  register: (data: { email: string; password: string; fullName?: string; phoneNumber?: string }) => Promise<void>;
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

  // Check storage and token availability on mount
  useEffect(() => {
    const initialize = async () => {
      try {
        setIsLoading(true);
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.user) {
          await fetchUserData(session.user.id);
        }
        setIsInitialized(true);
      } catch (err) {
        setError('Failed to initialize authentication');
        setIsInitialized(true);
      } finally {
        setIsLoading(false);
      }
    };
    initialize();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event: string, sess: any) => {
      if (sess?.user) {
        await fetchUserData(sess.user.id);
      } else {
        setUser(null);
      }
    });
    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  // Function to fetch user data using the stored token
  const fetchUserData = async (userId: string) => {
    try {
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('user_id,display_name,avatar_url')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(1);

      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email || '';

      const profile = (profileRows || [])[0];
      const fullName = profile?.display_name || userData.user?.user_metadata?.fullName || '';
      const phoneNumber = userData.user?.user_metadata?.phoneNumber || '';

      setUser({ id: userId, email, fullName, phoneNumber });
    } catch (err) {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Supabase login/signup/logout
  const handleAuthResponse = async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      await fetchUserData(data.user.id);
    }
  };

  const login = async (data: { email: string; password: string }) => {
    setIsLoading(true);
    setError(null);
    const { data: res, error: signInError } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });
    if (signInError) {
      setIsLoading(false);
      setError(signInError.message);
      throw signInError;
    }
    // Let the auth state listener fetch and set user; return immediately to avoid UI stalls
    setIsLoading(false);
  };

  const register = async (data: { email: string; password: string; fullName?: string; phoneNumber?: string }) => {
    try {
      setIsLoading(true);
      setError(null);
      const { error: signUpError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: {
            fullName: data.fullName,
            phoneNumber: data.phoneNumber,
          },
        },
      });
      if (signUpError) throw signUpError;
      await handleAuthResponse();
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
      await supabase.auth.signOut();
    } catch (err) {
      // noop
    } finally {
      setUser(null);
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