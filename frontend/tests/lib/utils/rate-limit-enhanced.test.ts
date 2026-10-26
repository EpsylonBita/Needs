import { describe, it, expect, vi, beforeEach } from 'vitest'

const { rpc, getAdmin } = vi.hoisted(() => ({ rpc: vi.fn(), getAdmin: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: getAdmin }))
vi.mock('@/lib/utils/logger', () => ({ log: vi.fn() }))

import { rateLimitEnhanced, rateLimiter } from '@/lib/utils/rate-limit-enhanced'
import { rateLimit } from '@/lib/utils/rate-limit'

const resetAt = '2026-10-26T14:00:00.000Z'
const accepted = (remaining = 1) => ({ data: { allowed: true, remaining, reset_at: resetAt, retry_after: 0 }, error: null })
const unavailable = { data: null, error: { message: 'database unavailable' } }

describe('atomic rate limit service', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    getAdmin.mockReturnValue({ rpc })
    rpc.mockResolvedValue(accepted())
  })

  it('uses the atomic database counter and its authoritative reset time', async () => {
    const result = await rateLimitEnhanced('api:public:one', 2, 60_000)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('consume_rate_limit', { p_key: 'api:public:one', p_limit: 2, p_window_ms: 60_000 })
    expect(result).toEqual({ allowed: true, remaining: 1, resetAt: new Date(resetAt) })
  })

  it('returns the database denial and retry time', async () => {
    rpc.mockResolvedValue({ data: { allowed: false, remaining: 0, reset_at: resetAt, retry_after: 13 }, error: null })
    expect(await rateLimitEnhanced('test', 2, 60_000, { message: 'Wait' })).toEqual({
      allowed: false, remaining: 0, resetAt: new Date(resetAt), retryAfter: 13, message: 'Wait',
    })
  })

  it.each([
    ['returned database error', () => rpc.mockResolvedValue(unavailable)],
    ['network rejection', () => rpc.mockRejectedValue(new Error('network'))],
    ['missing server configuration', () => getAdmin.mockImplementation(() => { throw new Error('missing credentials') })],
  ])('fails closed on %s without a read/write fallback', async (_name, arrange) => {
    arrange()
    expect(await rateLimitEnhanced('payments', 2, 60_000, { failClosed: true, message: 'Try later' })).toEqual({
      allowed: false, remaining: 0, retryAfter: 60, message: 'Try later',
    })
  })

  it.each([null, {}, { allowed: true }, { allowed: true, remaining: 2, reset_at: resetAt, retry_after: 0 },
    { allowed: true, remaining: 1, reset_at: 'invalid', retry_after: 0 },
    { allowed: false, remaining: 0, reset_at: resetAt, retry_after: 0 },
    { allowed: true, remaining: 1, reset_at: resetAt, retry_after: 1 },
  ])('rejects malformed RPC responses: %j', async (data) => {
    rpc.mockResolvedValue({ data, error: null })
    expect(await rateLimitEnhanced('test', 2, 60_000, { failClosed: true })).toMatchObject({ allowed: false, retryAfter: 60 })
  })

  it('retains the fail-open policy for public callers on a database outage', async () => {
    rpc.mockResolvedValue(unavailable)
    expect(await rateLimitEnhanced('search', 2, 60_000)).toEqual({ allowed: true, remaining: 2 })
  })

  it('fails closed when the burst counter is unavailable and does not consume the sustained counter', async () => {
    rpc.mockResolvedValue(unavailable)
    expect(await rateLimitEnhanced('payments', 10, 60_000, { burstLimit: 2, burstWindowMs: 10_000, failClosed: true })).toMatchObject({ allowed: false, retryAfter: 60 })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('consume_rate_limit', { p_key: 'payments:burst', p_limit: 2, p_window_ms: 10_000 })
  })

  it('fails closed when the sustained counter is unavailable after the burst check passed', async () => {
    rpc.mockResolvedValueOnce(accepted()).mockResolvedValueOnce(unavailable)
    expect(await rateLimitEnhanced('payments', 10, 60_000, { burstLimit: 2, burstWindowMs: 10_000, failClosed: true })).toMatchObject({ allowed: false, remaining: 0, retryAfter: 60 })
    expect(rpc).toHaveBeenNthCalledWith(2, 'consume_rate_limit', { p_key: 'payments:sustained', p_limit: 10, p_window_ms: 60_000 })
  })

  it('combines successful burst and sustained windows', async () => {
    rpc.mockResolvedValueOnce(accepted()).mockResolvedValueOnce({ ...accepted(7), data: { ...accepted(7).data, reset_at: '2026-10-26T15:00:00.000Z' } })
    expect(await rateLimitEnhanced('payments', 10, 60_000, { burstLimit: 2, burstWindowMs: 10_000 })).toEqual({ allowed: true, remaining: 1, resetAt: new Date(resetAt) })
  })

  it.each([false, true])('propagates failClosed to progressive limiting (authenticated: %s)', async (isAuthenticated) => {
    rpc.mockResolvedValue(unavailable)
    expect(await rateLimitEnhanced('login', 2, 60_000, { isAuthenticated, failClosed: true })).toMatchObject({ allowed: false, retryAfter: 60 })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('consume_rate_limit', { p_key: isAuthenticated ? 'login:auth' : 'login:anon', p_limit: isAuthenticated ? 10 : 2, p_window_ms: 60_000 })
  })

  it('makes the legacy administrative wrapper fail closed too', async () => {
    rpc.mockResolvedValue(unavailable)
    expect(await rateLimit('admin:create:one', 2, 60_000)).toEqual({ allowed: false })
  })

  it.each([
    { key: '', limit: 2, windowMs: 1 }, { key: 'test', limit: 0, windowMs: 1 },
    { key: 'test', limit: 2, windowMs: 0 }, { key: 'test', limit: 1.5, windowMs: 1 },
    { key: 'test', limit: 2, windowMs: 2147483648 },
  ])('rejects invalid counter configuration before database access: %j', async (config) => {
    expect(await rateLimiter.limit(config)).toEqual({ allowed: false, remaining: 0 })
    expect(rpc).not.toHaveBeenCalled()
  })
})
