import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => {
  let store: Record<string, number> = {}
  const makeKey = (key: string, windowStart: string) => `${key}:${windowStart}`
  return {
    getSupabaseAdmin: () => ({
      from: (table: string) => {
        if (table !== 'rate_limits') throw new Error('Unexpected table')
        return {
          select: vi.fn(() => {
            let k = ''
            let w = ''
            const api: any = {
              eq: vi.fn((col: string, val: string) => {
                if (col === 'key') k = val as string
                if (col === 'window_start') w = val as string
                return api
              }),
              limit: vi.fn((n: number) => {
                const key = makeKey(k, w)
                const count = store[key] ?? 0
                return { data: count ? [{ count }] : [] }
              })
            }
            return api
          }),
          insert: vi.fn(async (row: any) => {
            const key = makeKey(row.key, row.window_start)
            store[key] = (store[key] ?? 0) + 1
            return { data: null, error: null }
          }),
          update: vi.fn(() => ({
            eq: vi.fn((col: string, val: string) => ({
              eq: vi.fn((col2: string, val2: string) => {
                const key = makeKey(val as string, val2 as string)
                store[key] = (store[key] ?? 0) + 1
                return { data: null, error: null }
              })
            }))
          })),
          delete: vi.fn(() => ({ lt: vi.fn(() => ({ data: null, error: null })) }))
        }
      }
    })
  }
})

import { rateLimitEnhanced, RateLimitConfigs } from '@/lib/utils/rate-limit-enhanced'

describe('rate-limit-enhanced', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'))
  })

  it('allows within standard window and blocks on limit', async () => {
    const ip = '1.2.3.4'
    const key = RateLimitConfigs.PUBLIC_API.key(ip)
    const limit = 2
    const windowMs = 60_000

    const r1 = await rateLimitEnhanced(key, limit, windowMs)
    expect(r1.allowed).toBe(true)
    const r2 = await rateLimitEnhanced(key, limit, windowMs)
    expect(r2.allowed).toBe(true)
    const r3 = await rateLimitEnhanced(key, limit, windowMs)
    expect(r3.allowed).toBe(false)
    expect(typeof r3.retryAfter).toBe('number')
  })

  it('enforces burst limit before sustained limit', async () => {
    const ip = '9.8.7.6'
    const key = RateLimitConfigs.PAYMENTS.key(ip)
    const sustainedLimit = 10
    const sustainedWindowMs = 60_000
    const burstLimit = 2
    const burstWindowMs = 10_000

    const b1 = await rateLimitEnhanced(key, sustainedLimit, sustainedWindowMs, { burstLimit, burstWindowMs })
    expect(b1.allowed).toBe(true)
    const b2 = await rateLimitEnhanced(key, sustainedLimit, sustainedWindowMs, { burstLimit, burstWindowMs })
    expect(b2.allowed).toBe(true)
    const b3 = await rateLimitEnhanced(key, sustainedLimit, sustainedWindowMs, { burstLimit, burstWindowMs })
    expect(b3.allowed).toBe(false)
    expect(b3.retryAfter).toBeGreaterThan(0)
    vi.advanceTimersByTime(burstWindowMs)
    const b4 = await rateLimitEnhanced(key, sustainedLimit, sustainedWindowMs, { burstLimit, burstWindowMs })
    expect(b4.allowed).toBe(true)
  })
})
