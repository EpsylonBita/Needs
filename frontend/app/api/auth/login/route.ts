import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { userLoginSchema, validateInput } from '@/lib/validations/security-schemas';
import { log } from '@/lib/utils/logger';
import { rateLimitEnhanced, RateLimitConfigs } from '@/lib/utils/rate-limit-enhanced';
import { withApiErrorHandler, ErrorFactory } from '@/lib/utils/error-handler';

export const POST = withApiErrorHandler(async (request: NextRequest) => {
  try {
    // Validate input
    const body = await request.json();
    const validatedData = validateInput(userLoginSchema, body);
    
    // Enhanced rate limiting for login attempts
    const ip = request.headers.get('x-forwarded-for') || 'unknown';
    const rateLimitKey = RateLimitConfigs.LOGIN.key(ip);
    
    const rateLimitResult = await rateLimitEnhanced(
      rateLimitKey,
      RateLimitConfigs.LOGIN.anonymousLimit,
      RateLimitConfigs.LOGIN.windowMs,
      {
        message: RateLimitConfigs.LOGIN.message,
        isAuthenticated: false // Login attempts are always treated as anonymous
      }
    );
    
    if (!rateLimitResult.allowed) {
      log('warn', 'login_rate_limit_exceeded', { 
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
          error: rateLimitResult.message || 'Too many login attempts. Please try again later.' 
        }, 
        { 
          status: 429,
          headers
        }
      );
    }
    
    // Create Supabase client
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
    
    if (!url || !anon) {
      log('error', 'missing_supabase_config', { ip });
      throw ErrorFactory.system('Server configuration error');
    }
    
    const client = createClient(url, anon);
    
    // Attempt login
    const { data, error } = await client.auth.signInWithPassword({ 
      email: validatedData.email, 
      password: validatedData.password 
    });
    
    if (error) {
      log('warn', 'failed_login_attempt', { email: validatedData.email, ip, error: error.message });
      throw ErrorFactory.authentication('Invalid credentials');
    }
    
    log('info', 'successful_login', { userId: data.user?.id, email: validatedData.email, ip });
    
    return NextResponse.json({ 
      user: data.user, 
      session: data.session 
    });

  } catch (error: any) {
    log('error', 'login_error', { error: error.message, ip: request.headers.get('x-forwarded-for') });
    throw error;
  }
});
