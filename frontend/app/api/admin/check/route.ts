import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, UserRole } from '@/lib/auth/role-based-admin'
import { withApiErrorHandler, ErrorFactory } from '@/lib/utils/error-handler'

export const GET = withApiErrorHandler(async (req: NextRequest) => {
  const auth = await requireAdmin(req, UserRole.ADMIN)
  if (!auth.allowed) {
    throw ErrorFactory.authorization(auth.reason || 'forbidden')
  }
  return NextResponse.json({ 
    allowed: true, 
    role: auth.role,
    user: {
      id: auth.user!.id,
      email: auth.user!.email
    }
  })
})
