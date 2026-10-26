import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/admin'
import { supabaseAdmin } from '@/lib/supabase/server'
import { ErrorFactory, withApiErrorHandler } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'
const flagSchema = z.object({ key: z.string().trim().min(1).max(100).regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/), enabled: z.boolean() }).strict()

export const GET = withApiErrorHandler(async (req: NextRequest) => {
  if (!(await requireAdmin(req)).allowed) throw ErrorFactory.authorization('forbidden')
  const { data, error } = await supabaseAdmin.from('feature_flags').select('key,enabled').order('key')
  if (error) throw ErrorFactory.database('Unable to load settings')
  return NextResponse.json({ flags: data || [] })
})

async function saveFlag(req: NextRequest, create: boolean) {
  if (!(await requireAdmin(req)).allowed) throw ErrorFactory.authorization('forbidden')
  const input = flagSchema.safeParse(await req.json().catch(() => null))
  if (!input.success) throw ErrorFactory.validation('Enter a valid flag key and enabled value')
  const table = supabaseAdmin.from('feature_flags')
  const { error } = create ? await table.insert(input.data) : await table.upsert(input.data)
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'This flag already exists' }, { status: 409 })
    throw ErrorFactory.database('Unable to save settings')
  }
  return NextResponse.json({ success: true }, { status: create ? 201 : 200 })
}

export const POST = withApiErrorHandler((req: NextRequest) => saveFlag(req, true))
export const PATCH = withApiErrorHandler((req: NextRequest) => saveFlag(req, false))
