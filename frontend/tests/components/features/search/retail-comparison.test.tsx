import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RetailComparison } from '@/components/features/search/retail-comparison'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('retailer rows beneath the listing', () => {
  it('renders an expanded comparison with more than five real shop rows', async () => {
    const offers = Array.from({ length: 9 }, (_, index) => ({ shop: `Retailer ${index + 1}`, price: 100 + index, url: `https://retailer${index + 1}.gr/product` }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ status: 'ready', offers })))
    render(<RetailComparison listingId="expanded" />)
    expect(await screen.findAllByRole('link')).toHaveLength(9)
    expect(screen.queryByText(/currently unavailable/)).not.toBeInTheDocument()
  })
  it('rejects a response exceeding the supported offer bound', async () => {
    const offers = Array.from({ length: 13 }, (_, index) => ({ shop: `Retailer ${index}`, price: 100, url: `https://retailer${index}.gr/product` }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ status: 'ready', offers })))
    render(<RetailComparison listingId="oversized" />)
    expect(await screen.findByText(/currently unavailable/)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
  it('shows only store and price, linking straight to the product in a new tab', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ status: 'ready', offers: [{ shop: 'Example Audio', price: 249.9, url: 'https://audio.example.com/product/sony' }] })))
    render(<RetailComparison listingId="listing-one" />)
    const link = await screen.findByRole('link', { name: /Example Audio/ })
    expect(link).toHaveAttribute('href', 'https://audio.example.com/product/sony')
    expect(link).toHaveAttribute('target', '_blank'); expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveTextContent('€249.90')
    expect(screen.queryByText(/shipping|delivery|updated|in stock/i)).not.toBeInTheDocument()
  })
  it('uses a neutral empty state and never substitutes demonstration prices', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ status: 'insufficient_data', offers: [] })))
    render(<RetailComparison listingId="listing-one" />)
    expect(await screen.findByText(/No verified new offers/)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
  it('discards a previous listing response when navigation races the lookup', async () => {
    let resolveFirst!: (response: Response) => void
    const first = new Promise<Response>(resolve => { resolveFirst = resolve })
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(Response.json({ status: 'ready', offers: [{ shop: 'Current shop', price: 100, url: 'https://current.example.com/product' }] })))
    const view = render(<RetailComparison listingId="first" />)
    view.rerender(<RetailComparison listingId="second" />)
    await screen.findByText('Current shop')
    await act(async () => { resolveFirst(Response.json({ status: 'ready', offers: [{ shop: 'Stale shop', price: 90, url: 'https://stale.example.com/product' }] })) })
    expect(screen.queryByText('Stale shop')).not.toBeInTheDocument()
  })
  it('handles malformed responses and unsafe URLs without rendering a link', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ status: 'ready', offers: [{ shop: 'Unsafe', price: 10, url: 'javascript:alert(1)' }] })))
    render(<RetailComparison listingId="listing-one" />)
    expect(await screen.findByText(/currently unavailable/)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
