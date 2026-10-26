import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ session: vi.fn(), begin: vi.fn(), fetch: vi.fn(), locale: 'en' }))
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: mocks.locale }) }))
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getSession: mocks.session } } }))
vi.mock('@/lib/stripe/connect-client', () => ({ beginStripeOnboarding: mocks.begin }))
import RefreshPage from '@/app/payments/onboarding/refresh/page'
import ReturnPage from '@/app/payments/onboarding/return/page'
import OnboardingPage from '@/app/payments/onboarding/page'

describe('Stripe onboarding callbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.locale = 'en'
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.session.mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null })
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })
  it('localizes onboarding entry and its authentication error', async () => {
    mocks.locale = 'el'
    mocks.session.mockResolvedValue({ data: { session: null }, error: null })
    render(<OnboardingPage />)
    expect(screen.getByRole('heading', { name: 'Σύνδεση με το Stripe' })).toBeInTheDocument()
    expect(mocks.session).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Έναρξη σύνδεσης' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Συνδέσου για να συνεχίσεις')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it.each([true, false])('localizes verified onboarding state ready=%s and does not repeat status calls on language changes', async ready => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ ready }), { status: 200 }))
    const view = render(<ReturnPage />)
    await screen.findByText(ready ? 'Your account is ready to receive payouts.' : 'Continue onboarding')
    mocks.locale = 'el'
    view.rerender(<ReturnPage />)
    expect(screen.getByRole('status')).toHaveTextContent(ready ? 'έτοιμος να λαμβάνει χρήματα' : 'χρειάζεται ακόμη στοιχεία')
    expect(screen.getByRole('heading', { name: ready ? 'Η σύνδεση ολοκληρώθηκε' : 'Σύνδεση με το Stripe' })).toBeInTheDocument()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('localizes expired-link failure and retry without restarting onboarding on language changes', async () => {
    mocks.begin.mockRejectedValue(new Error('Please sign in to continue onboarding.'))
    const view = render(<RefreshPage />)
    await screen.findByRole('alert')
    mocks.locale = 'el'
    view.rerender(<RefreshPage />)
    expect(screen.getByRole('alert')).toHaveTextContent('Συνδέσου για να συνεχίσεις τη σύνδεση')
    expect(screen.getByRole('link', { name: 'Δοκίμασε ξανά' })).toHaveAttribute('href', '/payments/onboarding')
    expect(mocks.begin).toHaveBeenCalledTimes(1)
  })
  it('shows success only after the authenticated server confirms account readiness', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ ready: true }), { status: 200 }))
    render(<ReturnPage />)
    expect(screen.queryByText('Onboarding Complete')).toBeNull()
    expect(await screen.findByText('Onboarding Complete')).toBeTruthy()
  })
  it('keeps incomplete onboarding actionable', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ ready: false }), { status: 200 }))
    render(<ReturnPage />)
    expect(await screen.findByText('Continue onboarding')).toBeTruthy()
    expect(screen.queryByText('Onboarding Complete')).toBeNull()
  })
  it('regenerates expired onboarding links and reports retry errors', async () => {
    mocks.begin.mockRejectedValue(new Error('Please sign in to continue onboarding.'))
    render(<RefreshPage />)
    expect(await screen.findByText('Please sign in to continue onboarding.')).toBeTruthy()
    expect(mocks.begin).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Try again').getAttribute('href')).toBe('/payments/onboarding')
  })
})
