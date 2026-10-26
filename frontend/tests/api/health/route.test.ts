import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { getAdmin, from, select, limit, abortSignal } = vi.hoisted(() => ({
  getAdmin: vi.fn(), from: vi.fn(), select: vi.fn(), limit: vi.fn(), abortSignal: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: getAdmin }))
vi.mock('@/lib/utils/logger', () => ({ log: vi.fn() }))
import { GET as health } from '@/app/api/health/route'
import { GET as healthCheck } from '@/app/api/health-check/route'

describe.each([
  { path: 'health', handler: health, nested: false },
  { path: 'health-check', handler: healthCheck, nested: true },
])('$path database readiness', ({ path, handler, nested }) => {
  beforeEach(() => {
    vi.resetAllMocks()
    getAdmin.mockReturnValue({ from })
    from.mockReturnValue({ select })
    select.mockReturnValue({ limit })
    limit.mockReturnValue({ abortSignal })
    abortSignal.mockResolvedValue({ data: [], error: null })
  })

  it('returns 200 for a reachable database, including an empty profiles table', async () => {
    const response = await handler(new NextRequest(`http://localhost/api/${path}`))
    const body = await response.json()
    const probe = nested ? body.database : body
    expect(response.status).toBe(200)
    expect(probe.status).toBe('ok')
    expect(probe.database.status).toBe('connected')
    if (nested) expect(body.success).toBe(true)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal))
  })

  it.each(['returned error', 'network failure', 'missing configuration'])('returns 503 for %s without exposing database details', async (failure) => {
    const privateError = 'private host db-internal, password=secret'
    if (failure === 'returned error') abortSignal.mockResolvedValue({ data: null, error: { message: privateError } })
    if (failure === 'network failure') abortSignal.mockRejectedValue(new Error(privateError))
    if (failure === 'missing configuration') getAdmin.mockImplementation(() => { throw new Error(privateError) })
    const response = await handler(new NextRequest(`http://localhost/api/${path}`))
    const body = await response.json()
    const probe = nested ? body.database : body
    expect(response.status).toBe(503)
    expect(probe).toMatchObject({ status: 'error', database: { status: 'error', message: 'database unavailable' } })
    if (nested) expect(body.success).toBe(false)
    expect(JSON.stringify(body)).not.toContain(privateError)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })
})
