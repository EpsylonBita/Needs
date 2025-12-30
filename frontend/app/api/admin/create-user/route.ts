import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { requireAdmin, UserRole } from '@/lib/auth/role-based-admin'
import { log } from '@/lib/utils/logger'
import { rateLimit } from '@/lib/utils/rate-limit'
import { adminCreateUserSchema, validateInput } from '@/lib/validations/security-schemas'
import { withApiErrorHandler, ErrorFactory, createValidationError } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const POST = withApiErrorHandler(async (req: NextRequest) => {
  try {
    // Input validation first
    const body = await req.json()
    const validatedData = validateInput(adminCreateUserSchema, body)
    
    // Admin authorization - require admin role to create users
    const auth = await requireAdmin(req, UserRole.ADMIN)
    if (!auth.allowed) {
      log('warn', 'unauthorized_admin_attempt', { 
        ip: req.headers.get('x-forwarded-for'),
        userAgent: req.headers.get('user-agent'),
        reason: auth.reason,
        targetRole: validatedData.role 
      })
      throw ErrorFactory.authorization('Forbidden')
    }
    
    // Rate limiting
    const ip = req.headers.get('x-forwarded-for') || 'unknown'
    const rl = await rateLimit(`admin:create:${ip}`, 20, 60_000)
    if (!rl.allowed) {
      log('warn', 'admin_rate_limit_exceeded', { ip, userId: auth.user?.id })
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    }
    
    log('info', 'admin_create_user', { 
      targetEmail: validatedData.email, 
      by: auth.user?.email,
      byRole: auth.role,
      targetRole: validatedData.role,
      ip 
    })

    // Create user with Supabase admin
    const created = await supabaseAdmin.auth.admin.createUser({
      email: validatedData.email,
      email_confirm: true,
      user_metadata: { 
        display_name: validatedData.display_name,
        role: validatedData.role 
      },
    })
    
    if (created.error) {
      log('error', 'admin_create_user_failed', { 
        email: validatedData.email, 
        error: created.error.message,
        by: auth.user?.email,
        byRole: auth.role
      })
      throw ErrorFactory.system(created.error.message)
    }
    
    const uid = created.data.user?.id
    if (!uid) {
      log('error', 'admin_create_user_no_id', { email: validatedData.email })
      throw ErrorFactory.system('User creation failed')
    }

    // Create profile
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({ 
        user_id: uid, 
        display_name: validatedData.display_name,
        role: validatedData.role 
      })
      
    if (profileError) {
      log('error', 'admin_create_profile_failed', { 
        userId: uid, 
        error: profileError.message 
      })
      await supabaseAdmin.auth.admin.deleteUser(uid)
      throw ErrorFactory.database('Profile creation failed')
    }

    log('info', 'admin_create_user_success', { 
      userId: uid, 
      email: validatedData.email,
      by: auth.user?.email,
      byRole: auth.role,
      targetRole: validatedData.role
    })

    return NextResponse.json({ 
      success: true, 
      user_id: uid,
      message: 'User created successfully' 
    })
    
  } catch (error: any) {
    log('error', 'admin_create_user_error', { 
      error: error.message,
      ip: req.headers.get('x-forwarded-for') 
    })
    throw error
  }
})

// Disable GET method for security - only POST should be used for user creation
export const GET = withApiErrorHandler(async (req: NextRequest) => {
  log('warn', 'admin_create_user_get_attempt', { 
    ip: req.headers.get('x-forwarded-for'),
    userAgent: req.headers.get('user-agent')
  })
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
})
