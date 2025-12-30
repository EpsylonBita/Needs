import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { withApiErrorHandler, ErrorFactory } from '@/lib/utils/error-handler'

// Helper function to decode base64 for server environment
function base64Decode(str: string): string {
  return Buffer.from(str, 'base64').toString('utf-8');
}

export const GET = withApiErrorHandler(async (request: NextRequest) => {
  try {
    const authHeader = request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) throw ErrorFactory.authentication('unauthorized');
    const token = authHeader.slice(7);
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) throw ErrorFactory.authentication('unauthorized');
    const uid = data.user.id;
    const { data: profile } = await supabaseAdmin.from('profiles').select('user_id,display_name,avatar_url').eq('user_id', uid).limit(1).single();
    return NextResponse.json({ user: { id: uid, email: data.user.email, fullName: profile?.display_name || '', phoneNumber: data.user.user_metadata?.phoneNumber || '' } });
  } catch (error: any) {
    throw error
  }
})

export const PUT = withApiErrorHandler(async (request: NextRequest) => {
  try {
    const body = await request.json();
    const authHeader = request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) throw ErrorFactory.authentication('unauthorized');
    const token = authHeader.slice(7);
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) throw ErrorFactory.authentication('unauthorized');
    const uid = data.user.id;
    const up = await supabaseAdmin.from('profiles').upsert({ user_id: uid, display_name: body.fullName, avatar_url: body.avatar_url }, { onConflict: 'user_id' });
    if (up.error) throw ErrorFactory.validation(up.error.message)
    return NextResponse.json({ success: true });
  } catch (error: any) {
    throw error
  }
})
