import { supabase } from '@/lib/supabase/client';
import { Profile } from '@/types/db';
import { mapProfileToDomain, UserProfile } from '@/types/domain';

// Re-export UserProfile as ProfileData for backward compatibility (temporarily)
export type ProfileData = UserProfile;

export interface UpdateProfileData {
  fullName?: string;
  title?: string;
  email?: string;
  location?: string;
  bio?: string;
  avatar?: string | File;
  coverImage?: string | File;
}

export interface UploadPhotoResponse {
  url: string;
}

export const profileService = {
  uploadPhoto: async (file: File, type: 'avatar' | 'cover'): Promise<UploadPhotoResponse> => {
    const userRes = await supabase.auth.getUser();
    const userId = userRes.data.user?.id;
    if (!userId) throw new Error('Not authenticated');
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${userId}/${type}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    return { url: data.publicUrl };
  },

  updateProfile: async (data: UpdateProfileData): Promise<UserProfile> => {
    const userRes = await supabase.auth.getUser();
    const userId = userRes.data.user?.id;
    if (!userId) throw new Error('Not authenticated');
    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1);
    const profile = (profileRows || [])[0];
    if (!profile?.id) throw new Error('Profile not found');
    
    const updateData: Record<string, unknown> = {};
    if (data.fullName !== undefined) updateData.display_name = data.fullName;
    if (data.title !== undefined) updateData.title = data.title;
    if (data.bio !== undefined) updateData.bio = data.bio;
    if (data.location !== undefined) updateData.location = data.location;
    
    if (data.avatar) {
      if (data.avatar instanceof File) {
        const uploadResult = await profileService.uploadPhoto(data.avatar, 'avatar');
        updateData.avatar_url = uploadResult.url;
      } else if (typeof data.avatar === 'string' && data.avatar) {
        updateData.avatar_url = data.avatar;
      }
    }
    if (data.coverImage) {
      if (data.coverImage instanceof File) {
        const uploadResult = await profileService.uploadPhoto(data.coverImage, 'cover');
        updateData.cover_image = uploadResult.url;
      } else if (typeof data.coverImage === 'string' && data.coverImage) {
        updateData.cover_image = data.coverImage;
      }
    }

    const { data: updatedRows, error } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', profile.id)
      .select('id, user_id, display_name, avatar_url, title, bio, location, cover_image, reputation, rating_count, created_at')
      .single();
      
    if (error) throw error;
    if (!updatedRows) throw new Error('Failed to update profile');

    const authUser = (await supabase.auth.getUser()).data.user;
    // Cast to Profile to ensure it matches the expected type from DB
    const profileRecord = updatedRows as unknown as Profile;
    
    return mapProfileToDomain(profileRecord, authUser?.email);
  },

  getProfile: async (): Promise<UserProfile> => {
    const userRes = await supabase.auth.getUser();
    const userId = userRes.data.user?.id;
    console.log('getProfile - User ID:', userId);
    if (!userId) throw new Error('Not authenticated');
    
    const { data: profileData, error } = await supabase
      .from('profiles')
      .select('id, user_id, display_name, avatar_url, title, bio, location, cover_image, reputation, rating_count, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    let profile = profileData;
    
    if (!profile) {
      console.log('getProfile - Creating new profile for user:', userId);
      const { data: authUser } = await supabase.auth.getUser();
      const fullName = authUser.user?.user_metadata?.fullName || authUser.user?.email || '';
      console.log('getProfile - Creating profile with name:', fullName);
      
      const { error: upsertError } = await supabase.from('profiles').upsert({ 
        user_id: userId, 
        display_name: fullName, 
        title: '', 
        bio: '', 
        location: '', 
        cover_image: '' 
      }, { onConflict: 'user_id' });
      
      if (upsertError) {
        console.error('getProfile - Error creating profile:', upsertError);
        throw upsertError;
      }
      
      const { data: reselect } = await supabase
        .from('profiles')
        .select('id, user_id, display_name, avatar_url, title, bio, location, cover_image, reputation, rating_count, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .single();
        
      profile = reselect;
    }
    
    if (error && !profile) throw error;
    if (!profile) throw new Error('Profile not found');
    
    const authUser = (await supabase.auth.getUser()).data.user;
    const profileRecord = profile as unknown as Profile;
    
    return mapProfileToDomain(profileRecord, authUser?.email);
  },
};

export const { updateProfile, getProfile, uploadPhoto } = profileService;

// Add default export to match the import in index.ts
export default profileService;
