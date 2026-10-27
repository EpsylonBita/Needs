// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { publicComparables, publicListing } from '@/lib/pricing/public-data'
import type { PricingSubject } from '@/lib/pricing/types'

const mocks = vi.hoisted(() => ({ create: vi.fn(), from: vi.fn(), rows: [] as Record<string, unknown>[], filters: [] as { method: string; args: unknown[] }[] }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.create }))
const sony: PricingSubject = { title: 'Sony WH-1000XM5 Black', description: 'Used black headphones.', mainCategory: 'Items', subCategory: 'Sell', coordinates: null }
const row = (seller = 'other') => ({ id: 'listing-id', seller_id: seller, title: sony.title, description: sony.description, price: 200, main_category: 'Items', sub_category: 'Sell', location: null, status: 'active' })
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-key')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'must-not-be-used')
  mocks.filters = []; mocks.rows = [row()]
  const builder: Record<string, unknown> = { then: (resolve: (value: unknown) => void) => resolve({ data: mocks.rows, error: null }) }
  for (const method of ['select', 'eq', 'in', 'gt', 'gte', 'ilike', 'order', 'limit', 'abortSignal']) builder[method] = (...args: unknown[]) => { mocks.filters.push({ method, args }); return builder }
  builder.maybeSingle = () => Promise.resolve({ data: mocks.rows[0] ?? null, error: null })
  mocks.from.mockReturnValue(builder); mocks.create.mockReturnValue({ from: mocks.from })
})
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

describe('public pricing evidence', () => {
  it('uses anonymous RLS reads, active recent sell offers and excludes all own profiles', async () => {
    mocks.rows = [row(), { ...row('self'), id: 'own-listing' }]
    expect(await publicComparables(sony, ['self'])).toHaveLength(1)
    expect(mocks.create).toHaveBeenCalledWith('https://project.supabase.co', 'public-key', { auth: { persistSession: false, autoRefreshToken: false } })
    expect(mocks.filters).toEqual(expect.arrayContaining([
      { method: 'eq', args: ['status', 'active'] }, { method: 'in', args: ['sub_category', ['Sell']] },
      { method: 'limit', args: [100] }, { method: 'gt', args: ['price', 0] },
    ]))
    expect(mocks.filters.find(filter => filter.method === 'gte')?.args[0]).toBe('created_at')
  })

  it.each([
    [sony, 'Sony WH-1000XM5 Black'],
    [{ ...sony, title: 'Samsung Galaxy S25 Ultra 256GB Black', description: 'Used phone.' }, 'Samsung Galaxy S25 Ultra 256GB Black'],
  ])('prefilters canonical models without losing real punctuation or family words', async (subject, realisticTitle) => {
    await publicComparables(subject, [])
    const pattern = mocks.filters.find(filter => filter.method === 'ilike')?.args[1] as string
    const regex = new RegExp(`^${pattern.replace(/%/g, '.*')}$`, 'i')
    expect(regex.test(realisticTitle)).toBe(true)
  })

  it('can compare retail for a public negotiable product with no fixed asking price', async () => {
    mocks.rows = [{ ...row(), price: 0 }]
    expect(await publicListing('listing-id')).toMatchObject({ title: sony.title, price: 0 })
    mocks.rows = [{ ...row(), status: 'suspended' }]
    expect(await publicListing('listing-id')).toBeNull()
  })
})
