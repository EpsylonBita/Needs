import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({
  user: null as null | { id: string }, initialized: true,
  get: vi.fn(), update: vi.fn(), toast: vi.fn(),
  save: undefined as undefined | ((data: { fullName: string }) => Promise<void>),
}))
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: boundary.user, isInitialized: boundary.initialized }) }))
vi.mock('@/lib/services/profile-service', () => ({ profileService: { getProfile: boundary.get, updateProfile: boundary.update } }))
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: boundary.toast }) }))
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getUser: async () => ({ data: { user: boundary.user }, error: null }) } } }))

import { ProfileProvider, useProfile } from '@/contexts/profile-context'

function Probe() {
  const state = useProfile()
  useEffect(() => { boundary.save = state.updateProfile }, [state.updateProfile])
  return <output>{state.profile?.fullName || 'none'}:{state.isLoading ? 'loading' : 'ready'}:{state.isAuthenticated ? 'signed-in' : 'guest'}:{state.error?.message}</output>
}
const tree = () => <ProfileProvider><Probe /></ProfileProvider>
beforeEach(() => {
  boundary.user = null
  boundary.initialized = true
  boundary.get.mockReset()
  boundary.update.mockReset()
  boundary.toast.mockReset()
  boundary.save = undefined
})
afterEach(cleanup)

describe('profile authentication lifecycle', () => {
  it('loads or creates the profile after login in an already-mounted app', async () => {
    const view = render(tree())
    await screen.findByText('none:ready:guest:')
    boundary.get.mockResolvedValue({ userId: 'one', fullName: 'First user' })
    boundary.user = { id: 'one' }
    view.rerender(tree())
    await screen.findByText('First user:ready:signed-in:')
    expect(boundary.get).toHaveBeenCalledTimes(1)
  })

  it('discards a profile load that finishes after logout', async () => {
    let finish!: (value: unknown) => void
    boundary.user = { id: 'one' }
    boundary.get.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const view = render(tree())
    await waitFor(() => expect(boundary.get).toHaveBeenCalled())
    boundary.user = null
    view.rerender(tree())
    await act(async () => finish({ userId: 'one', fullName: 'Stale user' }))
    expect(screen.getByText('none:ready:guest:')).toBeInTheDocument()
  })

  it('keeps the current account when an older account lookup finishes last', async () => {
    let finish!: (value: unknown) => void
    boundary.user = { id: 'one' }
    boundary.get.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
      .mockResolvedValueOnce({ userId: 'two', fullName: 'Second user' })
    const view = render(tree())
    await waitFor(() => expect(boundary.get).toHaveBeenCalledTimes(1))
    boundary.user = { id: 'two' }
    view.rerender(tree())
    await screen.findByText('Second user:ready:signed-in:')
    await act(async () => finish({ userId: 'one', fullName: 'Stale user' }))
    expect(screen.getByText('Second user:ready:signed-in:')).toBeInTheDocument()
  })

  it('clears a previous account error when a new account signs in', async () => {
    boundary.user = { id: 'one' }
    boundary.get.mockRejectedValueOnce(new Error('Profile unavailable'))
      .mockResolvedValueOnce({ userId: 'two', fullName: 'Second user' })
    const view = render(tree())
    await screen.findByText('none:ready:signed-in:Profile unavailable')
    boundary.user = { id: 'two' }
    view.rerender(tree())
    await screen.findByText('Second user:ready:signed-in:')
  })

  it('rejects an old upload callback before it can write to the newly signed-in account', async () => {
    boundary.user = { id: 'one' }
    boundary.get.mockResolvedValueOnce({ userId: 'one', fullName: 'First user' })
      .mockResolvedValueOnce({ userId: 'two', fullName: 'Second user' })
    boundary.update.mockResolvedValue({ userId: 'two', fullName: 'Wrong change' })
    const view = render(tree())
    await screen.findByText('First user:ready:signed-in:')
    const capturedSave = boundary.save!
    boundary.user = { id: 'two' }
    view.rerender(tree())
    await screen.findByText('Second user:ready:signed-in:')
    await act(async () => { await expect(capturedSave({ fullName: 'First user change' })).rejects.toThrow('session changed') })
    expect(boundary.update).not.toHaveBeenCalled()
    expect(screen.getByText('Second user:ready:signed-in:')).toBeInTheDocument()
  })

  it('binds the service call to the initiating account and rejects completion after switching', async () => {
    let finish!: (value: unknown) => void
    boundary.user = { id: 'one' }
    boundary.get.mockResolvedValueOnce({ userId: 'one', fullName: 'First user' })
      .mockResolvedValueOnce({ userId: 'two', fullName: 'Second user' })
    boundary.update.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const view = render(tree())
    await screen.findByText('First user:ready:signed-in:')
    let save!: Promise<void>
    act(() => { save = boundary.save!({ fullName: 'First changed' }) })
    const rejected = expect(save).rejects.toThrow('session changed')
    boundary.user = { id: 'two' }
    view.rerender(tree())
    await screen.findByText('Second user:ready:signed-in:')
    await act(async () => finish({ userId: 'one', fullName: 'First changed' }))
    await rejected
    expect(boundary.update).toHaveBeenCalledWith({ fullName: 'First changed' }, 'one')
    expect(boundary.toast).not.toHaveBeenCalled()
    expect(screen.getByText('Second user:ready:signed-in:')).toBeInTheDocument()
  })
})
