import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/admin'
import { supabaseAdmin } from '@/lib/supabase/server'
import { ErrorFactory } from '@/lib/utils/error-handler'

const inputSchema = z.object({ note: z.string().trim().max(2000).optional() }).strict()

export async function moderateListing(req: NextRequest, suspended: boolean) {
  const auth = await requireAdmin(req)
  if (!auth.allowed) throw ErrorFactory.authorization('forbidden')
  const segments = req.nextUrl.pathname.split('/')
  const id = z.string().uuid().safeParse(segments[segments.length - 2])
  if (!id.success) throw ErrorFactory.validation('Invalid listing ID')
  const text = await req.text()
  let body: unknown
  try { body = text ? JSON.parse(text) : {} } catch { throw ErrorFactory.validation('Invalid moderation request') }
  const input = inputSchema.safeParse(body)
  if (!input.success) throw ErrorFactory.validation('Enter a moderation note of up to 2000 characters')
  const { data, error } = await supabaseAdmin.rpc('moderate_listing', {
    p_listing_id: id.data,
    p_suspended: suspended,
    p_admin_email: auth.user?.email || auth.user?.id || 'admin',
    p_note: input.data.note || '',
  })
  if (error?.code === 'P0002') return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
  if (error) throw ErrorFactory.database('Unable to save the moderation action')
  return NextResponse.json({ success: true, listing: data })
}
