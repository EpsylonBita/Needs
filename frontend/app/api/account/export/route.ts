import { NextResponse } from 'next/server'
import { accountRate, accountRoute, accountRpc, accountUser, PRIVATE_HEADERS } from '@/lib/account/server'
export const dynamic = 'force-dynamic'

export const GET = accountRoute(async request => {
  const user = await accountUser(request, request.nextUrl.searchParams.get('expectedUserId'), true)
  await accountRate(user.id, 'export', 3)
  const records = await accountRpc('export_account_data', { p_user_id: user.id })
  return NextResponse.json({
    format_version: 1, exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email ?? null, phone: user.phone ?? null, created_at: user.created_at,
      email_confirmed_at: user.email_confirmed_at ?? null, phone_confirmed_at: user.phone_confirmed_at ?? null,
      full_name: typeof user.user_metadata?.fullName === 'string' ? user.user_metadata.fullName : null,
      phone_number: typeof user.user_metadata?.phoneNumber === 'string' ? user.user_metadata.phoneNumber : null },
    scope: 'Profile, listings, sent messages, chat memberships, notifications, participant transaction records, authored reviews and deletion requests. Other users\' private data, authentication secrets, internal security logs and payment-provider credentials are excluded. Unlinked guest support messages and data held by payment providers require a separate request.',
    records,
  }, { headers: { ...PRIVATE_HEADERS, 'Content-Disposition': 'attachment; filename="needs-account-data.json"' } })
})
