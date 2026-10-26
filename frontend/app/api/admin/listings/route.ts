import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { supabaseAdmin } from '@/lib/supabase/server'
import { ErrorFactory, withApiErrorHandler } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const GET = withApiErrorHandler(async (req: NextRequest) => {
  if (!(await requireAdmin(req)).allowed) throw ErrorFactory.authorization('forbidden')
  const page = Number(req.nextUrl.searchParams.get('page') || '1')
  const filter = req.nextUrl.searchParams.get('filter') || 'all'
  if (!Number.isInteger(page) || page < 1 || page > 10000 || !['all', 'held'].includes(filter)) {
    throw ErrorFactory.validation('Invalid listing filters')
  }
  let query = supabaseAdmin.from('listings')
    .select('id,title,status,owner_status,moderation_suspended', { count: 'exact' })
    .order('created_at', { ascending: false }).order('id', { ascending: false })
  if (filter === 'held') query = query.eq('moderation_suspended', true)
  const { data, error, count } = await query.range((page - 1) * 50, page * 50 - 1)
  if (error) throw ErrorFactory.database('Unable to load listings for moderation')
  return NextResponse.json({ listings: data || [], page, totalPages: Math.max(1, Math.ceil((count || 0) / 50)) })
})
