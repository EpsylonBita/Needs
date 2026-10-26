import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OwnerListingPreview } from '@/components/features/listings/owner-listing-preview'

const mock = vi.hoisted(() => ({ getMyListing: vi.fn(), userId: 'owner-a' }))
vi.mock('@/lib/services/listing-service', () => ({ getMyListing: mock.getMyListing }))
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: { id: mock.userId } }) }))
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: 'en' }) }))
const listing = { id: 'listing-a', title: 'Paused item', description: 'A saved private description.', price: 20, main_category: 'Items', sub_category: 'Buy', status: 'suspended', moderation_suspended: false, can_edit: true, can_edit_images: true, images: [], tags: ['books'], address: { label: 'Athens' }, contact_number: null }
beforeEach(() => { vi.clearAllMocks(); mock.userId = 'owner-a'; mock.getMyListing.mockResolvedValue(listing) })
afterEach(cleanup)
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = () => <QueryClientProvider client={client}><OwnerListingPreview id="listing-a" /></QueryClientProvider>
  return { ...render(tree()), tree }
}
it('shows a paused listing to its owner without linking to a missing public page', async () => {
  setup()
  expect(await screen.findByRole('heading', { name: 'Paused item' })).toBeInTheDocument()
  expect(screen.getByText('A saved private description.')).toBeInTheDocument()
  expect(screen.getByText('Athens')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/dashboard/listings/listing-a/edit')
  expect(screen.queryByRole('link', { name: 'Public view' })).toBeNull()
  expect(mock.getMyListing).toHaveBeenCalledWith('listing-a', 'owner-a', expect.any(AbortSignal))
})
it('removes cached private details when the account changes and the new account is refused', async () => {
  const view = setup()
  await screen.findByRole('heading', { name: 'Paused item' })
  mock.userId = 'owner-b'
  mock.getMyListing.mockRejectedValue(new Error('Not owner'))
  view.rerender(view.tree())
  await waitFor(() => expect(screen.queryByText('A saved private description.')).not.toBeInTheDocument())
  expect(await screen.findByRole('alert')).toHaveTextContent('does not belong to your account')
  expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull()
})
