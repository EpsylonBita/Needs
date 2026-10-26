import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteListing, getMyListing, getMyListings, updateListing, updateListingStatus, type CreateListingInput, type OwnedListing } from '@/lib/services/listing-service'

const state = vi.hoisted(() => ({ userId: 'account-one' as string | null, rpc: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null }, error: null }) },
  rpc: (...args: unknown[]) => Object.assign(state.rpc(...args), { abortSignal() { return this } }),
} }))
const row: OwnedListing = {
  id: 'listing-one', seller_id: 'profile-one', title: 'A guitar', description: 'A useful acoustic guitar', price: 12.5,
  main_category: 'Items', sub_category: 'Sell', status: 'suspended', owner_status: 'active', moderation_suspended: true,
  created_at: '2026-10-19T12:00:00Z', address: { label: 'Athens' }, coordinates: [23.7, 37.9], contact_number: '+301234567890', tags: ['music'],
  images: [{ id: 'image-one', url: 'https://images.example/guitar.jpg', storage_path: 'account-one/listing-one/guitar.jpg', main: true }],
  can_edit: true, can_edit_images: false, category_locked: false, price_locked: false,
}
const edit: CreateListingInput = { title: row.title, description: row.description, main_category: row.main_category, sub_category: row.sub_category, price: '12,50', address: row.address, coordinates: row.coordinates, contact_number: row.contact_number!, tags: row.tags }
beforeEach(() => { state.userId = 'account-one'; state.rpc.mockReset().mockResolvedValue({ data: row, error: null }) })

describe('owner listing reads and edits', () => {
  it.each(['', undefined, 0])('rejects a missing rate amount %s before the owner update RPC', async price => {
    await expect(updateListing(row.id, { ...edit, description: 'Home care 10€/hour', main_category: 'Services', sub_category: 'I can', price }, 'account-one')).rejects.toThrow('positive price');
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('retains explicit Free when the description contains an earlier rate', async () => {
    const description = 'Previously rented at 10€/hour';
    state.rpc.mockResolvedValue({ data: { ...row, sub_category: 'Free', price: 0, description }, error: null });
    await updateListing(row.id, { ...edit, description, sub_category: 'Free', price: '' }, 'account-one');
    expect(state.rpc.mock.calls[0][1].p_input).toMatchObject({ price: 0, sub_category: 'Free', description });
  });

  it('loads actual own listings and preserves moderation, images and history restrictions', async () => {
    state.rpc.mockResolvedValueOnce({ data: [row], error: null })
    await expect(getMyListings('account-one')).resolves.toEqual([row])
    await expect(getMyListing(row.id, 'account-one')).resolves.toEqual(row)
    expect(state.rpc).toHaveBeenCalledWith('get_my_listings', { p_expected_user_id: 'account-one' })
    expect(state.rpc).toHaveBeenCalledWith('get_my_listing', { p_listing_id: row.id, p_expected_user_id: 'account-one' })
  })

  it('reports profile/permission/database failures instead of showing an empty account', async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Profile not found' } })
    await expect(getMyListings('account-one')).rejects.toThrow('Profile not found')
    state.rpc.mockResolvedValueOnce({ data: null, error: null })
    await expect(getMyListings('account-one')).rejects.toThrow('could not be loaded')
    state.rpc.mockResolvedValueOnce({ data: [], error: null })
    await expect(getMyListings('account-one')).resolves.toEqual([])
  })

  it('rejects previous-account calls before RPC and discards late responses after switching', async () => {
    await expect(getMyListings('account-two')).rejects.toThrow('session changed')
    expect(state.rpc).not.toHaveBeenCalled()
    state.rpc.mockImplementationOnce(async () => { state.userId = 'account-two'; return { data: [row], error: null } })
    await expect(getMyListings('account-one')).rejects.toThrow('session changed')
  })

  it('sends only normalized editable fields and returns the saved held row without releasing moderation', async () => {
    await expect(updateListing(row.id, { ...edit, title: '  A guitar  ', tags: ['music', ' music ', ''], status: 'active', seller_id: 'foreign', moderation_suspended: false } as CreateListingInput, 'account-one')).resolves.toEqual(row)
    expect(state.rpc).toHaveBeenCalledWith('update_my_listing', {
      p_listing_id: row.id, p_expected_user_id: 'account-one',
      p_input: { title: 'A guitar', description: row.description, main_category: 'Items', sub_category: 'Sell', price: 12.5, coordinates: [23.7, 37.9], address: { label: 'Athens' }, contact_number: '+301234567890', tags: ['music'] },
    })
  })

  it.each([
    { title: 'xy' }, { title: 'x'.repeat(201) }, { description: 'short' }, { description: 'x'.repeat(10001) },
    { price: '-2' }, { price: '1.234' }, { sub_category: 'I can' }, { coordinates: [181, 37] },
    { contact_number: 'x'.repeat(51) }, { tags: ['x'.repeat(51)] }, { tags: Array.from({ length: 21 }, (_, i) => `tag${i}`) },
  ])('rejects invalid edit input before any database mutation: %j', async input => {
    await expect(updateListing(row.id, { ...edit, ...input } as CreateListingInput, 'account-one')).rejects.toThrow()
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it('forces free price zero and preserves legacy null location without inventing coordinates', async () => {
    state.rpc.mockResolvedValue({ data: { ...row, sub_category: 'Free', price: 0, coordinates: null }, error: null })
    await updateListing(row.id, { ...edit, sub_category: 'Free', price: '99', coordinates: null }, 'account-one')
    expect(state.rpc.mock.calls[0][1].p_input).toMatchObject({ price: 0, coordinates: null })
  })

  it('does not claim success for another row or an absent mutation result', async () => {
    state.rpc.mockResolvedValueOnce({ data: { ...row, id: 'another-listing' }, error: null })
    await expect(updateListing(row.id, edit, 'account-one')).rejects.toThrow('could not be loaded')
    state.rpc.mockResolvedValueOnce({ data: null, error: null })
    await expect(deleteListing(row.id, 'account-one')).rejects.toThrow('could not be deleted')
  })
  it('does not claim a content or status update when the returned persisted values disagree', async () => {
    await expect(updateListing(row.id, { ...edit, title: 'Changed guitar title' }, 'account-one')).rejects.toThrow('could not be verified')
    await expect(updateListingStatus(row.id, 'active', 'account-one')).rejects.toThrow('could not be verified')
  })

  it('uses authenticated guarded status/delete operations, propagating transaction and moderation rejection', async () => {
    state.rpc.mockResolvedValueOnce({ data: { ...row, status: 'sold', owner_status: 'sold', moderation_suspended: false }, error: null })
    await updateListingStatus(row.id, 'sold', 'account-one')
    expect(state.rpc).toHaveBeenCalledWith('update_my_listing_status', { p_listing_id: row.id, p_status: 'sold', p_expected_user_id: 'account-one' })
    state.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Listing has history' } })
    await expect(deleteListing(row.id, 'account-one')).rejects.toThrow('Listing has history')
    state.rpc.mockResolvedValueOnce({ data: { id: row.id }, error: null })
    await deleteListing(row.id, 'account-one')
  })

  it('aborts obsolete reads before requesting data', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(getMyListing(row.id, 'account-one', controller.signal)).rejects.toThrow()
    expect(state.rpc).not.toHaveBeenCalled()
  })
})
