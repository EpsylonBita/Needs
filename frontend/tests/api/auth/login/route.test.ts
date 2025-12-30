import { describe, it, expect, vi, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../../../../app/api/auth/login/route'

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon_key'
})

vi.mock('@/lib/utils/rate-limit-enhanced', () => ({
  rateLimitEnhanced: vi.fn(async () => ({ allowed: true })),
  RateLimitConfigs: { LOGIN: { key: (x: string) => `auth:login:${x}`, anonymousLimit: 5, windowMs: 900000, message: 'Too many login attempts.' } }
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithPassword: vi.fn(async ({ email, password }: any) => ({
        data: { user: { id: 'user123', email }, session: { access_token: 'token', token_type: 'bearer' } },
        error: null
      }))
    }
  }))
}))

describe('Auth Login', () => {
  it('returns X-Request-Id on success', async () => {
    const body = { email: 'user@example.com', password: 'StrongPass123!' }
    const req = new NextRequest('http://localhost/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as any
    const res = await POST(req)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.user.email).toBe('user@example.com')
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })
})
