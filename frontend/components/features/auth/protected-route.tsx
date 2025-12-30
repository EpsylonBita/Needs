'use client';

import { useEffect, useState } from "react";

import { useRouter } from "next/navigation";

import { Loader2 } from "lucide-react";

import { useAuth } from "@/contexts/auth-context";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [hasLocalStorageUser, setHasLocalStorageUser] = useState(false);
  const [checkingLocalStorage, setCheckingLocalStorage] = useState(true);

  // First check auth context
  useEffect(() => {
    // Only run in browser environment 
    if (typeof window === 'undefined') {
      setCheckingLocalStorage(false);
      return;
    }
    
    // If user is already authenticated via context, no need to check localStorage
    if (user) {
      setCheckingLocalStorage(false);
      return;
    }

    // Only check localStorage if auth context has loaded and user is null
    if (!isLoading && !user) {
      // Check localStorage as fallback
      try {
        const userEventData = localStorage.getItem('userEvent.login');
        if (userEventData) {
          const { user: localUser, timestamp } = JSON.parse(userEventData);
          const ageInMinutes = (Date.now() - timestamp) / (1000 * 60);
          
          // Only use if data is less than 30 minutes old
          if (ageInMinutes < 30 && localUser && localUser.email) {
            console.log('Found valid user data in localStorage for protected route:', localUser.email);
            setHasLocalStorageUser(true);
          } else {
            // Redirect if no valid user data found
            router.replace('/');
          }
        } else {
          // Redirect if no localStorage data
          router.replace('/');
        }
      } catch (error) {
        console.error('Error checking localStorage in protected route:', error);
        router.replace('/');
      }
      
      setCheckingLocalStorage(false);
    }
  }, [user, isLoading, router]);

  // Main rendering logic
  if (isLoading || checkingLocalStorage) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Allow access if either auth context has user OR we found valid user in localStorage
  if (!user && !hasLocalStorageUser) {
    return null;
  }

  return <>{children}</>;
} 
