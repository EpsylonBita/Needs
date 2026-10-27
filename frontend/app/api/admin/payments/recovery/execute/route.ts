import { NextRequest } from 'next/server'
import { withApiErrorHandler } from '@/lib/utils/error-handler'
import { recoveryRoute } from '@/lib/payments/recovery-route'
export const dynamic = 'force-dynamic'
export const POST = withApiErrorHandler((request: NextRequest) => recoveryRoute(request, true))
