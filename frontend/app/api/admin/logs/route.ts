import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { supabaseAdmin } from '@/lib/supabase/server'
import { ErrorFactory, withApiErrorHandler } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const GET = withApiErrorHandler(async (req: NextRequest) => {
  if (!(await requireAdmin(req)).allowed) throw ErrorFactory.authorization('forbidden')
  const { data, error } = await supabaseAdmin.from('moderation_logs')
    .select('id,admin_email,listing_id,action,created_at')
    .order('created_at', { ascending: false }).limit(11)
  if (error) throw ErrorFactory.database('Unable to load moderation logs')
  return NextResponse.json({ logs: data || [] })
})
