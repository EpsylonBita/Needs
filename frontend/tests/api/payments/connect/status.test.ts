import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), retrieve: vi.fn(), update: vi.fn(), saved: vi.fn(), profile: vi.fn() }))
vi.mock('@/lib/stripe/server', () => ({ stripe: { accounts: { retrieve: mocks.retrieve } } }))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: {
  auth: { getUser: mocks.getUser },
  from: () => ({
    select: () => ({ eq: () => ({ single: mocks.profile }) }),
    update: (value: unknown) => { mocks.update(value); return { eq: mocks.saved } },
  }),
} }))
import { GET } from '@/app/api/payments/connect/status/route'

describe('Connect onboarding status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'owner' } }, error: null })
    mocks.profile.mockResolvedValue({ data: { stripe_account_id: 'acct_owner' }, error: null })
    mocks.saved.mockResolvedValue({ error: null })
    mocks.retrieve.mockResolvedValue({ id: 'acct_owner', type: 'express', details_submitted: true, charges_enabled: false, payouts_enabled: true, capabilities: { transfers: 'active' } })
  })
  const request = () => new NextRequest('http://localhost/api/payments/connect/status', { headers: { Authorization: 'Bearer valid' } })

  it('requires authentication before reading Stripe account information', async () => {
    expect((await GET(new NextRequest('http://localhost/api/payments/connect/status'))).status).toBe(401)
    expect(mocks.retrieve).not.toHaveBeenCalled()
  })
  it('uses the authenticated profile and current transfers capability', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ connected: true, ready: true, chargesEnabled: false, transfersEnabled: true })
    expect(mocks.retrieve).toHaveBeenCalledWith('acct_owner')
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ stripe_onboarding_complete: true }))
    expect(mocks.saved).toHaveBeenCalledWith('stripe_account_id', 'acct_owner')
  })
  it('does not call incomplete onboarding ready just because Stripe returned to the application', async () => {
    mocks.retrieve.mockResolvedValue({ id: 'acct_owner', details_submitted: true, payouts_enabled: false, charges_enabled: false, capabilities: { transfers: 'pending' } })
    expect(await (await GET(request())).json()).toMatchObject({ ready: false, transfersEnabled: false })
  })
  it('reports status persistence failures instead of displaying success', async () => {
    mocks.saved.mockResolvedValue({ error: { message: 'database unavailable' } })
    expect((await GET(request())).status).toBe(500)
  })
})
