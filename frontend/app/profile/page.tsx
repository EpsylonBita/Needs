"use client"

import { Suspense } from "react"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertCircle } from "lucide-react"

import { ErrorBoundary } from "@/components/common/error-boundary"
import { ErrorFallback } from "@/components/common/error-fallbacks"
import { ProtectedRoute } from "@/components/features/auth/protected-route"
import { ProfileHeader } from "@/components/features/profile/profile-header"
import { ProfileShell } from "@/components/features/profile/profile-shell"
import { ProfileStats } from "@/components/features/profile/profile-stats"
import { ProfileTabs } from "@/components/features/profile/profile-tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/components/ui/use-toast"
import { profileService, type ProfileData, type UpdateProfileData } from "@/lib/services/profile-service"

function ProfilePageContent() {
  const { toast } = useToast()

  // Use React Query for profile data
  const queryClient = useQueryClient()
  const { 
    data: _profile, 
    isLoading: _isLoading, 
    isError, 
    error,
    refetch: _refetch 
  } = useQuery<ProfileData>({
    queryKey: ['profile'],
    queryFn: async () => {
      console.log('ProfilePage - Fetching profile...');
      try {
        const result = await profileService.getProfile();
        console.log('ProfilePage - Profile fetched successfully:', result);
        return result;
      } catch (error) {
        console.error('ProfilePage - Error fetching profile:', error);
        throw error;
      }
    },
    staleTime: 60_000,
  })

  // Use mutation for profile updates
  const { mutate: updateProfile } = useMutation({
    mutationFn: (data: UpdateProfileData) => profileService.updateProfile(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] })
      toast({ title: "Success", description: "Profile updated successfully" })
    },
    onError: (e: unknown) => {
      const err = e as { message?: string } | Error
      toast({ title: "Error", description: (err as { message?: string })?.message || "Failed to update profile", variant: "destructive" })
    }
  })

  const _handleProfileUpdate = (data: UpdateProfileData) => {
    if (!data || Object.keys(data).length === 0) {
      toast({
        title: "Error",
        description: "No changes to update",
        variant: "destructive"
      })
      return
    }

    // Optimistic update handled by React Query
    updateProfile(data)
  }

  return (
    <ProtectedRoute>
      <ProfileShell>
        <Suspense fallback={<ProfileHeaderSkeleton />}>
          <ProfileHeader />
        </Suspense>
        
        <div className="mt-6">
          <Suspense fallback={<ProfileStatsSkeleton />}>
            <ProfileStats />
          </Suspense>
        </div>
        
        {isError && (
          <Alert variant="destructive" className="mt-6">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>
              {error instanceof Error ? error.message : "Failed to load profile data"}
            </AlertDescription>
          </Alert>
        )}
        
        <div className="mt-6">
          <Suspense fallback={<ProfileTabsSkeleton />}>
            <ProfileTabs />
          </Suspense>
        </div>
      </ProfileShell>
    </ProtectedRoute>
  )
}

export default function ProfilePage() {
  return (
    <ErrorBoundary
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <ErrorFallback
            error={new Error('Profile loading error')}
            resetError={() => window.location.reload()}
            title="Profile Error"
            description="There was an error loading your profile. Please refresh the page."
          />
        </div>
      }
    >
      <ProfilePageContent />
    </ErrorBoundary>
  )
}

// Skeleton loaders for better loading experience
function ProfileHeaderSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-[250px] w-full rounded-lg" />
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
    </div>
  )
}

function ProfileStatsSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-4">
      <Skeleton className="h-20 rounded-lg" />
      <Skeleton className="h-20 rounded-lg" />
      <Skeleton className="h-20 rounded-lg" />
    </div>
  )
}

function ProfileTabsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b">
        <Skeleton className="h-10 w-20" />
        <Skeleton className="h-10 w-20" />
        <Skeleton className="h-10 w-20" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  )
}
