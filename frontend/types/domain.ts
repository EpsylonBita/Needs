import { Profile } from './db'

export interface UserProfile {
  id: string
  userId: string
  fullName: string | null
  title: string | null
  email: string | null
  location: string | null
  bio: string | null
  avatar: string | null
  coverImage: string | null
  reputation: number
  ratingCount: number
  createdAt: string
}

export function mapProfileToDomain(profile: Profile, email?: string | null): UserProfile {
  return {
    id: profile.id,
    userId: profile.user_id,
    fullName: profile.display_name,
    title: profile.title || null,
    email: email || null,
    location: profile.location || null,
    bio: profile.bio || null,
    avatar: profile.avatar_url,
    coverImage: profile.cover_image || null,
    reputation: profile.reputation,
    ratingCount: profile.rating_count,
    createdAt: profile.created_at
  }
}
