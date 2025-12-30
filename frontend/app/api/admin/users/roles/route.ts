import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, UserRole, updateUserRole, getUsersWithRoles } from '@/lib/auth/role-based-admin'
import { log } from '@/lib/utils/logger'
import { rateLimit } from '@/lib/utils/rate-limit'
import { z } from 'zod'
import { withApiErrorHandler, ErrorFactory, createValidationError } from '@/lib/utils/error-handler'

const updateRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum([UserRole.USER, UserRole.MODERATOR, UserRole.ADMIN, UserRole.SUPER_ADMIN])
})

export const dynamic = 'force-dynamic'

export const POST = withApiErrorHandler(async (req: NextRequest) => {
  try {
    // Input validation
    const body = await req.json()
    const validatedData = updateRoleSchema.parse(body)
    
    // Super admin authorization required for role updates
    const auth = await requireAdmin(req, UserRole.SUPER_ADMIN)
    if (!auth.allowed) {
      log('warn', 'unauthorized_role_update_attempt', { 
        ip: req.headers.get('x-forwarded-for'),
        userAgent: req.headers.get('user-agent'),
        reason: auth.reason,
        targetUserId: validatedData.userId,
        targetRole: validatedData.role
      })
      throw ErrorFactory.authorization('Forbidden')
    }
    
    // Rate limiting
    const ip = req.headers.get('x-forwarded-for') || 'unknown'
    const rl = await rateLimit(`admin:role-update:${ip}`, 10, 60_000)
    if (!rl.allowed) {
      log('warn', 'admin_role_update_rate_limit', { ip, userId: auth.user?.id })
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    }
    
    // Prevent self-role modification
    if (auth.user?.id === validatedData.userId) {
      log('warn', 'self_role_update_attempt', { 
        userId: auth.user.id,
        targetRole: validatedData.role 
      })
      throw createValidationError('userId', 'Cannot modify your own role')
    }
    
    log('info', 'role_update', { 
      targetUserId: validatedData.userId, 
      newRole: validatedData.role,
      by: auth.user?.email,
      byRole: auth.role,
      ip 
    })

    // Update user role
    const updatedUser = await updateUserRole(
      validatedData.userId, 
      validatedData.role, 
      auth.user!.id
    )

    log('info', 'role_update_success', { 
      userId: validatedData.userId, 
      newRole: validatedData.role,
      by: auth.user?.email,
      byRole: auth.role
    })

    return NextResponse.json({ 
      success: true, 
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        role: validatedData.role
      },
      message: 'User role updated successfully' 
    })
    
  } catch (error: any) {
    log('error', 'role_update_error', { 
      error: error.message,
      ip: req.headers.get('x-forwarded-for') 
    })
    throw error
  }
})

export const GET = withApiErrorHandler(async (req: NextRequest) => {
  try {
    // Admin authorization required to view user roles
    const auth = await requireAdmin(req, UserRole.ADMIN)
    if (!auth.allowed) {
      log('warn', 'unauthorized_user_list_attempt', { 
        ip: req.headers.get('x-forwarded-for'),
        userAgent: req.headers.get('user-agent'),
        reason: auth.reason
      })
      throw ErrorFactory.authorization('Forbidden')
    }
    
    // Rate limiting
    const ip = req.headers.get('x-forwarded-for') || 'unknown'
    const rl = await rateLimit(`admin:user-list:${ip}`, 30, 60_000)
    if (!rl.allowed) {
      log('warn', 'admin_user_list_rate_limit', { ip, userId: auth.user?.id })
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    }
    
    log('info', 'user_list_requested', { 
      by: auth.user?.email,
      byRole: auth.role,
      ip 
    })

    // Get users with their roles
    const users = await getUsersWithRoles(auth.user!.id)

    return NextResponse.json({ 
      success: true, 
      users,
      count: users.length
    })
    
  } catch (error: any) {
    log('error', 'user_list_error', { 
      error: error.message,
      ip: req.headers.get('x-forwarded-for') 
    })
    throw error
  }
})
