import { NextRequest, NextResponse } from 'next/server';
import { withApiErrorHandler } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic';

export const GET = withApiErrorHandler(async (request: NextRequest) => {
  return NextResponse.json({
    success: true,
    message: 'Test endpoint works',
    timestamp: new Date().toISOString()
  });
})
