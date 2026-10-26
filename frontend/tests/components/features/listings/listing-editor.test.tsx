import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OwnedListing } from '@/lib/services/listing-service'

const state = vi.hoisted(() => ({
  userId: 'account-one', locale: 'en', id: 'listing-one', get: vi.fn(), update: vi.fn(), push: vi.fn(), fetch: vi.fn(),
  upload: vi.fn(), main: vi.fn(), remove: vi.fn(), revoke: vi.fn(), objectUrl: vi.fn(), mapRemove: vi.fn(),
  mapClick: undefined as undefined | ((event: { lngLat: { lng: number; lat: number } }) => void),
}))
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: { id: state.userId }, isInitialized: true }) }))
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: state.locale }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }), useParams: () => ({ id: state.id }) }))
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }))
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))
vi.mock('@/lib/services/listing-service', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/services/listing-service')>(), getMyListing: state.get, updateListing: state.update }))
vi.mock('@/lib/services/storage-service', () => ({ uploadListingImages: state.upload, setMainListingImage: state.main, deleteListingImage: state.remove, LISTING_IMAGE_MAX_BYTES: 5 * 1024 * 1024, LISTING_IMAGE_BATCH_LIMIT: 20, LISTING_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] }))
vi.mock('mapbox-gl', () => ({ default: {
  Map: class {
    addControl() {}
    on(event: string, callback: typeof state.mapClick) { if (event === 'click') state.mapClick = callback }
    flyTo() {}
    remove() { state.mapRemove() }
  },
  Marker: class {
    setLngLat() { return this }
    addTo() { return this }
    on() { return this }
    setDraggable() { return this }
    remove() {}
  },
  NavigationControl: class {},
} }))

import { ListingEditor } from '@/components/features/listings/listing-editor'
import ListingImagesPage from '@/app/dashboard/listings/[id]/images/page'

