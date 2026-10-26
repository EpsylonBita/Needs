import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LoginPage from '@/app/login/page'

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  params: new URLSearchParams(),
  auth: { user: null as null | { id: string }, isInitialized: true },
  dialog: {} as { onAuthenticated: () => void; onClose: () => void },
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }), useSearchParams: () => mocks.params }))
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => mocks.auth }))
vi.mock('@/components/auth/auth-dialog', () => ({ AuthDialog: (props: typeof mocks.dialog) => { mocks.dialog = props; return null } }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth = { user: null, isInitialized: true }
  mocks.params = new URLSearchParams({ redirectTo: '/chat?listing=listing-one' })
})

describe('login destination', () => {
  it('keeps the requested destination when success uses a callback captured before auth rerenders', () => {
    render(<LoginPage />)
    const callbackBeforeLogin = mocks.dialog.onAuthenticated
    act(() => callbackBeforeLogin())
    expect(mocks.replace).toHaveBeenLastCalledWith('/chat?listing=listing-one')
  })
  it('returns home when the user cancels', () => {
    render(<LoginPage />)
    act(() => mocks.dialog.onClose())
    expect(mocks.replace).toHaveBeenCalledWith('/')
  })
  it.each(['https://example.test', '//example.test', '/\\example.test'])('rejects an external destination %s', (redirectTo) => {
    mocks.params = new URLSearchParams({ redirectTo })
    render(<LoginPage />)
    act(() => mocks.dialog.onAuthenticated())
    expect(mocks.replace).toHaveBeenCalledWith('/dashboard')
  })
})
