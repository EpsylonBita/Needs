'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { profileService, ProfileData, UpdateProfileData } from '@/lib/services/profile-service';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from './auth-context';

interface ProfileContextState {
  profile: ProfileData | null;
  isLoading: boolean;
  error: Error | null;
  isAuthenticated: boolean;
}

interface ProfileContextActions {
  refreshProfile: () => Promise<void>;
  updateProfile: (data: UpdateProfileData) => Promise<void>;
}

interface ProfileContextValue extends ProfileContextState, ProfileContextActions {}

interface ProfileProviderProps {
  children: ReactNode;
}

const ProfileContext = createContext<ProfileContextValue | undefined>(undefined);

/**
 * Profile context provider
 * Manages user profile data and provides update functionality
 */
export function ProfileProvider({ children }: ProfileProviderProps) {
  const { user, isInitialized } = useAuth();
  const userId = user?.id;
  const currentUserId = useRef(userId);
  currentUserId.current = userId;
  const requestVersion = useRef(0);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { toast } = useToast();

  const fetchProfile = useCallback(async () => {
    const version = ++requestVersion.current;
    const isCurrent = () => version === requestVersion.current && currentUserId.current === userId;
    setError(null);
    if (!isInitialized || !userId) {
      setProfile(null);
      setIsLoading(!isInitialized);
      return;
    }
    try {
      setIsLoading(true);
      const data = await profileService.getProfile();
      if (isCurrent() && data.userId === userId) setProfile(data);
    } catch (err) {
      if (isCurrent()) {
        setError(err instanceof Error ? err : new Error('Failed to load profile'));
        setProfile(null);
      }
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, [isInitialized, userId]);

  const updateProfileData = async (data: UpdateProfileData) => {
    if (!userId) throw new Error('Not authenticated');
    // A pending upload may still hold a callback from a previous account.
    if (currentUserId.current !== userId) throw new Error('Your session changed. Please try again.');
    const version = ++requestVersion.current;
    const isCurrent = () => version === requestVersion.current && currentUserId.current === userId;
    try {
      setIsLoading(true);
      setError(null);
      const updatedProfile = await profileService.updateProfile(data, userId);
      if (currentUserId.current !== userId || updatedProfile.userId !== userId) throw new Error('Your session changed. Please try again.');
      if (!isCurrent()) return;
      setProfile(updatedProfile);
      toast({
        title: 'Success',
        description: updatedProfile.emailChangePending
          ? 'Profile saved. Check your email to confirm the new address.'
          : 'Profile updated successfully',
      });
    } catch (err) {
      if (isCurrent()) {
        const failure = err instanceof Error ? err : new Error('Failed to update profile');
        setError(failure);
        toast({ title: 'Error', description: failure.message, variant: 'destructive' });
      }
      throw err;
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  };

  useEffect(() => {
    setProfile(null);
    void fetchProfile();
    return () => { ++requestVersion.current; };
  }, [fetchProfile]);

  const contextValue: ProfileContextValue = {
    profile: profile?.userId === userId ? profile : null,
    isLoading,
    error,
    isAuthenticated: isInitialized && !!userId,
    refreshProfile: fetchProfile,
    updateProfile: updateProfileData,
  };

  return (
    <ProfileContext.Provider value={contextValue}>
      {children}
    </ProfileContext.Provider>
  );
}

/**
 * Hook to access profile context
 * @throws Error if used outside of ProfileProvider
 */
export function useProfile(): ProfileContextValue {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }
  return context;
}
