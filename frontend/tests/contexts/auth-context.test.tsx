import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '@/contexts/auth-context'
import { readPendingPublication, savePendingPublication } from '@/lib/listings/publication-intent'
import { readAuthContinuation } from '@/lib/auth/return-path'

const mocks = vi.hoisted(() => ({
  listener: undefined as undefined | ((event: string, session: any) => unknown),
  getSession: vi.fn(), getUser: vi.fn(), signInWithPassword: vi.fn(), signUp: vi.fn(), signOut: vi.fn(),
  profile: vi.fn(), unsubscribe: vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({ supabase: {
  auth: {
    getSession: mocks.getSession, getUser: mocks.getUser,
    signInWithPassword: mocks.signInWithPassword, signUp: mocks.signUp, signOut: mocks.signOut,
    onAuthStateChange: (listener: typeof mocks.listener) => {
      mocks.listener = listener
      return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }
    },
  },
  from: () => ({ select: () => ({ eq: () => ({ limit: mocks.profile }) }) }),
} }))
vi.mock('@/components/common/error-boundary', () => ({ ErrorBoundary: ({ children }: any) => children }))

const account = { id: 'user-one', email: 'member@example.test', user_metadata: { fullName: 'Member' } }
function Probe() {
  const auth = useAuth()
  return <>
    <output>{auth.user?.fullName || 'guest'}:{auth.isLoading ? 'loading' : 'ready'}</output>
    <button onClick={() => void auth.login({ email: 'member@example.test', password: 'password' }).catch(() => {})}>Login</button>
    <button onClick={() => void auth.logout().catch(() => {})}>Logout</button>
    <button onClick={() => void auth.register({ email: 'member@example.test', password: 'password' }).then(result => {
      document.title = result.requiresEmailConfirmation ? 'confirm-email' : 'signed-in'
    })}>Register</button>
  </>
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
  mocks.profile.mockResolvedValue({ data: [{ display_name: 'Profile name' }], error: null })
  mocks.signOut.mockResolvedValue({ error: null })
})
describe('authentication lifecycle', () => {
  it('binds guest content on verified login and clears it on sign-out or account switching', async () => {
    savePendingPublication({ returnTo: '/search?q=guitar', query: 'guitar', intent: 'request' })
    render(<AuthProvider><Probe /></AuthProvider>)
    await screen.findByText('guest:ready')
    act(() => { mocks.listener!('SIGNED_IN', { user: account }) })
    expect(readPendingPublication(account.id)).toMatchObject({ query: 'guitar', intent: 'request', accountId: account.id })
    expect(readPendingPublication('different-user')).toBeNull()
    act(() => { mocks.listener!('SIGNED_IN', { user: { ...account, id: 'different-user' } }) })
    expect(readPendingPublication('different-user')).toBeNull()
    expect(readAuthContinuation('different-user')).toBeNull()
    savePendingPublication({ returnTo: '/', query: 'new account draft' }, 'different-user')
    act(() => { mocks.listener!('SIGNED_OUT', null) })
    expect(readPendingPublication('different-user')).toBeNull()
  })
  it('returns from the auth callback before doing profile I/O and never reacquires the auth lock', async () => {
    render(<AuthProvider><Probe /></AuthProvider>)
    await screen.findByText('guest:ready')
    act(() => {
      expect(mocks.listener!('SIGNED_IN', { user: account })).toBeUndefined()
      expect(mocks.profile).not.toHaveBeenCalled()
    })
    expect(screen.getByText('Member:ready')).toBeInTheDocument()
    await screen.findByText('Profile name:ready')
    expect(mocks.getUser).not.toHaveBeenCalled()
  })

  it('does not restore a signed-out user when an older profile lookup finishes', async () => {
    let resolveProfile!: (value: any) => void
    mocks.profile.mockReturnValue(new Promise(resolve => { resolveProfile = resolve }))
    render(<AuthProvider><Probe /></AuthProvider>)
    await screen.findByText('guest:ready')
    act(() => { mocks.listener!('SIGNED_IN', { user: account }) })
    await waitFor(() => expect(mocks.profile).toHaveBeenCalled())
    act(() => { mocks.listener!('SIGNED_OUT', null) })
    await act(async () => resolveProfile({ data: [{ display_name: 'Stale profile' }], error: null }))
    expect(screen.getByText('guest:ready')).toBeInTheDocument()
  })

  it('ends the loading state after a network failure during login', async () => {
    mocks.signInWithPassword.mockRejectedValue(new Error('Network unavailable'))
    render(<AuthProvider><Probe /></AuthProvider>)
    await screen.findByText('guest:ready')
    fireEvent.click(screen.getByText('Login'))
    await screen.findByText('guest:ready')
  })

  it('reports email confirmation without claiming the user is signed in', async () => {
    mocks.signUp.mockResolvedValue({ data: { user: account, session: null }, error: null })
    render(<AuthProvider><Probe /></AuthProvider>)
    await screen.findByText('guest:ready')
    fireEvent.click(screen.getByText('Register'))
    await waitFor(() => expect(document.title).toBe('confirm-email'))
    expect(mocks.signUp).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ emailRedirectTo: `${window.location.origin}/auth/confirm` }) }))
    expect(screen.getByText('guest:ready')).toBeInTheDocument()
    expect(mocks.getUser).not.toHaveBeenCalled()
  })
})
