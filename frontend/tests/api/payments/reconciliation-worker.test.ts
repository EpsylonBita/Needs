import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ batch: vi.fn() }))
vi.mock('@/lib/payments/reconciliation-worker', () => ({ reconcilePaymentBatch: () => mock.batch() }))
import { POST } from '@/app/api/internal/payments/reconcile/route'
import { proxy } from '@/proxy'
const secret = 'a'.repeat(64)
const request = (token = secret, path = '/api/internal/payments/reconcile', method = 'POST') => new NextRequest(`http://localhost${path}`, { method, headers: { Authorization: `Bearer ${token}` } })
beforeEach(() => { vi.stubEnv('PAYMENTS_WORKER_SECRET', secret); mock.batch.mockReset().mockResolvedValue({ claimed: 2, completed: 2, failed: 0 }) })
describe('payment reconciliation scheduler boundary', () => {
  it('requires the dedicated configured scheduler secret', async () => {
    expect((await POST(request('user-session'))).status).toBe(401)
    vi.stubEnv('PAYMENTS_WORKER_SECRET', '')
    expect((await POST(request())).status).toBe(503)
    expect(mock.batch).not.toHaveBeenCalled()
  })
  it('reports incomplete work as non-success for monitoring', async () => {
    expect((await POST(request())).status).toBe(200)
    mock.batch.mockResolvedValue({ claimed: 2, completed: 1, failed: 1 })
    expect((await POST(request())).status).toBe(503)
    mock.batch.mockRejectedValue(new Error('private key diagnostic'))
    const response = await POST(request()); expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('private key')
  })
  it('exempts only the exact secret-authenticated POST from browser CSRF', async () => {
    expect((await proxy(request())).status).toBe(200)
    for (const [path, method] of [['/api/internal/payments/reconcile/other', 'POST'], ['/api/internal/payments/reconcile', 'PATCH'], ['/api/orders/cancel', 'POST'], ['/api/orders/reconcile', 'POST']]) {
      expect((await proxy(request(secret, path, method))).status).toBe(403)
    }
  })
})
