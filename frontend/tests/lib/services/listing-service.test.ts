import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createListing, parseListingPrice } from '@/lib/services/listing-service'

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), insertListing: vi.fn(), insertTags: vi.fn(), remove: vi.fn(), profile: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ supabase: {
  auth: { getUser: mocks.getUser },
  from: (table: string) => table === 'profiles'
    ? { select: () => ({ eq: () => ({ order: () => ({ limit: mocks.profile }) }) }) }
    : table === 'listing_tags' ? { insert: mocks.insertTags }
    : { insert: (value: unknown) => { mocks.insertListing(value); return { select: () => ({ single: async () => ({ data: { id: 'listing' }, error: null }) }) } }, delete: () => ({ eq: mocks.remove }) },
} }))
const listing = { title: 'A guitar', description: 'A useful acoustic guitar', main_category: 'Items' as const, sub_category: 'Sell' as const, price: '12,50', coordinates: [23.7, 37.9] as [number, number], tags: ['music'], contact_number: '+301234567890' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user' } }, error: null })
  mocks.profile.mockResolvedValue({ data: [{ id: 'profile', stripe_account_id: 'acct_test' }], error: null })
  mocks.insertTags.mockResolvedValue({ error: null })
  mocks.remove.mockResolvedValue({ error: null })
})
describe('listing persistence', () => {
  it('rejects the previous account draft before profile lookup or writes', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'account-b' } }, error: null });
    await expect(createListing(listing, 'account-a')).rejects.toThrow('session changed');
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.insertListing).not.toHaveBeenCalled();
  });
  it('rechecks the captured account after profile lookup and before insertion', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: 'account-a' } }, error: null })
      .mockResolvedValueOnce({ data: { user: { id: 'account-b' } }, error: null });
    await expect(createListing(listing, 'account-a')).rejects.toThrow('session changed');
    expect(mocks.profile).toHaveBeenCalledOnce();
    expect(mocks.insertListing).not.toHaveBeenCalled();
    expect(mocks.insertTags).not.toHaveBeenCalled();
  });
  it('does not continue after the form cancels during profile lookup', async () => {
    const controller = new AbortController();
    mocks.profile.mockImplementation(async () => { controller.abort(); return { data: [{ id: 'profile', stripe_account_id: 'acct_test' }], error: null }; });
    await expect(createListing(listing, 'user', controller.signal)).rejects.toThrow();
    expect(mocks.insertListing).not.toHaveBeenCalled();
  });
  it.each(['', undefined, 0])('rejects a missing rate amount %s before authentication or writes', async price => {
    await expect(createListing({ ...listing, description: 'Home care 10€/hour', main_category: 'Services', sub_category: 'I can', price })).rejects.toThrow('positive price');
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.insertListing).not.toHaveBeenCalled();
  });

  it('retains positive rate amounts and the original description', async () => {
    await createListing({ ...listing, description: 'Home care 10€/hour', main_category: 'Services', sub_category: 'I can', price: '12' });
    expect(mocks.insertListing).toHaveBeenCalledWith(expect.objectContaining({ price: 12, description: 'Home care 10€/hour' }));
  });

  it('preserves fixed-total optional prices and explicit Free even with prior rate wording', async () => {
    await createListing({ ...listing, price: '' });
    expect(mocks.insertListing).toHaveBeenLastCalledWith(expect.objectContaining({ price: 0 }));
    await createListing({ ...listing, sub_category: 'Free', description: 'Previously rented at 10€/hour', price: '' });
    expect(mocks.insertListing).toHaveBeenLastCalledWith(expect.objectContaining({ price: 0, sub_category: 'Free' }));
  });

  it('preserves comma decimals and valid PostGIS coordinates and contact data', async () => {
    await createListing(listing)
    expect(mocks.insertListing).toHaveBeenCalledWith(expect.objectContaining({ price: 12.5, location: 'SRID=4326;POINT(23.7 37.9)', contact_number: '+301234567890' }))
  })
  it.each(['-10', 'twelve', '1.234', 'Infinity', Number.NaN])('rejects invalid price %s before writing data', value => {
    expect(() => parseListingPrice(value)).toThrow()
    expect(mocks.insertListing).not.toHaveBeenCalled()
  })
  it('does not send a listing with no location to the database', async () => {
    await expect(createListing({ ...listing, coordinates: null })).rejects.toThrow('location')
    expect(mocks.insertListing).not.toHaveBeenCalled()
  })
  it('removes a partial listing if tags cannot be saved and reports failure', async () => {
    mocks.insertTags.mockResolvedValue({ error: new Error('Tags unavailable') })
    await expect(createListing(listing)).rejects.toThrow('Tags unavailable')
    expect(mocks.remove).toHaveBeenCalledWith('id', 'listing')
  })
  it('permits a free listing without requiring a payment account', async () => {
    mocks.profile.mockResolvedValue({ data: [{ id: 'profile', stripe_account_id: null }], error: null })
    await expect(createListing({ ...listing, sub_category: 'Free', price: '' })).resolves.toEqual({ id: 'listing' })
    expect(mocks.insertListing).toHaveBeenCalledWith(expect.objectContaining({ price: 0 }))
  })
})
