import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as logDetail } from '@/app/api/admin/logs/[id]/route'
import { GET as logs } from '@/app/api/admin/logs/route'
import { GET as settings, POST as addFlag, PATCH as updateFlag } from '@/app/api/admin/settings/route'

const mock = vi.hoisted(() => ({ allowed: true, result: { data: [] as unknown, error: null as null | { code?: string; message: string } }, from: vi.fn(), insert: vi.fn(), upsert: vi.fn() }))
vi.mock('@/lib/auth/admin', () => ({ requireAdmin: vi.fn(async () => ({ allowed: mock.allowed })) }))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { from: mock.from } }))

function request(path: string, body?: unknown, method = 'POST') {
  return new NextRequest(`http://localhost/api/admin/${path}`, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mock.allowed = true
  mock.result = { data: [], error: null }
  mock.insert.mockImplementation(async () => mock.result)
  mock.upsert.mockImplementation(async () => mock.result)
  mock.from.mockImplementation(() => {
    const query: Record<string, unknown> = { then: (resolve: (value: unknown) => void) => Promise.resolve(mock.result).then(resolve), insert: mock.insert, upsert: mock.upsert }
    for (const name of ['select', 'order', 'limit', 'eq', 'maybeSingle']) query[name] = vi.fn(() => query)
    return query
  })
})

describe('trusted admin settings and moderation log access', () => {
  it('denies every operation before touching private tables', async () => {
    mock.allowed = false
    for (const [handler, req] of [
      [settings, request('settings')], [addFlag, request('settings', { key: 'payments_enabled', enabled: true })],
      [updateFlag, request('settings', { key: 'payments_enabled', enabled: true }, 'PATCH')], [logs, request('logs')],
      [logDetail, request('logs/11111111-1111-4111-8111-111111111111')],
    ] as const) expect((await handler(req)).status).toBe(403)
    expect(mock.from).not.toHaveBeenCalled()
  })

  it('returns flags and validates writes instead of accepting arbitrary fields', async () => {
    mock.result.data = [{ key: 'payments_enabled', enabled: true }]
    expect(await (await settings(request('settings'))).json()).toEqual({ flags: mock.result.data })
    for (const body of [{ key: 'payments_enabled', enabled: 'true' }, { key: '', enabled: true }, { key: 'payments_enabled', enabled: true, role: 'admin' }]) {
      expect((await addFlag(request('settings', body))).status).toBe(400)
    }
    expect(mock.insert).not.toHaveBeenCalled()
  })

  it('creates flags separately from updates and reports duplicate or failed persistence', async () => {
    const flag = { key: 'payments_enabled', enabled: true }
    expect((await addFlag(request('settings', flag))).status).toBe(201)
    expect(mock.insert).toHaveBeenCalledWith(flag)
    expect((await updateFlag(request('settings', flag, 'PATCH'))).status).toBe(200)
    expect(mock.upsert).toHaveBeenCalledWith(flag)
    mock.result.error = { code: '23505', message: 'duplicate' }
    expect((await addFlag(request('settings', flag))).status).toBe(409)
    mock.result.error = { message: 'offline' }
    expect((await updateFlag(request('settings', flag, 'PATCH'))).status).toBeGreaterThanOrEqual(500)
  })

  it('serves bounded log reads and handles invalid, missing and failed detail reads', async () => {
    const row = { id: '11111111-1111-4111-8111-111111111111', action: 'suspend' }
    mock.result.data = [row]
    expect(await (await logs(request('logs'))).json()).toEqual({ logs: [row] })
    expect(mock.from.mock.results.at(-1)?.value.limit).toHaveBeenCalledWith(11)
    expect((await logDetail(request('logs/not-a-uuid'))).status).toBe(400)
    mock.result.data = row
    expect(await (await logDetail(request(`logs/${row.id}`))).json()).toEqual({ log: row })
    mock.result.data = null
    expect((await logDetail(request(`logs/${row.id}`))).status).toBe(404)
    mock.result.error = { message: 'offline' }
    expect((await logs(request('logs'))).status).toBeGreaterThanOrEqual(500)
  })
})
