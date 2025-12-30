import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { withApiErrorHandler, ErrorFactory } from '@/lib/utils/error-handler'

/**
 * Get user profile
 */
export const GET = withApiErrorHandler(async (request: NextRequest) => {
  try {
    // In a real app, you would:
    // 1. Authenticate the request
    // 2. Get user id from the session/token
    // 3. Fetch user data from backend

    // Mock user profile data
    return NextResponse.json(
      {
        success: true,
        profile: {
          id: '123',
          name: 'Demo User',
          email: 'user@example.com',
          avatar: '/avatars/default.jpg',
          joinedAt: '2023-01-15T00:00:00Z',
          bio: 'This is a demo user profile',
          location: 'San Francisco, CA',
          preferences: {
            notifications: true,
            darkMode: false
          }
        }
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Profile fetch error:', error);
    throw ErrorFactory.system('Failed to fetch profile')
  }
})

/**
 * Update user profile
 */
export const PATCH = withApiErrorHandler(async (request: NextRequest) => {
  try {
    const body = await request.json();
    
    // In a real app, you would:
    // 1. Authenticate the request
    // 2. Validate the input
    // 3. Update the profile in backend
    
    return NextResponse.json(
      { 
        success: true, 
        message: 'Profile updated successfully',
        profile: {
          ...body,
          id: '123', // Preserve ID
          updatedAt: new Date().toISOString()
        }
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Profile update error:', error);
    throw ErrorFactory.system('Failed to update profile')
  }
})
