import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PriceGuidance } from '@/components/features/ads/price-guidance';
import type { PriceGuidance as Guidance, PricingSubject } from '@/lib/pricing/types';

const boundary = vi.hoisted(() => ({ session: vi.fn(), fetch: vi.fn(), csrf: vi.fn(), locale: 'en' }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getSession: boundary.session } } }));
vi.mock('@/lib/utils/csrf', () => ({ withCsrfHeaders: boundary.csrf }));
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: boundary.locale }) }));
const subject: PricingSubject = { title: 'iPhone 15 128GB', description: 'Used iPhone 15 128GB in good condition.', mainCategory: 'Items', subCategory: 'Sell', coordinates: [23.72, 37.98] };
const ready: Guidance = { status: 'ready', range: { low: 300, high: 400, median: 350 }, sampleSize: 6, basis: 'needs_asking', unit: 'item', retailRange: null };
function respond(value: Guidance = ready) { return { ok: true, json: async () => value }; }
function lookup() { fireEvent.click(screen.getByRole('button', { name: 'Check price' })); }
function toggleDetails() { fireEvent.click(screen.getByRole('button', { name: 'Details' })); }

beforeEach(() => {
  boundary.locale = 'en';
  boundary.session.mockReset().mockResolvedValue({ data: { session: { access_token: 'test-session' } }, error: null });
  boundary.fetch.mockReset().mockResolvedValue(respond());
  boundary.csrf.mockReset().mockImplementation(async headers => ({ ...headers, 'X-CSRF-Token': 'test-csrf' }));
  vi.stubGlobal('fetch', boundary.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Seller price guidance', () => {
  it('only looks up on request, sends the subject without the entered price, and updates the compact meter locally', async () => {
    const { rerender } = render(<PriceGuidance subject={subject} price="250" />);
    expect(boundary.session).not.toHaveBeenCalled();
    expect(boundary.fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    lookup();
    const meter = await screen.findByRole('meter', { name: 'Price comparison' });
    expect(screen.getByRole('status')).toHaveTextContent('Competitive');
    expect(meter).toHaveAttribute('aria-valuetext', expect.stringContaining('below comparable asking prices'));
    const [url, request] = boundary.fetch.mock.calls[0];
    expect(url).toBe('/api/pricing/guidance');
    expect(request.method).toBe('POST');
    expect(request.headers.Authorization).toBe('Bearer test-session');
    expect(request.headers['X-CSRF-Token']).toBe('test-csrf');
    expect(JSON.parse(request.body)).toEqual(subject);
    rerender(<PriceGuidance subject={{ ...subject, coordinates: [23.72, 37.98] }} price="350,50" />);
    expect(screen.getByRole('status')).toHaveTextContent('In range');
    expect(meter).toHaveAttribute('aria-valuenow', '49.75');
    rerender(<PriceGuidance subject={subject} price="450" />);
    expect(screen.getByRole('status')).toHaveTextContent('High');
    expect(meter).toHaveAttribute('aria-valuetext', expect.stringContaining('above comparable asking prices'));
    expect(boundary.fetch).toHaveBeenCalledOnce();
    expect(boundary.session).toHaveBeenCalledOnce();
  });

  it('keeps evidence behind Details and never removes the meter or refetches when toggled', async () => {
    boundary.fetch.mockResolvedValue(respond({ ...ready, retailRange: { low: 500, high: 600, median: 550 } }));
    render(<PriceGuidance subject={subject} price="350" />);
    lookup();
    await screen.findByRole('meter');
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/6 public NEEDS listings/)).not.toBeInTheDocument();
    expect(screen.queryByText(/New retail reference/)).not.toBeInTheDocument();
    toggleDetails();
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/6 public NEEDS listings/)).toHaveTextContent('asking prices, not completed sales');
    expect(screen.getByText(/not necessarily better for you/)).toBeInTheDocument();
    expect(screen.getByText(/New retail reference/)).toHaveTextContent('€500');
    toggleDetails();
    expect(screen.queryByText(/6 public NEEDS listings/)).not.toBeInTheDocument();
    expect(screen.getByRole('meter')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('In range');
    expect(boundary.fetch).toHaveBeenCalledOnce();
  });

  it('maps a higher price left, the median centrally, and a lower price right with bounded marker positions', async () => {
    const { rerender } = render(<PriceGuidance subject={subject} price="350" />);
    lookup();
    const meter = await screen.findByRole('meter');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    for (const [price, position] of [['400', '25'], ['350', '50'], ['300', '75'], ['99999', '4'], ['1', '96']]) {
      rerender(<PriceGuidance subject={subject} price={price} />);
      expect(meter).toHaveAttribute('aria-valuenow', position);
    }
    expect(boundary.fetch).toHaveBeenCalledOnce();
  });

  it('handles a single-price reference without dividing by zero or jumping to the ends', async () => {
    boundary.fetch.mockResolvedValue(respond({ ...ready, range: { low: 350, high: 350, median: 350 } }));
    const { rerender } = render(<PriceGuidance subject={subject} price="350" />);
    lookup();
    const meter = await screen.findByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '50');
    rerender(<PriceGuidance subject={subject} price="351" />);
    expect(Number(meter.getAttribute('aria-valuenow'))).toBeLessThan(50);
    expect(Number(meter.getAttribute('aria-valuenow'))).toBeGreaterThan(25);
    rerender(<PriceGuidance subject={subject} price="349" />);
    expect(Number(meter.getAttribute('aria-valuenow'))).toBeGreaterThan(50);
    expect(Number(meter.getAttribute('aria-valuenow'))).toBeLessThan(75);
  });

  it.each(['', '0', '0.00', 'invalid', '-5', '20.333'])('keeps zero, empty or invalid price neutral without a meter value: %s', async price => {
    render(<PriceGuidance subject={subject} price={price} />);
    lookup();
    expect(await screen.findByText('Enter a positive price')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByText('Competitive')).not.toBeInTheDocument();
  });

  it.each(['Buy', 'Free', 'I want'] as const)('does not offer lookup for %s listings', kind => {
    render(<PriceGuidance subject={{ ...subject, subCategory: kind }} price="350" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it.each(['I will', 'I can'] as const)('keeps service units in accessible meter context and expanded evidence for %s', async kind => {
    boundary.fetch.mockResolvedValue(respond({ ...ready, unit: 'hour', range: { low: 20, high: 30, median: 25 } }));
    render(<PriceGuidance subject={{ ...subject, mainCategory: 'Services', subCategory: kind }} price="25" />);
    lookup();
    expect(await screen.findByRole('meter')).toHaveAttribute('aria-valuetext', expect.stringContaining('per hour'));
    expect(screen.getByRole('status')).toHaveTextContent('In range');
    toggleDetails();
    expect(screen.getByText('per hour').closest('p')).toHaveTextContent('€20.00 – €30.00 per hour');
  });

  it('does not rate a used item using its separate new-retail reference', async () => {
    boundary.fetch.mockResolvedValue(respond({ ...ready, status: 'insufficient_data', range: null, basis: null, sampleSize: 0, retailRange: { low: 500, high: 600, median: 550 }, reason: 'not_enough_comparables' }));
    render(<PriceGuidance subject={subject} price="550" />);
    lookup();
    expect(await screen.findByText('Not enough data')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByText(/New retail reference/)).not.toBeInTheDocument();
    toggleDetails();
    expect(screen.getByText(/New retail reference/)).toHaveTextContent('€500');
    expect(screen.getByText(/not an estimate of this used item/)).toBeInTheDocument();
  });

  it('labels confirmed-new retail evidence distinctly in meter context and details', async () => {
    boundary.fetch.mockResolvedValue(respond({ ...ready, basis: 'new_retail', sampleSize: 4 }));
    render(<PriceGuidance subject={{ ...subject, description: 'New sealed iPhone 15 128GB.' }} price="350" />);
    lookup();
    expect(await screen.findByRole('meter')).toHaveAttribute('aria-valuetext', expect.stringContaining('within new retail prices'));
    expect(screen.queryByText(/4 new-item retail offers/)).not.toBeInTheDocument();
    toggleDetails();
    expect(screen.getByText(/4 new-item retail offers/)).toBeInTheDocument();
    expect(screen.queryByText(/public NEEDS listings/)).not.toBeInTheDocument();
  });

  it.each([
    { title: 'iPhone 16 128GB' }, { description: 'A different model and condition.' },
    { mainCategory: 'Services' as const }, { subCategory: 'I can' as const },
    { coordinates: [22.9, 40.6] as [number, number] },
  ])('aborts and discards stale responses after a subject change: %j', async change => {
    let finish!: (response: ReturnType<typeof respond>) => void;
    boundary.fetch.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { rerender } = render(<PriceGuidance subject={subject} price="350" />);
    lookup();
    await waitFor(() => expect(boundary.fetch).toHaveBeenCalledOnce());
    const signal = boundary.fetch.mock.calls[0][1].signal as AbortSignal;
    rerender(<PriceGuidance subject={{ ...subject, ...change }} price="350" />);
    expect(signal.aborted).toBe(true);
    await act(async () => finish(respond()));
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check price' })).toBeEnabled();
    expect(boundary.fetch).toHaveBeenCalledOnce();
  });

  it('invalidates a displayed reference immediately after a subject change', async () => {
    const { rerender } = render(<PriceGuidance subject={subject} price="350" />);
    lookup();
    await screen.findByRole('meter');
    rerender(<PriceGuidance subject={{ ...subject, coordinates: null }} price="350" />);
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(boundary.fetch).toHaveBeenCalledOnce();
  });

  it('ignores a delayed session result when the subject has changed', async () => {
    let finish!: (response: { data: { session: { access_token: string } } }) => void;
    boundary.session.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { rerender } = render(<PriceGuidance subject={subject} price="350" />);
    lookup();
    rerender(<PriceGuidance subject={{ ...subject, title: 'Changed title' }} price="350" />);
    await act(async () => finish({ data: { session: { access_token: 'test-session' } } }));
    expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it.each(['network', 'http', 'malformed', 'signed-out', 'csrf'])('leaves publishing independent on %s failure and keeps retry behind Details', async failure => {
    if (failure === 'network') boundary.fetch.mockRejectedValue(new Error('offline'));
    if (failure === 'http') boundary.fetch.mockResolvedValue({ ok: false });
    if (failure === 'malformed') boundary.fetch.mockResolvedValue({ ok: true, json: async () => ({ ...ready, range: { low: 400, high: 300, median: 350 } }) });
    if (failure === 'csrf') boundary.csrf.mockResolvedValue({});
    if (failure === 'signed-out') boundary.session.mockResolvedValue({ data: { session: null } });
    render(<form><PriceGuidance subject={subject} price="350" /><button type="submit">Publish listing</button></form>);
    lookup();
    expect(await screen.findByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByText('Price guidance is unavailable right now. You can still set your own price.')).not.toBeInTheDocument();
    toggleDetails();
    expect(screen.getByText('Price guidance is unavailable right now. You can still set your own price.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: 'Publish listing' })).toBeEnabled();
    if (failure === 'signed-out' || failure === 'csrf') expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it('localizes the compact action, status and details disclosure in Greek', async () => {
    boundary.locale = 'el';
    render(<PriceGuidance subject={subject} price="350" />);
    fireEvent.click(screen.getByRole('button', { name: 'Έλεγχος τιμής' }));
    expect(await screen.findByRole('meter', { name: 'Σύγκριση τιμής' })).toHaveAttribute('aria-valuetext', expect.stringContaining('ζητούμενων τιμών'));
    expect(screen.getByRole('status')).toHaveTextContent('Στο εύρος');
    expect(screen.queryByText(/6 δημόσιες αγγελίες NEEDS/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Λεπτομέρειες' }));
    expect(screen.getByText(/6 δημόσιες αγγελίες NEEDS/)).toHaveTextContent('όχι ολοκληρωμένες πωλήσεις');
  });
});
