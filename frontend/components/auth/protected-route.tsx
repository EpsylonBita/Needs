'use client';

import { useEffect } from "react";

import { useRouter } from "next/navigation";
 
import { Loader2 } from "lucide-react";

import { useAuth } from "@/contexts/auth-context";

/**
 * Props for the ProtectedRoute component
 */
export interface ProtectedRouteProps {
  /** The content to render when the user is authenticated */
  children: React.ReactNode;
  /** Optional redirect path when user is not authenticated (defaults to '/') */
  redirectTo?: string;
  /** Optional custom loading component */
  loadingComponent?: React.ReactNode;
  /** Optional function to determine if the user has required permissions */
  hasPermission?: (user: unknown) => boolean;
}

/**
 * ProtectedRoute Component
 * 
 * Protects a route by requiring authentication.
 * Redirects unauthenticated users to the specified path.
 */
export function ProtectedRoute({ 
  children, 
  redirectTo = '/',
  loadingComponent,
  hasPermission,
}: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Only redirect if not loading and user is not authenticated
    if (!isLoading && !user) {
      router.replace(redirectTo);
    }
    
    // If permission check is provided, redirect if user doesn't have permission
    if (!isLoading && user && hasPermission && !hasPermission(user)) {
      router.replace(redirectTo);
    }
  }, [user, isLoading, router, redirectTo, hasPermission]);

  // Show loading state
  if (isLoading) {
    return loadingComponent || (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Don't render children if user is not authenticated
  if (!user) {
    return null;
  }
  
  // Don't render children if user doesn't have permission
  if (hasPermission && !hasPermission(user)) {
    return null;
  }

  // Render children if authenticated and has permission
  return <>{children}</>;
} 
