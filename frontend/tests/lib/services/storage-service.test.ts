import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListingImage, OwnedListing } from '@/lib/services/listing-service'

const state = vi.hoisted(() => ({
  userId: 'user-1' as string | null, ownsListing: true, held: false,
  attachError: false, lostAttachResponse: false, reconciliationFails: false, metadataAttempted: false,
  mainError: false, deleteError: false, images: [] as ListingImage[], rpc: vi.fn(), upload: vi.fn(), remove: vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null }, error: null }) },
  rpc: (...args: unknown[]) => Object.assign(state.rpc(...args), { abortSignal() { return this } }),
  storage: { from: () => ({ upload: state.upload, remove: state.remove, getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.example/${path}` } }) }) },
} }))

import { deleteListingImage, listListingImages, setMainListingImage, uploadListingImages, LISTING_IMAGE_MAX_BYTES } from '@/lib/services/storage-service'

const saved: ListingImage = { id: 'image-1', url: 'https://storage.example/saved.jpg', storage_path: 'user-1/listing-1/saved.jpg', main: true }
const owned = (): OwnedListing => ({
  id: 'listing-1', seller_id: 'profile-1', title: 'A guitar', description: 'An acoustic guitar', price: 10, main_category: 'Items', sub_category: 'Sell',
  status: state.held ? 'suspended' : 'active', owner_status: 'active', moderation_suspended: state.held,
  created_at: '2026-10-19T12:00:00Z', coordinates: [23.7, 37.9], address: { label: 'Athens' }, contact_number: null, tags: [], images: [...state.images],
  can_edit: true, can_edit_images: !state.held, category_locked: false, price_locked: false,
})
const photo = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'photo.jpg', { type: 'image/jpeg' })
beforeEach(() => {
  state.userId = 'user-1'; state.ownsListing = true; state.held = false; state.attachError = false; state.lostAttachResponse = false
  state.reconciliationFails = false; state.metadataAttempted = false; state.mainError = false; state.deleteError = false; state.images = [{ ...saved }]
  state.upload.mockReset().mockResolvedValue({ data: {}, error: null })
  state.remove.mockReset().mockResolvedValue({ data: [], error: null })
  state.rpc.mockReset().mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === 'get_my_listing') return !state.ownsListing ? { data: null, error: { message: 'You do not own this listing' } }
      : state.reconciliationFails && state.metadataAttempted ? { data: null, error: { message: 'Offline' } } : { data: owned(), error: null }
    if (name === 'attach_listing_images') {
      state.metadataAttempted = true
      if (state.attachError) return { data: null, error: { message: 'metadata unavailable' } }
      const input = args.p_images as { url: string; storage_path: string }[]
      const hasMain = state.images.some(row => row.main)
      state.images.push(...input.map((row, index) => ({ ...row, id: `new-${index}`, main: !hasMain && index === 0 })))
      return state.lostAttachResponse ? { data: null, error: { message: 'Response lost' } } : { data: [...state.images], error: null }
    }
    if (name === 'set_main_listing_image') {
      if (state.mainError) return { data: null, error: { message: 'Main image unavailable' } }
      state.images = state.images.map(row => ({ ...row, main: row.id === args.p_image_id }))
      return { data: [...state.images], error: null }
    }
    if (name === 'delete_listing_image') {
      if (state.deleteError) return { data: null, error: { message: 'Metadata delete failed' } }
      state.images = state.images.filter(row => row.id !== args.p_image_id)
      return { data: { id: args.p_image_id, storage_path: saved.storage_path }, error: null }
    }
    throw new Error(`Unexpected RPC ${name}`)
  })
})

describe('listing image persistence', () => {
  it('rejects non-owners and moderated listings before uploading anything', async () => {
    state.ownsListing = false
    await expect(uploadListingImages('listing-1', [photo()], 'user-1')).rejects.toThrow(/own|permission/i)
    state.ownsListing = true; state.held = true
    await expect(uploadListingImages('listing-1', [photo()], 'user-1')).rejects.toThrow(/moderation/)
    expect(state.upload).not.toHaveBeenCalled()
  })
  it('limits each upload batch to 20 files without imposing a total gallery cap', async () => {
    await expect(uploadListingImages('listing-1', Array.from({ length: 21 }, photo), 'user-1')).rejects.toThrow('per upload')
    expect(state.upload).not.toHaveBeenCalled()
    state.images = Array.from({ length: 21 }, (_, i) => ({ ...saved, id: `existing-${i}`, main: i === 0 }))
    await expect(uploadListingImages('listing-1', [photo()], 'user-1')).resolves.toHaveLength(1)
    expect(state.images).toHaveLength(22)
  })
  it.each([
    () => new File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' }),
    () => new File(['<svg/>'], 'fake.jpg', { type: 'image/jpeg' }),
    () => new File([new Uint8Array(LISTING_IMAGE_MAX_BYTES + 1)], 'huge.jpg', { type: 'image/jpeg' }),
  ])('rejects unsupported, disguised or oversized files before uploading any file in the batch', async invalid => {
    await expect(uploadListingImages('listing-1', [photo(), invalid()], 'user-1')).rejects.toThrow()
    expect(state.upload).not.toHaveBeenCalled()
  })
  it('rolls back unreferenced objects after a confirmed metadata failure', async () => {
    state.attachError = true
    await expect(uploadListingImages('listing-1', [photo()], 'user-1')).rejects.toThrow('metadata unavailable')
    expect(state.remove).toHaveBeenCalledWith([state.upload.mock.calls[0][0]])
    expect(state.images).toEqual([saved])
  })
  it('cleans earlier objects when a later upload fails', async () => {
    state.upload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'upload unavailable' } })
    await expect(uploadListingImages('listing-1', [photo(), photo()], 'user-1')).rejects.toThrow('upload unavailable')
    expect(state.remove).toHaveBeenCalledWith([state.upload.mock.calls[0][0]])
    expect(state.metadataAttempted).toBe(false)
  })
  it('verifies persisted images and does not destroy them when the successful attach response is lost', async () => {
    state.lostAttachResponse = true
    const result = await uploadListingImages('listing-1', [photo()], 'user-1')
    expect(result).toHaveLength(1)
    expect(state.images.some(image => image.storage_path === result[0].path)).toBe(true)
    expect(state.remove).not.toHaveBeenCalled()
    expect(state.rpc).toHaveBeenCalledWith('attach_listing_images', expect.objectContaining({ p_expected_user_id: 'user-1', p_listing_id: 'listing-1' }))
  })
  it('preserves objects when an uncertain attach cannot be reconciled instead of deleting potentially saved photos', async () => {
    state.attachError = true; state.reconciliationFails = true
    await expect(uploadListingImages('listing-1', [photo()], 'user-1')).rejects.toThrow('may have been saved')
    expect(state.remove).not.toHaveBeenCalled()
  })
  it('does not delete metadata when storage removal fails', async () => {
    state.remove.mockResolvedValue({ error: { message: 'storage unavailable' } })
    await expect(deleteListingImage('listing-1', 'image-1', undefined, 'user-1')).rejects.toThrow('storage unavailable')
    expect(state.rpc.mock.calls.some(call => call[0] === 'delete_listing_image')).toBe(false)
  })
  it('uses the canonical stored path and a guarded metadata transaction, never the supplied path', async () => {
    await deleteListingImage('listing-1', 'image-1', 'another-user/private.jpg', 'user-1')
    expect(state.remove).toHaveBeenCalledWith(['user-1/listing-1/saved.jpg'])
    expect(state.images).toEqual([])
    expect(state.rpc).toHaveBeenCalledWith('delete_listing_image', { p_listing_id: 'listing-1', p_image_id: 'image-1', p_expected_user_id: 'user-1' })
  })
  it('surfaces metadata deletion failure and retains the row for a retry', async () => {
    state.deleteError = true
    await expect(deleteListingImage('listing-1', 'image-1', undefined, 'user-1')).rejects.toThrow('refresh and retry')
    expect(state.images).toEqual([saved])
  })
  it('checks and returns the persisted main image rather than claiming an unverified success', async () => {
    state.images.push({ ...saved, id: 'image-2', main: false })
    const result = await setMainListingImage('listing-1', 'image-2', 'user-1')
    expect(result.filter(image => image.main).map(image => image.id)).toEqual(['image-2'])
    state.mainError = true
    await expect(setMainListingImage('listing-1', 'image-1', 'user-1')).rejects.toThrow('Main image unavailable')
  })
  it('rejects previous-account image operations and stops after an account switch during upload', async () => {
    await expect(listListingImages('listing-1', 'user-2')).rejects.toThrow('session changed')
    expect(state.rpc).not.toHaveBeenCalled()
    state.upload.mockImplementationOnce(async () => { state.userId = 'user-2'; return { error: null } })
    await expect(uploadListingImages('listing-1', [photo()], 'user-1')).rejects.toThrow('session changed')
    expect(state.metadataAttempted).toBe(false)
    expect(state.remove).not.toHaveBeenCalled()
  })
  it('lets owners view held images while blocking main/delete mutations', async () => {
    state.held = true
    await expect(listListingImages('listing-1', 'user-1')).resolves.toEqual([saved])
    await expect(setMainListingImage('listing-1', 'image-1', 'user-1')).rejects.toThrow('moderation')
    await expect(deleteListingImage('listing-1', 'image-1', undefined, 'user-1')).rejects.toThrow('moderation')
    expect(state.remove).not.toHaveBeenCalled()
  })
})
