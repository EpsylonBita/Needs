import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { supabaseAdmin } from '@/lib/supabase/server'
import { withApiErrorHandler, ErrorFactory } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const POST = withApiErrorHandler(async (req: NextRequest) => {
  const auth = await requireAdmin(req)
  if (!auth.allowed) throw ErrorFactory.authorization('forbidden')
  const body = await req.json().catch(()=>({})) as any
  const note = typeof body?.note === 'string' ? body.note : ''
  const segments = req.nextUrl.pathname.split('/')
  const id = segments[segments.length - 2]
  const { error } = await supabaseAdmin.from('listings').update({ status: 'suspended' }).eq('id', id)
  if (error) throw ErrorFactory.database(error.message)
  const email = (auth as any).user?.email || 'admin'
  await supabaseAdmin.from('moderation_logs').insert({ admin_email: email, listing_id: id, action: 'suspend', admin_notes: note })
  return NextResponse.json({ success: true })
})
