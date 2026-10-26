import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/admin'
import { supabaseAdmin } from '@/lib/supabase/server'
import { ErrorFactory, withApiErrorHandler } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const GET = withApiErrorHandler(async (req: NextRequest) => {
  if (!(await requireAdmin(req)).allowed) throw ErrorFactory.authorization('forbidden')
  const id = req.nextUrl.pathname.split('/').filter(Boolean).at(-1)
  if (!z.string().uuid().safeParse(id).success) throw ErrorFactory.validation('Invalid log ID')
  const { data, error } = await supabaseAdmin.from('moderation_logs')
    .select('id,admin_email,listing_id,action,admin_notes,created_at,listing:listings(title)')
    .eq('id', id!).maybeSingle()
  if (error) throw ErrorFactory.database('Unable to load moderation log')
  if (!data) return NextResponse.json({ error: 'Log not found' }, { status: 404 })
  return NextResponse.json({ log: data })
})
