import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { supabaseAdmin } from '@/lib/supabase/server'
import { withApiErrorHandler, ErrorFactory } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const POST = withApiErrorHandler(async (req: NextRequest) => {
  const auth = await requireAdmin(req)
  if (!auth.allowed) throw ErrorFactory.authorization('forbidden')
  const body = await req.json()
  const { note } = body as { note: string }
  const segments = req.nextUrl.pathname.split('/')
  const id = segments[segments.length - 2]
  const { error } = await supabaseAdmin.from('moderation_logs').update({ admin_notes: note || '' }).eq('id', id)
  if (error) throw ErrorFactory.database(error.message)
  return NextResponse.json({ success: true })
})
