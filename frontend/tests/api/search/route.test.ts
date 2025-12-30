import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '../../../app/api/search/route'

vi.mock('@/lib/utils/rate-limit-enhanced', () => ({
  rateLimitEnhanced: vi.fn(async () => ({ allowed: true })),
  RateLimitConfigs: { PUBLIC_API: { key: (x: string) => `api:${x}`, anonymousLimit: 100, windowMs: 60000, message: 'rate' } }
}))

vi.mock('@/lib/utils/logger', () => ({ log: vi.fn() }))

describe('Search API', () => {
  it('GET returns not implemented', async () => {
    const req = new NextRequest('http://localhost/api/search', { method: 'GET' }) as any
    const res = await GET(req)
    const data = await res.json()
    expect(res.status).toBe(501)
    expect(data.error).toBe('Search endpoint not implemented')
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })

  it('POST validates inputs', async () => {
    const req = new NextRequest('http://localhost/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }) as any
    const res = await POST(req)
    const data = await res.json()
    expect(res.status).toBe(400)
    expect(data.error).toBe('Title or description is required')
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })
})