const fixture = (): OwnedListing => ({
  id: 'listing-one', seller_id: 'owner-profile', title: 'Wooden desk', description: 'A large desk in good condition.', price: 25,
  main_category: 'Items', sub_category: 'Sell', status: 'active', owner_status: 'active', moderation_suspended: false, created_at: '2026-10-19T12:00:00Z',
  address: { label: 'Athens', city: 'Athens' }, coordinates: [23.72, 37.98], contact_number: null, tags: ['furniture'],
  images: [{ id: 'photo-one', url: 'https://example.com/photo.png', storage_path: 'account-one/listing-one/photo.png', main: true }],
  can_edit: true, can_edit_images: true, category_locked: false, price_locked: false,
})
const clients: QueryClient[] = []
function mount(images = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
  clients.push(client)
  const tree = () => <QueryClientProvider client={client}>{images ? <ListingImagesPage /> : <ListingEditor id={state.id} />}</QueryClientProvider>
  const view = render(tree())
  return { ...view, client, update: () => view.rerender(tree()) }
}
beforeEach(() => {
  vi.resetAllMocks()
  state.userId = 'account-one'; state.locale = 'en'; state.id = 'listing-one'; state.mapClick = undefined
  state.get.mockResolvedValue(fixture())
  state.update.mockImplementation(async (_id: string, input: Record<string, unknown>) => ({ ...fixture(), ...input }))
  state.upload.mockResolvedValue([]); state.main.mockResolvedValue([]); state.remove.mockResolvedValue(undefined)
  state.fetch.mockResolvedValue({ ok: true, json: async () => ({ features: [{ center: [13.4, 52.5], place_name: 'Berlin' }] }) })
  let url = 0
  state.objectUrl.mockImplementation(() => `blob:preview-${++url}`)
  vi.stubGlobal('fetch', state.fetch)
  vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'test-map-token')
  vi.spyOn(URL, 'createObjectURL').mockImplementation(state.objectUrl)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(state.revoke)
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('editing an owned listing', () => {
  it('prefills all saved details and saves the existing location/tags for the exact account', async () => {
    const view = mount()
    expect(await screen.findByLabelText('Title')).toHaveValue('Wooden desk')
    expect(screen.getByLabelText('Description')).toHaveValue('A large desk in good condition.')
    expect(screen.getByLabelText('Category')).toHaveValue('Items')
    expect(screen.getByLabelText('Listing type')).toHaveValue('Sell')
    expect(screen.getByLabelText('Location')).toHaveValue('Athens')
    expect(screen.getByLabelText('Contact number (optional)')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Updated wooden desk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(state.update).toHaveBeenCalledWith('listing-one', expect.objectContaining({ title: 'Updated wooden desk', price: 25, tags: ['furniture'], coordinates: [23.72, 37.98], address: { label: 'Athens', city: 'Athens' }, contact_number: '' }), 'account-one'))
    await waitFor(() => expect(state.push).toHaveBeenCalledWith('/dashboard/listings/listing-one'))
    expect(state.fetch).not.toHaveBeenCalled()
    expect(view.client.getQueryData(['my-listing', 'account-one', 'listing-one'])).toBeDefined()
    expect(state.update.mock.calls[0][1]).not.toHaveProperty('status')
    expect(state.update.mock.calls[0][1]).not.toHaveProperty('moderation_suspended')
  })

  it('preserves entered values and stays on the page when saving fails', async () => {
    state.update.mockRejectedValue(new Error('Database unavailable'))
    mount()
    fireEvent.change(await screen.findByLabelText('Description'), { target: { value: 'My unsaved updated description.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your changes are still here')
    expect(screen.getByLabelText('Description')).toHaveValue('My unsaved updated description.')
    expect(state.push).not.toHaveBeenCalled()
  })

  it('preserves a legacy missing address and location when only the title changes', async () => {
    state.get.mockResolvedValue({ ...fixture(), address: null, coordinates: null })
    mount()
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Legacy desk updated' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(state.update).toHaveBeenCalledWith('listing-one', expect.objectContaining({ coordinates: null, address: null }), 'account-one'))
    expect(state.fetch).not.toHaveBeenCalled()
  })

  it('makes Free cost zero and never sends stale price when the type changes', async () => {
    mount()
    await screen.findByLabelText('Listing type')
    fireEvent.change(screen.getByLabelText('Listing type'), { target: { value: 'Free' } })
    expect(screen.getByLabelText('Price (€)')).toHaveValue('0')
    expect(screen.getByLabelText('Price (€)')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(state.update).toHaveBeenCalledWith('listing-one', expect.objectContaining({ sub_category: 'Free', price: 0 }), 'account-one'))
  })

  it('preserves request direction and keeps history-locked category/price disabled under moderation', async () => {
    state.get.mockResolvedValue({ ...fixture(), sub_category: 'Buy', category_locked: true, price_locked: true, moderation_suspended: true, status: 'suspended', can_edit_images: false })
    mount()
    expect(await screen.findByLabelText('Listing type')).toHaveValue('Buy')
    expect(screen.getByLabelText('Category')).toBeDisabled()
    expect(screen.getByLabelText('Listing type')).toBeDisabled()
    expect(screen.getByLabelText('Price (€)')).toBeDisabled()
    expect(screen.getByText(/Editing its details does not remove the review/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Still seeking a desk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(state.update).toHaveBeenCalledWith('listing-one', expect.objectContaining({ sub_category: 'Buy', price: 25 }), 'account-one'))
    expect(state.update.mock.calls[0][1]).not.toHaveProperty('owner_status')
  })

  it.each([['Title', 'x', 'title'], ['Description', 'short', 'description'], ['Price (€)', '-1', 'price']])('rejects an invalid %s before writing', async (label, value, error) => {
    mount()
    fireEvent.change(await screen.findByLabelText(label), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(new RegExp(error, 'i'))
    expect(state.update).not.toHaveBeenCalled()
  })

  it('explains why historical paid listings cannot become free even when the price itself is editable', async () => {
    state.get.mockResolvedValue({ ...fixture(), category_locked: true, price_locked: false })
    mount()
    fireEvent.change(await screen.findByLabelText('Price (€)'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Keep its existing free or paid status')
    expect(state.update).not.toHaveBeenCalled()
  })

  it('verifies a changed place and replaces the old coordinates instead of retaining them', async () => {
    mount()
    fireEvent.change(await screen.findByLabelText('Location'), { target: { value: 'Berlin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(state.update).toHaveBeenCalledWith('listing-one', expect.objectContaining({ coordinates: [13.4, 52.5], address: expect.objectContaining({ label: 'Berlin' }) }), 'account-one'))
    expect(state.fetch.mock.calls[0][0]).toContain('/Berlin.json')
  })

  it('keeps location edits when geocoding fails and never saves mismatched coordinates', async () => {
    state.fetch.mockResolvedValue({ ok: false })
    mount()
    fireEvent.change(await screen.findByLabelText('Location'), { target: { value: 'Unknown new place' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('location could not be verified')
    expect(screen.getByLabelText('Location')).toHaveValue('Unknown new place')
    expect(state.update).not.toHaveBeenCalled()
  })

  it('replaces a legacy text address without spreading its characters into the saved address', async () => {
    state.get.mockResolvedValue({ ...fixture(), address: 'Athens' })
    mount()
    fireEvent.change(await screen.findByLabelText('Location'), { target: { value: 'Berlin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(state.update).toHaveBeenCalledWith('listing-one', expect.objectContaining({ address: { label: 'Berlin' } }), 'account-one'))
  })

  it('supports map selection and cleans up the map when it closes', async () => {
    mount()
    await screen.findByLabelText('Title')
    fireEvent.click(screen.getByRole('button', { name: 'Choose on map' }))
    expect(state.mapClick).toBeDefined()
    await act(async () => { state.mapClick!({ lngLat: { lng: 13.4, lat: 52.5 } }) })
    await waitFor(() => expect(screen.getByLabelText('Location')).toHaveValue('Berlin'))
    fireEvent.click(screen.getByRole('button', { name: 'Hide map' }))
    expect(state.mapRemove).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(state.update).toHaveBeenCalledWith('listing-one', expect.objectContaining({ coordinates: [13.4, 52.5] }), 'account-one'))
  })

  it('does not save a previous account after its location request finishes late', async () => {
    let finish!: (value: unknown) => void
    state.fetch.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const view = mount()
    fireEvent.change(await screen.findByLabelText('Location'), { target: { value: 'Berlin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(state.fetch).toHaveBeenCalled())
    state.userId = 'account-two'
    state.get.mockResolvedValue({ ...fixture(), title: 'Second account listing' })
    view.update()
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Second account listing'))
    await act(async () => finish({ ok: true, json: async () => ({ features: [{ center: [13.4, 52.5] }] }) }))
    expect(state.update).not.toHaveBeenCalled()
    expect(state.push).not.toHaveBeenCalled()
  })

  it('shows load errors and Greek labels without presenting an empty editable listing', async () => {
    state.locale = 'el'
    state.get.mockRejectedValueOnce(new Error('Not your listing')).mockResolvedValue(fixture())
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('Η αγγελία σου δεν φορτώθηκε')
    expect(screen.queryByLabelText('Τίτλος')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Δοκίμασε ξανά' }))
    expect(await screen.findByLabelText('Τίτλος')).toHaveValue('Wooden desk')
    expect(screen.getByRole('button', { name: 'Αποθήκευση αλλαγών' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ακύρωση' })).toHaveAttribute('href', '/dashboard/listings/listing-one')
  })
})

describe('managing listing photos', () => {
  it('uploads selected files in order for the exact owner and clears them only after success', async () => {
    mount(true)
    const input = await screen.findByLabelText('Choose photos')
    const first = new File(['one'], 'one.png', { type: 'image/png' }), second = new File(['two'], 'two.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [first, second] } })
    expect(screen.getByAltText('Selected photo 1')).toHaveAttribute('src', 'blob:preview-1')
    expect(screen.getByAltText('Selected photo 2')).toHaveAttribute('src', 'blob:preview-2')
    fireEvent.click(screen.getByRole('button', { name: 'Upload photos' }))
    await waitFor(() => expect(state.upload).toHaveBeenCalledWith('listing-one', [first, second], 'account-one'))
    expect(await screen.findByText('Photos updated.')).toBeInTheDocument()
    expect(screen.queryByAltText('Selected photo 1')).not.toBeInTheDocument()
    expect(state.revoke).toHaveBeenCalledWith('blob:preview-1')
  })

  it('retains selected files on upload failure so the same choice can be retried', async () => {
    state.upload.mockRejectedValueOnce(new Error('Storage unavailable'))
    mount(true)
    fireEvent.change(await screen.findByLabelText('Choose photos'), { target: { files: [new File(['one'], 'one.png', { type: 'image/png' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload photos' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The photo change could not be saved')
    expect(screen.getByAltText('Selected photo 1')).toBeInTheDocument()
    expect(screen.queryByText('Photos updated.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Upload photos' }))
    expect(await screen.findByText('Photos updated.')).toBeInTheDocument()
    expect(state.upload).toHaveBeenCalledTimes(2)
  })

  it.each(['image/svg+xml', 'image/heic', 'too-large'])('rejects unsupported or oversized files: %s', async kind => {
    mount(true)
    const file = new File(['image'], 'photo', { type: kind === 'too-large' ? 'image/png' : kind })
    if (kind === 'too-large') Object.defineProperty(file, 'size', { value: 5 * 1024 * 1024 + 1 })
    fireEvent.change(await screen.findByLabelText('Choose photos'), { target: { files: [file] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('up to 5 MB')
    expect(screen.getByRole('button', { name: 'Upload photos' })).toBeDisabled()
    expect(state.upload).not.toHaveBeenCalled()
  })

  it('rejects more than twenty files in one batch before creating previews or uploading', async () => {
    mount(true)
    const files = Array.from({ length: 21 }, (_, index) => new File(['image'], `${index}.png`, { type: 'image/png' }))
    fireEvent.change(await screen.findByLabelText('Choose photos'), { target: { files } })
    expect(await screen.findByRole('alert')).toHaveTextContent('up to 20 photos at a time')
    expect(state.objectUrl).not.toHaveBeenCalled()
    expect(state.upload).not.toHaveBeenCalled()
  })

  it('retains selected files even when refreshing the gallery after an upload failure also fails', async () => {
    state.upload.mockRejectedValueOnce(new Error('Response lost'))
    state.get.mockResolvedValueOnce(fixture()).mockRejectedValue(new Error('Offline'))
    mount(true)
    fireEvent.change(await screen.findByLabelText('Choose photos'), { target: { files: [new File(['one'], 'one.png', { type: 'image/png' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload photos' }))
    await waitFor(() => expect(state.get).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upload photos' })).toBeEnabled())
    expect(screen.getByAltText('Selected photo 1')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Check the latest photos')
  })

  it('sets an existing image as main and keeps errors visible if that action fails', async () => {
    state.get.mockResolvedValue({ ...fixture(), images: [{ ...fixture().images[0], main: false }] })
    state.main.mockRejectedValueOnce(new Error('RPC failed'))
    mount(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Set as main' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved')
    expect(state.main).toHaveBeenCalledWith('listing-one', 'photo-one', 'account-one')
    expect(screen.queryByText('Photos updated.')).not.toBeInTheDocument()
  })

  it('requires deletion confirmation and keeps the dialog on a failed delete', async () => {
    state.remove.mockRejectedValueOnce(new Error('Delete failed'))
    mount(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete photo' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete this photo?' })
    expect(state.remove).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete photo' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('could not be saved')
    expect(state.remove).toHaveBeenCalledWith('listing-one', 'photo-one', undefined, 'account-one')
    expect(screen.getByAltText('Listing photo 1')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete photo' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps held listing photos readable while hiding every image mutation', async () => {
    state.locale = 'el'
    state.get.mockResolvedValue({ ...fixture(), moderation_suspended: true, can_edit_images: false })
    mount(true)
    expect(await screen.findByAltText('Φωτογραφία αγγελίας 1')).toBeInTheDocument()
    expect(screen.getByText(/Οι αλλαγές φωτογραφιών δεν είναι διαθέσιμες/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Επιλογή φωτογραφιών')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Διαγραφή φωτογραφίας' })).not.toBeInTheDocument()
    expect(state.upload).not.toHaveBeenCalled()
  })

  it('does not carry pending uploads or their error feedback into another account', async () => {
    let fail!: (error: Error) => void
    state.upload.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject }))
    const view = mount(true)
    fireEvent.change(await screen.findByLabelText('Choose photos'), { target: { files: [new File(['one'], 'one.png', { type: 'image/png' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload photos' }))
    await waitFor(() => expect(state.upload).toHaveBeenCalled())
    state.userId = 'account-two'
    state.get.mockResolvedValue({ ...fixture(), title: 'Second account listing', images: [] })
    view.update()
    await screen.findByText('Second account listing')
    await act(async () => fail(new Error('Old account error')))
    expect(screen.queryByAltText('Selected photo 1')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(state.revoke).toHaveBeenCalledWith('blob:preview-1')
  })
})
