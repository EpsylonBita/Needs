import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/features/payments/checkout', () => ({
  Checkout: (props: { listingId: string; chatId?: string; milestoneId?: string }) => <div data-testid="checkout-props">{JSON.stringify(props)}</div>,
}))

import CheckoutPage from '@/app/payments/checkout/[listingId]/page'

afterEach(cleanup)

describe('checkout route context', () => {
  it('preserves the conversation selected by the payer', async () => {
    render(await CheckoutPage({ params: Promise.resolve({ listingId: 'listing-1' }), searchParams: Promise.resolve({ chatId: 'chat-1' }) }))
    expect(JSON.parse(screen.getByTestId('checkout-props').textContent!)).toEqual({ listingId: 'listing-1', chatId: 'chat-1' })
  })

  it('keeps saved milestones usable without a conversation query and ignores ambiguous arrays', async () => {
    render(await CheckoutPage({ params: Promise.resolve({ listingId: 'listing-1' }), searchParams: Promise.resolve({ milestoneId: 'milestone-1', chatId: ['chat-1', 'chat-2'] }) }))
    expect(JSON.parse(screen.getByTestId('checkout-props').textContent!)).toEqual({ listingId: 'listing-1', milestoneId: 'milestone-1' })
  })
})
