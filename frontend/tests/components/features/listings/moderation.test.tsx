import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MyListingsPage from '@/app/dashboard/listings/page'
import AdminListingsPage from '@/app/dashboard/admin/listings/page'

const mock = vi.hoisted(() => ({ getMyListings: vi.fn(), updateListingStatus: vi.fn(), deleteListing: vi.fn(), adminRequest: vi.fn() }))
vi.mock('@/lib/services/listing-service', () => mock)
vi.mock('@/app/dashboard/admin/admin-request', () => ({ adminRequest: mock.adminRequest }))
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: 'en', t: (_key: string, fallback: string) => fallback }) }))
vi.mock('@/components/features/ads/new-listing-button', () => ({ NewListingButton: () => <button>New listing</button> }))
const held = { id: 'held', title: 'Held listing', description: 'Listing description', price: 10, main_category: 'Items', sub_category: 'Sell', status: 'suspended', owner_status: 'active', moderation_suspended: true, images: [], tags: [], can_edit: true, can_edit_images: false }
const paused = { ...held, id: 'paused', title: 'Paused listing', owner_status: 'suspended', moderation_suspended: false, can_edit_images: true }
const renderListings = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MyListingsPage /></QueryClientProvider>)

beforeEach(() => {
  vi.clearAllMocks()
  mock.getMyListings.mockResolvedValue([held, paused])
  mock.updateListingStatus.mockResolvedValue(undefined)
  mock.adminRequest.mockResolvedValue({ listings: [held, paused], page: 1, totalPages: 1 })
})
afterEach(cleanup)

describe('moderation controls', () => {
  it('explains the admin hold and keeps ordinary owner activation available only for paused listings', async () => {
    renderListings()
    const heldRow = (await screen.findByText('Held listing')).closest('article')!
    expect(within(heldRow).getByText('Under review')).toBeInTheDocument()
    expect(within(heldRow).queryByRole('button')).toBeNull()
    expect(within(heldRow).getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/dashboard/listings/held/edit')
    expect(within(heldRow).queryByRole('link', { name: 'Photos' })).toBeNull()
    const pausedRow = screen.getByText('Paused listing').closest('article')!
    fireEvent.click(within(pausedRow).getByRole('button', { name: 'Activate' }))
    await waitFor(() => expect(mock.updateListingStatus).toHaveBeenCalledWith('paused', 'active', 'user-1'))
    expect(mock.deleteListing).not.toHaveBeenCalled()
  })

  it('links to owner preview and editing even for paused listings, and separates moderation from owner pauses', async () => {
    renderListings()
    const row = (await screen.findByText('Paused listing')).closest('article')!
    expect(within(row).getByRole('link', { name: 'View' })).toHaveAttribute('href', '/dashboard/listings/paused')
    expect(within(row).getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/dashboard/listings/paused/edit')
    expect(within(row).getByRole('link', { name: 'Photos' })).toHaveAttribute('href', '/dashboard/listings/paused/images')
    fireEvent.click(screen.getByRole('button', { name: /^Paused/ }))
    expect(screen.queryByText('Held listing')).not.toBeInTheDocument()
    expect(screen.getByText('Paused listing')).toBeInTheDocument()
  })

  it('shows load failure with retry instead of declaring that the user has no listings', async () => {
    mock.getMyListings.mockRejectedValueOnce(new Error('Network unavailable'))
    renderListings()
    expect(await screen.findByRole('alert')).toHaveTextContent('Your listings could not be loaded')
    expect(screen.queryByText('No listings yet')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Paused listing')).toBeInTheDocument()
  })

  it('requires confirmation and retains the listing if history prevents deletion', async () => {
    mock.deleteListing.mockRejectedValueOnce(new Error('Listing has transaction history'))
    renderListings()
    const row = (await screen.findByText('Paused listing')).closest('article')!
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))
    expect(mock.deleteListing).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mock.deleteListing).toHaveBeenCalledWith('paused', 'user-1'))
    expect(await screen.findByRole('alert')).toHaveTextContent('use Pause to preserve its history')
    expect(row).toBeInTheDocument()
  })

  it('lets an administrator release a held listing using the authorized API', async () => {
    render(<AdminListingsPage />)
    const row = (await screen.findByText('Held listing')).closest('tr')!
    await waitFor(() => expect(within(row).getByRole('button', { name: 'Release hold' })).toBeEnabled())
    fireEvent.click(within(row).getByRole('button', { name: 'Release hold' }))
    await waitFor(() => expect(mock.adminRequest).toHaveBeenCalledWith('/api/admin/listings/held/unsuspend', { method: 'POST', body: '{}' }))
    expect(within(screen.getByText('Paused listing').closest('tr')!).getByRole('button', { name: 'Suspend' })).toBeInTheDocument()
  })

  it('reports a failed moderation action instead of silently updating the row', async () => {
    render(<AdminListingsPage />)
    const button = await screen.findByRole('button', { name: 'Release hold' })
    await waitFor(() => expect(button).toBeEnabled())
    mock.adminRequest.mockRejectedValueOnce(new Error('Unable to save the moderation action'))
    fireEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save the moderation action')
    expect(screen.getByRole('button', { name: 'Release hold' })).toBeInTheDocument()
  })
})
