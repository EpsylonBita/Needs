import { NextResponse } from 'next/server'
import { withApiErrorHandler, ErrorFactory } from '@/lib/utils/error-handler'
import { randomBytes } from 'crypto'

function randomToken() {
  return randomBytes(32).toString('hex')
}

export const GET = withApiErrorHandler(async () => {
  try {
    const token = randomToken()
    const isProd = process.env.NODE_ENV === 'production'
    
    // Set additional security headers
    const res = NextResponse.json({ 
      csrfToken: token,
      expiresIn: 3600 // 1 hour
    })
    
    // Enhanced cookie security
    res.cookies.set('csrf_token', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: isProd,
      path: '/',
      maxAge: 3600, // 1 hour
      domain: isProd ? process.env.NEXT_PUBLIC_DOMAIN : undefined,
    })
    
    // Add security headers
    res.headers.set('X-Content-Type-Options', 'nosniff')
    res.headers.set('X-Frame-Options', 'DENY')
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    
    return res
  } catch (error) {
    console.error('CSRF token generation error:', error)
    throw ErrorFactory.system('Failed to generate CSRF token')
  }
})
