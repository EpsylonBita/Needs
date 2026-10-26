import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminSettingsPage from '@/app/dashboard/admin/settings/page'

const fetchMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'trusted-session' } }, error: null })) } } }))
vi.mock('@/lib/utils/csrf', () => ({ withCsrfHeaders: vi.fn(async (headers) => ({ ...headers, 'X-CSRF-Token': 'csrf-token' })) }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ flags: [{ key: 'payments_enabled', enabled: false }] }), { status: 200 }))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('admin settings persistence through trusted API', () => {
  it('loads flags with the session token and sends changes with CSRF protection', async () => {
    fetchMock.mockImplementation(async (_url, options) => new Response(JSON.stringify(options.method === 'PATCH' ? { success: true } : { flags: [{ key: 'payments_enabled', enabled: false }] }), { status: 200 }))
    render(<AdminSettingsPage />)
    fireEvent.click(await screen.findByRole('checkbox'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/settings', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ key: 'payments_enabled', enabled: true }),
      headers: expect.objectContaining({ Authorization: 'Bearer trusted-session', 'X-CSRF-Token': 'csrf-token' }),
    })))
    await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeDisabled())
  })

  it('keeps the original flag value when saving fails', async () => {
    fetchMock.mockImplementation(async (_url, options) => new Response(JSON.stringify(options.method === 'PATCH' ? { error: 'Unable to save settings' } : { flags: [{ key: 'payments_enabled', enabled: false }] }), { status: options.method === 'PATCH' ? 503 : 200 }))
    render(<AdminSettingsPage />)
    fireEvent.click(await screen.findByRole('checkbox'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save settings')
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })
})
