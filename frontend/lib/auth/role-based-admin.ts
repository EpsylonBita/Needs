import { NextRequest } from 'next/server'

import { supabaseAdmin } from '@/lib/supabase/server'

// Role hierarchy for the application
export const UserRole = {
  USER: 'user',
  MODERATOR: 'moderator', 
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin'
} as const

export type UserRoleType = typeof UserRole[keyof typeof UserRole]

// Role permissions hierarchy
const ROLE_PERMISSIONS: Record<UserRoleType, Permission[]> = {
  [UserRole.USER]: ['read:own', 'write:own'],
  [UserRole.MODERATOR]: ['read:own', 'write:own', 'read:all', 'moderate:content'],
  [UserRole.ADMIN]: ['read:own', 'write:own', 'read:all', 'write:all', 'moderate:content', 'manage:users', 'manage:payments'],
  [UserRole.SUPER_ADMIN]: ['read:own', 'write:own', 'read:all', 'write:all', 'moderate:content', 'manage:users', 'manage:payments', 'manage:system']
}

export type Permission =
  | 'read:own'
  | 'write:own'
  | 'read:all'
  | 'write:all'
  | 'moderate:content'
  | 'manage:users'
  | 'manage:payments'
  | 'manage:system'

function getBearerToken(req: NextRequest): string {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return ''
  return authHeader.slice(7)
}

/**
 * Get user role from auth metadata with fallback to legacy email-based system
 */
async function getUserRole(userId: string, email?: string): Promise<UserRoleType> {
  // First try to get role from user metadata
  const { data: userData, error } = await supabaseAdmin.auth.admin.getUserById(userId)
  
  if (error || !userData.user) {
    console.error('Failed to get user by ID:', error)
    return UserRole.USER
  }

  // Check for role in user metadata
  const userRole = userData.user.user_metadata?.role as UserRoleType
  if (userRole && Object.values(UserRole).includes(userRole)) {
    return userRole
  }

  // Fallback to legacy email-based admin check
  if (email) {
    const adminEmails = (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
    
    if (adminEmails.includes(email.toLowerCase())) {
      return UserRole.ADMIN
    }
  }

  return UserRole.USER
}

/**
 * Check if user has required permission
 */
function hasPermission(userRole: UserRoleType, requiredPermission: Permission): boolean {
  const userPermissions = ROLE_PERMISSIONS[userRole] || []
  return userPermissions.includes(requiredPermission)
}

/**
 * Validate admin role - requires at least ADMIN level
 */
export async function requireAdmin(req: NextRequest, minRole: UserRoleType = UserRole.ADMIN) {
  const token = getBearerToken(req)
  if (!token) {
    return { 
      allowed: false, 
      reason: 'missing_token',
      error: 'Authorization token is required'
    }
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user) {
    return { 
      allowed: false, 
      reason: 'invalid_token',
      error: 'Invalid or expired token'
    }
  }

  const userRole = await getUserRole(data.user.id, data.user.email || undefined)
  
  // Check if user meets minimum role requirement
  const roleHierarchy = [UserRole.USER, UserRole.MODERATOR, UserRole.ADMIN, UserRole.SUPER_ADMIN]
  const userRoleIndex = roleHierarchy.indexOf(userRole)
  const requiredRoleIndex = roleHierarchy.indexOf(minRole)
  
  if (userRoleIndex < requiredRoleIndex) {
    return { 
      allowed: false, 
      reason: 'insufficient_role',
      error: `Insufficient permissions. Required role: ${minRole}, Current role: ${userRole}`,
      role: userRole
    }
  }

  return { 
    allowed: true, 
    user: data.user,
    role: userRole
  }
}

/**
 * Validate specific permission
 */
export async function requirePermission(req: NextRequest, permission: Permission) {
  const token = getBearerToken(req)
  if (!token) {
    return { 
      allowed: false, 
      reason: 'missing_token',
      error: 'Authorization token is required'
    }
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user) {
    return { 
      allowed: false, 
      reason: 'invalid_token',
      error: 'Invalid or expired token'
    }
  }

  const userRole = await getUserRole(data.user.id, data.user.email || undefined)
  
  if (!hasPermission(userRole, permission)) {
    return { 
      allowed: false, 
      reason: 'insufficient_permission',
      error: `Insufficient permissions. Required: ${permission}`,
      role: userRole
    }
  }

  return { 
    allowed: true, 
    user: data.user,
    role: userRole
  }
}

/**
 * Update user role (super admin only)
 */
export async function updateUserRole(userId: string, newRole: UserRoleType, updatedBy: string) {
  // Verify the updater has super admin permissions
  const updaterRole = await getUserRole(updatedBy)
  if (updaterRole !== UserRole.SUPER_ADMIN) {
    throw new Error('Only super admins can update user roles')
  }

  if (!Object.values(UserRole).includes(newRole)) {
    throw new Error('Invalid role specified')
  }

  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    user_metadata: { role: newRole }
  })

  if (error) {
    throw new Error(`Failed to update user role: ${error.message}`)
  }

  return data.user
}

/**
 * Get all users with their roles (admin only)
 */
interface AdminUser {
  id: string
  email?: string
  user_metadata?: Record<string, unknown>
  created_at: string
  last_sign_in_at?: string
}

export async function getUsersWithRoles(requesterId: string) {
  const requesterRole = await getUserRole(requesterId)
  if (requesterRole !== UserRole.SUPER_ADMIN && requesterRole !== UserRole.ADMIN) {
    throw new Error('Insufficient permissions to view user roles')
  }

  const { data, error } = await supabaseAdmin.auth.admin.listUsers()
  if (error) {
    throw new Error(`Failed to list users: ${error.message}`)
  }

  return data.users.map((user) => ({
    id: user.id,
    email: user.email || undefined,
    role: (user.user_metadata?.role as UserRoleType) || UserRole.USER,
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at || undefined
  }))
}
