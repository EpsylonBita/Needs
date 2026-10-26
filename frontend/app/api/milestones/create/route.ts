import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { supabaseAdmin } from '@/lib/supabase/server'
import { withApiErrorHandler, ErrorFactory, createValidationError } from '@/lib/utils/error-handler'

const schema = z.object({
  listingId: z.string().uuid(),
  chatId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  amount: z.union([z.number(), z.string().trim().regex(/^\d+(?:[.,]\d{1,2})?$/).transform(value => Number(value.replace(',', '.')))])
    .pipe(z.number().finite().positive().max(10000).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001)),
})

export const dynamic = 'force-dynamic'

export const POST = withApiErrorHandler(async (request: NextRequest) => {
  const auth = request.headers.get('authorization') || ''
  if (!auth.startsWith('Bearer ')) throw ErrorFactory.authentication('Authentication required')
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(auth.slice(7))
  if (authError || !user) throw ErrorFactory.authentication('Invalid authentication')
  const validation = schema.safeParse(await request.json())
  if (!validation.success) throw createValidationError('milestone', 'Enter a valid listing, title and positive amount with at most two decimal places')
  const { listingId, title, amount, chatId } = validation.data
  const flag = await supabaseAdmin.from('feature_flags').select('enabled').eq('key', 'milestones_enabled').limit(1).single()
  if (flag.error || flag.data?.enabled !== true) throw ErrorFactory.authorization('Milestones are disabled')
  const { data: me, error: profileError } = await supabaseAdmin.from('profiles').select('id').eq('user_id', user.id).limit(1).single()
  if (profileError || !me) throw ErrorFactory.businessLogic('Profile not found')
  const { data: id, error } = await supabaseAdmin.rpc('create_milestone_proposal', {
    p_listing_id: listingId, p_buyer_id: me.id, p_title: title, p_amount: amount,
    p_chat_id: chatId || null,
  })
  if (error?.code === 'P0001') throw createValidationError('milestone', error.message)
  if (error || !id) throw ErrorFactory.database('Could not save the milestone')
  return NextResponse.json({ success: true, id })
})
