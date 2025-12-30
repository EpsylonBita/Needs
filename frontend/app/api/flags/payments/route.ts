import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { withApiErrorHandler, ErrorFactory } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const GET = withApiErrorHandler(async () => {
  const { data, error } = await supabaseAdmin.from('feature_flags').select('enabled').eq('key','payments_enabled').single()
  if (error) throw ErrorFactory.database(error.message)
  return NextResponse.json({ data: { enabled: !!data?.enabled } })
})
