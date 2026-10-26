import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authEmailRedirectUrl } from '@/lib/auth/email-links';
import { withApiErrorHandler, ErrorFactory } from '@/lib/utils/error-handler';
import { log } from '@/lib/utils/logger';
import { rateLimitEnhanced, RateLimitConfigs } from '@/lib/utils/rate-limit-enhanced';
import { userRegisterSchema, validateInput } from '@/lib/validations/security-schemas';

export const POST = withApiErrorHandler(async (request: NextRequest) => {
  try {
    // Input validation
    const body = await request.json();
    const validatedData = validateInput(userRegisterSchema, body);
    
    // Rate limiting for registration attempts
    const ip = request.headers.get('x-forwarded-for') || 'unknown';
    const rateLimitKey = RateLimitConfigs.REGISTER.key(ip);
    
    const rateLimitResult = await rateLimitEnhanced(
      rateLimitKey,
      RateLimitConfigs.REGISTER.limit,
      RateLimitConfigs.REGISTER.windowMs,
      {
        message: RateLimitConfigs.REGISTER.message,
        failClosed: true,
        isAuthenticated: false // Registration attempts are always treated as anonymous
      }
    );
    
    if (!rateLimitResult.allowed) {
      log('warn', 'register_rate_limit_exceeded', { 
        email: validatedData.email, 
        ip,
        retryAfter: rateLimitResult.retryAfter 
      });
      
      const headers: Record<string, string> = rateLimitResult.retryAfter ? {
        'Retry-After': rateLimitResult.retryAfter.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': rateLimitResult.resetAt?.toISOString() || ''
      } : {};
      
      return NextResponse.json(
        { 
          error: rateLimitResult.message || 'Too many registration attempts. Please try again later.' 
        }, 
        { 
          status: 429,
          headers
        }
      );
    }
    
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
    if (!url || !anon) {
      throw ErrorFactory.system('Server configuration error')
    }
    const client = createClient(url, anon);
    const { data, error } = await client.auth.signUp({
      email: validatedData.email,
      password: validatedData.password,
      options: {
        emailRedirectTo: authEmailRedirectUrl('/auth/confirm', process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin),
        data: { fullName: validatedData.fullName, phoneNumber: validatedData.phoneNumber },
      }
    });
    
    if (error) {
      log('warn', 'registration_failed', { 
        email: validatedData.email, 
        ip,
        error: error.message 
      });
      throw ErrorFactory.validation(error.message)
    }
    
    const uid = data.user?.id
    // The authenticated profile provider creates a missing profile after email
    // confirmation. A duplicate signup must never overwrite a saved profile.
    
    log('info', 'successful_registration', { 
      userId: uid, 
      email: validatedData.email, 
      ip 
    });
    
    return NextResponse.json({ user: data.user, requiresEmailConfirmation: !data.session });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Registration failed';
    log('error', 'registration_error', { 
      error: errorMessage,
      ip: request.headers.get('x-forwarded-for') 
    });
    throw error
  }
});
