import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../../../../app/api/flags/payments/route'

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data: { enabled: true }, error: null }))
    }))
  }
}))


describe('Flags Payments', () => {
  it('GET returns flag state with X-Request-Id', async () => {
    const req = new NextRequest('http://localhost/api/flags/payments', { method: 'GET' }) as any
    const res = await GET(req)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.data.enabled).toBe(true)
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })
})
