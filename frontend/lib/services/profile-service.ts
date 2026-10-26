import { authEmailRedirectUrl } from '@/lib/auth/email-links';
import { supabase } from '@/lib/supabase/client';
import { Profile } from '@/types/db';
import { mapProfileToDomain, UserProfile } from '@/types/domain';

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

export interface ProfileUpdateResult extends UserProfile {
  emailChangePending?: boolean;
}

export interface UploadPhotoResponse {
  url: string;
}

const profileColumns = 'id, user_id, display_name, avatar_url, title, bio, location, cover_image, reputation, rating_count, created_at';
const failure = (error: unknown, fallback: string): Error => error instanceof Error
  ? error
  : new Error(typeof error === 'object' && error && 'message' in error ? String(error.message) : fallback);

async function authenticatedUser(expectedUserId?: string) {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw failure(error, 'Authentication failed');
  if (!data.user) throw new Error('Not authenticated');
  if (expectedUserId && data.user.id !== expectedUserId) throw new Error('Your session changed. Please try again.');
  return data.user;
}

async function findProfile(userId: string) {
  const { data, error } = await supabase.from('profiles').select(profileColumns)
    .eq('user_id', userId).maybeSingle();
  if (error) throw failure(error, 'Profile could not be loaded');
  return data as Profile | null;
}

export const profileService = {
  uploadPhoto: async (file: File, type: 'avatar' | 'cover', expectedUserId?: string): Promise<UploadPhotoResponse> => {
    const user = await authenticatedUser(expectedUserId);
    if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) {
      throw new Error('Please upload an image smaller than 5MB');
    }
    const ext = file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'jpg';
    const path = `${user.id}/${type}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: false });
    if (error) throw failure(error, 'Photo could not be uploaded');
    await authenticatedUser(user.id);
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    return { url: data.publicUrl };
  },

  updateProfile: async (data: UpdateProfileData, expectedUserId?: string): Promise<ProfileUpdateResult> => {
    const user = await authenticatedUser(expectedUserId);
    let profile = await findProfile(user.id);
    if (!profile) throw new Error('Profile not found');
    if (profile.user_id !== user.id) throw new Error('Your session changed. Please try again.');
    const email = data.email?.trim();
    if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Invalid email address');
    }
    const updateData: Record<string, unknown> = {};
    if (data.fullName !== undefined) updateData.display_name = data.fullName;
    if (data.title !== undefined) updateData.title = data.title;
    if (data.bio !== undefined) updateData.bio = data.bio;
    if (data.location !== undefined) updateData.location = data.location;
    if (data.avatar !== undefined) {
      updateData.avatar_url = typeof data.avatar === 'string'
        ? data.avatar
        : (await profileService.uploadPhoto(data.avatar, 'avatar', user.id)).url;
    }
    if (data.coverImage !== undefined) {
      updateData.cover_image = typeof data.coverImage === 'string'
        ? data.coverImage
        : (await profileService.uploadPhoto(data.coverImage, 'cover', user.id)).url;
    }
    const hasProfileChanges = Object.keys(updateData).length > 0;
    if (hasProfileChanges) {
      await authenticatedUser(user.id);
      const { data: updated, error } = await supabase.from('profiles').update(updateData)
        .eq('id', profile.id).eq('user_id', user.id).select(profileColumns).single();
      if (error) throw failure(error, 'Profile could not be updated');
      if (!updated) throw new Error('Profile could not be updated');
      profile = updated as Profile;
    }

    let verifiedEmail = user.email;
    let emailChangePending = false;
    if (email !== undefined && email.toLowerCase() !== user.email?.toLowerCase()) {
      await authenticatedUser(user.id);
      const { data: authData, error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: authEmailRedirectUrl('/auth/confirm') });
      if (error) {
        const message = failure(error, 'Email could not be updated').message;
        throw new Error(hasProfileChanges ? `Profile saved, but the email change failed: ${message}` : message);
      }
      if (!authData.user) throw new Error('Email update returned no user. Please reload your profile.');
      verifiedEmail = authData.user.email;
      emailChangePending = verifiedEmail?.toLowerCase() !== email.toLowerCase();
    }
    await authenticatedUser(user.id);
    return { ...mapProfileToDomain(profile, verifiedEmail), emailChangePending };
  },

  getProfile: async (): Promise<UserProfile> => {
    const user = await authenticatedUser();
    let profile = await findProfile(user.id);
    if (!profile) {
      // Insert only: a concurrent request must never overwrite saved profile fields.
      const fullName = user.user_metadata?.fullName || user.user_metadata?.full_name || user.email || '';
      const { data, error } = await supabase.from('profiles')
        .insert({ user_id: user.id, display_name: fullName }).select(profileColumns).single();
      if (error && error.code !== '23505') throw failure(error, 'Profile could not be created');
      profile = error ? await findProfile(user.id) : data as Profile;
    }
    if (!profile) throw new Error('Profile not found');
    return mapProfileToDomain(profile, user.email);
  },
};

export const { updateProfile, getProfile, uploadPhoto } = profileService;
export default profileService;
