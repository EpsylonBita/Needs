import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/admin'
import { configuredContactEmailDelivery } from '@/lib/email/contact-email-transport'
import { dispatchContactNotifications } from '@/lib/email/contact-notification'
import { supabaseAdmin } from '@/lib/supabase/server'
import { ErrorFactory, withApiErrorHandler } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'
const inputSchema = z.object({ requestId: z.string().uuid().optional(), limit: z.number().int().min(1).max(10).default(5) }).strict()

export const POST = withApiErrorHandler(async (request: NextRequest) => {
  if (!(await requireAdmin(request)).allowed) throw ErrorFactory.authorization('forbidden')
  const input = inputSchema.safeParse(await request.json().catch(() => null))
  if (!input.success) throw ErrorFactory.validation('Invalid notification retry request')
  const result = await dispatchContactNotifications(supabaseAdmin, configuredContactEmailDelivery(), input.data)
  if (!result.configured) return NextResponse.json({ error: 'Contact email delivery is not configured.' }, { status: 503 })
  return NextResponse.json(result)
})
