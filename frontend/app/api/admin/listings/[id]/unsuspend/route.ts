import { NextRequest } from 'next/server'
import { withApiErrorHandler } from '@/lib/utils/error-handler'
import { moderateListing } from '../../moderate-listing'

export const dynamic = 'force-dynamic'

export const POST = withApiErrorHandler((req: NextRequest) => moderateListing(req, false))
