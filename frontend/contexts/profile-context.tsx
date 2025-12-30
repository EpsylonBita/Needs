'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { profileService, ProfileData, UpdateProfileData } from '@/lib/services/profile-service';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabase/client';

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
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const init = async () => {
      const u = await supabase.auth.getUser();
      setIsAuthenticated(!!u.data.user);
    };
    init();
  }, []);

  const fetchProfile = async () => {
    try {
      setIsLoading(true);
      const u = await supabase.auth.getUser();
      if (!u.data.user) {
        setProfile(null);
        setIsAuthenticated(false);
        return;
      }
      setIsAuthenticated(true);
      const data = await profileService.getProfile();
      setProfile(data);
      setError(null);
    } catch (err) {
      setError(err as Error);
      setProfile(null);
    } finally {
      setIsLoading(false);
    }
  };

  const updateProfileData = async (data: UpdateProfileData) => {
    try {
      setIsLoading(true);
      const updatedProfile = await profileService.updateProfile(data);
      setProfile(updatedProfile);
      toast({
        title: 'Success',
        description: 'Profile updated successfully',
      });
    } catch (err) {
      console.error('Error updating profile:', err);
      setError(err instanceof Error ? err : new Error('Failed to update profile'));
      toast({
        title: 'Error',
        description: 'Failed to update profile',
        variant: 'destructive',
      });
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const contextValue: ProfileContextValue = {
    profile,
    isLoading,
    error,
    isAuthenticated,
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