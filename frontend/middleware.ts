import { NextResponse, type NextRequest } from 'next/server';

/**
 * Security middleware that:
 * 1. Adds security headers to all responses
 * 2. Validates CSRF tokens for state-changing operations (POST, PUT, DELETE, PATCH)
 * 3. Redirects unauthenticated users from protected routes
 */
export async function middleware(request: NextRequest) {
  // Get the pathname of the request
  const path = request.nextUrl.pathname;
  
  // Get response or create one if undefined
  const response = NextResponse.next();
  
  const headers = response.headers;
  const isProd = process.env.NODE_ENV === 'production'
  const supa = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const api = process.env.NEXT_PUBLIC_API_URL || ''
  const extraConnect = [supa, api]
    .map(u => { try { return new URL(u).origin } catch { return '' } })
    .filter(Boolean)
  
  // Add Supabase realtime host for WebSocket connections
  const realtimeHost = supa ? supa.replace('https://', 'wss://') : ''
  if (realtimeHost) extraConnect.push(realtimeHost)
  const cspProd = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "img-src 'self' data: https:",
    "font-src 'self' https://fonts.gstatic.com data:",
    `connect-src 'self' https://api.mapbox.com https://events.mapbox.com ${extraConnect.join(' ')}`,
    "worker-src 'self' blob:",
    "frame-src https://js.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "upgrade-insecure-requests"
  ].join('; ')
  const cspDev = [
    "default-src 'self' blob:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://cdn.jsdelivr.net https://maps.googleapis.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https: blob:",
    "font-src 'self' https://fonts.gstatic.com data:",
    `connect-src 'self' https://api.mapbox.com ws://localhost:* wss://localhost:* https://localhost:* http://localhost:* https: ${extraConnect.join(' ')}`,
    "worker-src 'self' blob:",
    "frame-src 'self' https://js.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "upgrade-insecure-requests"
  ].join('; ')
  headers.set('Content-Security-Policy', isProd ? cspProd : cspDev);
  
  headers.set('X-Content-Type-Options', 'nosniff');
  
  headers.set('X-Frame-Options', 'DENY');
  
  headers.set('X-XSS-Protection', '1; mode=block');
  
  headers.set('X-DNS-Prefetch-Control', 'on');
  
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), interest-cohort=()');
  
  // 2. CSRF protection for state-changing operations
  const isStateChangingMethod = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method);
  const requiresCsrfCheck = isStateChangingMethod && !(
    path.startsWith('/api/csrf') ||
    path.startsWith('/api/auth') ||
    path.startsWith('/api/payments/webhook')
  );
  
  if (requiresCsrfCheck) {
    // Get the CSRF token from the cookie and request header
    const csrfCookie = request.cookies.get('csrf_token')?.value;
    const csrfHeader = request.headers.get('X-CSRF-Token');
    
    // If we're missing either token or they don't match
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      console.error('CSRF token validation failed:', {
        hasCsrfCookie: !!csrfCookie,
        hasCsrfHeader: !!csrfHeader,
        headerLength: csrfHeader?.length,
        cookieLength: csrfCookie?.length
      });
      
      return new NextResponse(JSON.stringify({ error: 'Invalid CSRF token' }), {
        status: 403,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
  }
  
  // 3. Protected routes handling moved to server-side and client checks
  
  return response;
}

// Configure which paths the middleware applies to
export const config = {
  matcher: [
    // Apply to all routes except static files, api/auth routes, and _next paths
    '/((?!_next/static|favicon.ico|robots.txt|sitemap.xml|api/auth/callback).*)',
  ],
};