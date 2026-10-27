import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mapModernMessages as greek } from '@/locales/map-modern-el';

const state = vi.hoisted(() => ({
  maps: [] as any[], markers: [] as any[], controls: [] as any[], bounds: [] as any[], popups: [] as any[],
  push: vi.fn(), getCurrentPosition: vi.fn(), locale: 'en', theme: 'light', user: null as null | { id: string },
  rpc: vi.fn(), select: vi.fn(), ids: vi.fn(),
}));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: state.theme }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc: state.rpc, from: () => ({ select: state.select }) } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/contexts/i18n-context', () => {
  const t = (key: string, fallback?: string) => state.locale === 'el' ? greek[key as keyof typeof greek] || fallback || key : fallback || key;
  return { useI18n: () => ({ t, locale: state.locale, formatCurrency: (amount: number, currency: string) => new Intl.NumberFormat(state.locale, { style: 'currency', currency }).format(amount), formatNumber: (amount: number) => String(amount) }) };
});
vi.mock('mapbox-gl', () => ({ default: {
  Map: class {
    options: any; handlers = new Map<string, Set<() => void>>(); controls: any[] = [];
    fitBounds = vi.fn(); resize = vi.fn(); remove = vi.fn(); setStyle = vi.fn(); panBy = vi.fn(); loaded = () => false;
    getBounds = () => ({ getSouth: () => 37, getWest: () => 23, getNorth: () => 38, getEast: () => 24 });
    constructor(options: any) { this.options = options; state.maps.push(this); }
    on(name: string, callback: () => void) { if (!this.handlers.has(name)) this.handlers.set(name, new Set()); this.handlers.get(name)!.add(callback); return this; }
    off(name: string, callback: () => void) { this.handlers.get(name)?.delete(callback); return this; }
    addControl(control: any) { this.controls.push(control); if (control.kind === 'locate') {
      const button = document.createElement('button');
      button.setAttribute('aria-label', this.options.locale['GeolocateControl.FindMyLocation']);
      button.addEventListener('click', () => state.getCurrentPosition());
      this.options.container.appendChild(button);
    } return this; }
  },
  Marker: class {
    element: HTMLElement; coordinates: number[] = [];
    constructor(options: { element: HTMLElement }) { this.element = options.element; this.element.setAttribute('role', 'img'); state.markers.push(this); }
    setLngLat(coordinates: number[]) { this.coordinates = coordinates; return this; }
    addTo(map: any) { map.options.container.appendChild(this.element); return this; }
    remove() { this.element.remove(); }
  },
  Popup: class {
    options: any; host?: Node; container = document.createElement('div'); positions: number[][] = []; map: any; handlers = new Set<() => void>();
    close = () => this.remove();
    constructor(options: any) { this.options = options; this.container.className = options.className; state.popups.push(this); }
    setLngLat(coordinates: number[]) { this.positions.push(coordinates); return this; }
    setDOMContent(host: Node) { this.host = host; this.container.appendChild(host); return this; }
    getElement() { return this.container; }
    addTo(map: any) { this.map = map; map.options.container.appendChild(this.container); if (this.options.closeOnClick) map.on('click', this.close); return this; }
    on(_event: string, callback: () => void) { this.handlers.add(callback); return this; }
    off(_event: string, callback: () => void) { this.handlers.delete(callback); return this; }
    remove = vi.fn(() => { this.container.remove(); this.map?.off('click', this.close); this.handlers.forEach(callback => callback()); return this; });
  },
  LngLatBounds: class { coordinates: number[][] = []; constructor() { state.bounds.push(this); } extend(coordinates: number[]) { this.coordinates.push(coordinates); return this; } },
  AttributionControl: class { kind = 'attribution'; },
  NavigationControl: class { kind = 'navigation'; },
  GeolocateControl: class { kind = 'locate'; constructor(public options: any) { state.controls.push(this); } },
} }));

import { Map as ListingMap } from '@/components/features/map/map-component';

const listing = { id: 'listing-1', title: 'Bicycle', description: 'A city bicycle', price: 120, imageUrl: '/bicycle.jpg', category: 'Items', subcategory: 'Sell', sellerId: 'seller-1', location: { coordinates: [23.7, 37.9] as [number, number], address: 'Athens' } };

beforeEach(() => {
  state.maps = []; state.markers = []; state.controls = []; state.bounds = []; state.popups = [];
  state.locale = 'en'; state.theme = 'light'; state.user = null;
  state.push.mockReset(); state.getCurrentPosition.mockReset();
  state.rpc.mockReset(); state.select.mockReset(); state.ids.mockReset();
  state.select.mockReturnValue({ in: state.ids });
  vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'pk.offline-fixture');
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { geolocation: { getCurrentPosition: state.getCurrentPosition } }));
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('map interaction and accessibility', () => {
  it('labels stored zero-rate markers and previews as needing confirmation', async () => {
    render(<ListingMap results={[{ ...listing, title: 'Home care', description: 'Home care 10€/hour', price: 0, category: 'Services', subcategory: 'I can' }]} />);
    await userEvent.click(screen.getByRole('button', { name: 'View listing: Home care · Price needs confirmation' }));
    expect(screen.getByRole('dialog', { name: 'Home care' })).toHaveTextContent('Price needs confirmation');
    expect(screen.queryByText('Free')).not.toBeInTheDocument();
  });

  it('retains Free map markers and previews for explicit Items/Free listings', async () => {
    render(<ListingMap results={[{ ...listing, description: 'Previously rented at 10€/hour', price: 0, subcategory: 'Free' }]} />);
    await userEvent.click(screen.getByRole('button', { name: 'View listing: Bicycle · Free' }));
    expect(screen.getByRole('dialog', { name: 'Bicycle' })).toHaveTextContent('Free');
    expect(screen.queryByText('Price needs confirmation')).not.toBeInTheDocument();
  });

  it('retains the rate basis in map markers and their listing previews', async () => {
    render(<ListingMap results={[{ ...listing, title: 'Home care', description: 'Home care 10€/hour', price: 10 }]} />)
    const marker = screen.getByRole('button', { name: 'View listing: Home care · €10/hour' })
    await userEvent.click(marker)
    expect(screen.getByRole('dialog', { name: 'Home care' })).toHaveTextContent('€10.00/hour')
  })

  it('starts at Athens with zoom controls and requests location only from the explicit locate button', async () => {
    render(<ListingMap results={[]} />);
    expect(state.maps[0].options.center).toEqual([23.7275, 37.9838]);
    expect(state.maps[0].options.performanceMetricsCollection).toBe(false);
    expect(state.maps[0].controls.map((control: any) => control.kind)).toEqual(['attribution', 'navigation', 'locate']);
    expect(state.getCurrentPosition).not.toHaveBeenCalled();
    expect(state.controls[0].options.trackUserLocation).toBe(false);
    expect(state.controls[0].options.fitBoundsOptions.essential).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Find my location' }));
    expect(state.getCurrentPosition).toHaveBeenCalledOnce();
  });

  it('fits only real listings, uses accessible buttons and opens details from the keyboard', async () => {
    render(<ListingMap results={[listing]} />);
    expect(state.bounds[0].coordinates).toEqual([[23.7, 37.9]]);
    expect(state.maps[0].fitBounds.mock.calls[0][1]).toMatchObject({ duration: 0, essential: false });
    const marker = screen.getByRole('button', { name: 'View listing: Bicycle · €120' });
    expect(marker).toHaveAttribute('aria-expanded', 'false');
    expect(marker).toHaveTextContent('€120');
    marker.focus();
    await userEvent.keyboard('{Enter}');
    const preview = screen.getByRole('dialog', { name: 'Bicycle' });
    expect(preview).toHaveAttribute('aria-modal', 'false');
    expect(preview).toHaveTextContent('€120.00');
    expect(preview.querySelector('img')).toHaveAttribute('src', '/bicycle.jpg');
    expect(screen.getByRole('link', { name: 'View listing' })).toHaveAttribute('href', '/listings/listing-1');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(marker).toHaveAttribute('data-selected', 'true');
    expect(marker).toHaveAttribute('aria-expanded', 'true');
    expect(state.popups[0].options).toMatchObject({ closeButton: false, focusAfterOpen: false, offset: 24, maxWidth: '300px' });
    expect(state.popups[0].options.anchor).toBeUndefined();
    expect(state.popups[0].positions.length).toBeGreaterThan(1);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(marker).toHaveFocus();
    expect(marker).toHaveAttribute('aria-expanded', 'false');
  });

  it('localizes controls, marker names, currency and dialog actions into Greek', async () => {
    state.locale = 'el';
    render(<ListingMap results={[listing]} />);
    expect(screen.getByRole('button', { name: greek['map.locate'] })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Προβολή αγγελίας: Bicycle/ }));
    expect(screen.getByRole('dialog').textContent).toContain(new Intl.NumberFormat('el', { style: 'currency', currency: 'EUR' }).format(120));
    expect(screen.getByRole('link', { name: greek['map.viewListing'] })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Κλείσιμο' })).toBeInTheDocument();
  });

  it('handles map errors in non-live views without exposing provider details and cleans up listeners', () => {
    const view = render(<ListingMap results={[]} />);
    const current = state.maps[0];
    act(() => current.handlers.get('error').forEach((callback: () => void) => callback()));
    expect(screen.getByRole('status')).toHaveTextContent('The map is temporarily unavailable');
    expect(screen.getByRole('status')).not.toHaveTextContent('NEXT_PUBLIC_MAPBOX_TOKEN');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(current.remove).toHaveBeenCalledOnce();
    expect(current.handlers.get('error').size).toBe(0);
    expect(state.maps).toHaveLength(2);
    view.unmount();
    expect(state.maps[1].remove).toHaveBeenCalledOnce();
  });

  it('shows a useful unavailable state when provider setup is missing', () => {
    vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', '');
    render(<ListingMap results={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent('You can still explore the listings');
    expect(state.maps).toHaveLength(0);
  });

  it('resizes the existing map when its responsive canvas changes and disconnects on unmount', () => {
    let notifyResize: (() => void) | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notifyResize = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    const view = render(<ListingMap results={[]} />);
    expect(observe).toHaveBeenCalledOnce();
    act(() => notifyResize?.());
    expect(state.maps[0].resize).toHaveBeenCalledOnce();
    expect(state.maps).toHaveLength(1);
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    act(() => notifyResize?.());
    expect(state.maps[0].resize).toHaveBeenCalledOnce();
  });

  it('clears removed markers and an open stale listing without recreating the map', async () => {
    const view = render(<ListingMap results={[listing]} />);
    await userEvent.click(screen.getByRole('button', { name: /View listing: Bicycle/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Bicycle');
    view.rerender(<ListingMap results={[]} />);
    expect(screen.queryByRole('button', { name: /View listing: Bicycle/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(state.maps).toHaveLength(1);
    expect(state.maps[0].remove).not.toHaveBeenCalled();
    view.rerender(<ListingMap results={[listing]} />);
    expect(screen.getByRole('button', { name: /View listing: Bicycle/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps one anchored preview, dismisses it on map click and close, and disposes popup listeners', async () => {
    const second = { ...listing, id: 'desk', title: 'Desk', price: 0 };
    const view = render(<ListingMap results={[listing, second]} />);
    const bicycle = screen.getByRole('button', { name: /View listing: Bicycle/ });
    const desk = screen.getByRole('button', { name: 'View listing: Desk · Free' });
    await userEvent.click(bicycle);
    await userEvent.click(desk);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Desk' })).toBeInTheDocument();
    expect(state.popups[0].remove).toHaveBeenCalledOnce();
    expect(bicycle).toHaveAttribute('aria-expanded', 'false');
    expect(desk).toHaveAttribute('aria-expanded', 'true');
    act(() => state.maps[0].handlers.get('click').forEach((callback: () => void) => callback()));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(desk).toHaveAttribute('data-selected', 'false');
    await userEvent.click(bicycle);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bicycle).toHaveFocus();
    await userEvent.click(desk);
    const lastPopup = state.popups.at(-1);
    view.unmount();
    expect(lastPopup.remove).toHaveBeenCalledOnce();
    expect(lastPopup.handlers.size).toBe(0);
    expect(state.maps[0].handlers.get('click').size).toBe(0);
  });

  it('focuses the current preview when reopening or switching markers from the keyboard', async () => {
    render(<ListingMap results={[listing, { ...listing, id: 'desk', title: 'Desk' }]} />);
    const bicycle = screen.getByRole('button', { name: /View listing: Bicycle/ });
    const desk = screen.getByRole('button', { name: /View listing: Desk/ });
    bicycle.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(bicycle).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Bicycle' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    desk.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Desk' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    desk.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('uses compact localized prices and safe text with honest unavailable-image fallbacks', async () => {
    const title = '<img src=x onerror=alert(1)>';
    render(<ListingMap results={[{ ...listing, id: 'unknown/id', title, description: '<script>unsafe()</script>', imageUrl: 'javascript:alert(1)', price: undefined }, { ...listing, id: 'expensive', title: 'Cargo bike', price: 1200 }]} />);
    expect(screen.getByRole('button', { name: 'View listing: Cargo bike · €1.2K' })).toHaveTextContent('€1.2K');
    await userEvent.click(screen.getByRole('button', { name: `View listing: ${title} · Ask for price` }));
    const preview = screen.getByRole('dialog', { name: title });
    expect(preview).toHaveTextContent('<script>unsafe()</script>');
    expect(preview.querySelector('script, img')).toBeNull();
    expect(preview).toHaveTextContent('No photo');
    expect(screen.getByRole('link', { name: 'View listing' })).toHaveAttribute('href', '/listings/unknown%2Fid');
    await userEvent.click(screen.getByRole('button', { name: /View listing: Cargo bike/ }));
    fireEvent.error(screen.getByRole('dialog').querySelector('img')!);
    expect(screen.getByRole('dialog').querySelector('img')).toBeNull();
    expect(screen.getByRole('dialog')).toHaveTextContent('No photo');
  });

  it('switches the map style with the theme while preserving its view, markers and open preview', async () => {
    const results = [listing];
    const view = render(<ListingMap results={results} />);
    await userEvent.click(screen.getByRole('button', { name: /View listing: Bicycle/ }));
    const marker = screen.getByRole('button', { name: /View listing: Bicycle/ });
    const current = state.maps[0];
    state.theme = 'dark';
    view.rerender(<ListingMap results={results} />);
    expect(current.setStyle).toHaveBeenLastCalledWith('mapbox://styles/mapbox/dark-v11');
    expect(state.maps).toHaveLength(1);
    expect(current.fitBounds).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: /View listing: Bicycle/ })).toBe(marker);
    expect(screen.getByRole('dialog', { name: 'Bicycle' })).toBeInTheDocument();
    expect(state.popups).toHaveLength(1);
    state.theme = 'light';
    view.rerender(<ListingMap results={results} />);
    expect(current.setStyle).toHaveBeenLastCalledWith('mapbox://styles/mapbox/streets-v12');
  });

  it('enriches only live result IDs with the existing photo, category and address', async () => {
    state.rpc.mockResolvedValue({ data: [{ id: listing.id, title: listing.title, description: listing.description, price: 120, lon: 23.7, lat: 37.9 }], error: null });
    state.ids.mockResolvedValue({ data: [{ id: listing.id, main_category: 'Items', sub_category: 'Sell', address: { label: 'Pangrati, Athens' }, listing_images: [{ url: '/other.jpg', main: false }, { url: '/main.jpg', main: true }] }], error: null });
    render(<ListingMap results={[]} live />);
    act(() => state.maps[0].handlers.get('load').forEach((callback: () => void) => callback()));
    await waitFor(() => expect(state.ids).toHaveBeenCalledWith('id', [listing.id]));
    await userEvent.click(await screen.findByRole('button', { name: /View listing: Bicycle/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Items · Sell');
    expect(screen.getByRole('dialog')).toHaveTextContent('Pangrati, Athens');
    expect(screen.getByRole('dialog').querySelector('img')).toHaveAttribute('src', '/main.jpg');
    expect(state.rpc).toHaveBeenCalledOnce();
  });

  it('bounds the preview to a small map and pans only enough to reveal an overflowing card without animation', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    render(<ListingMap results={[listing]} />);
    const current = state.maps[0];
    const canvas = current.options.container as HTMLDivElement;
    Object.defineProperties(canvas, { clientWidth: { value: 270 }, clientHeight: { value: 248 } });
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 270, bottom: 248, width: 270, height: 248 } as DOMRect);
    await userEvent.click(screen.getByRole('button', { name: /View listing: Bicycle/ }));
    const preview = state.popups[0];
    expect(preview.options.anchor).toBe('bottom');
    expect(preview.host.style.getPropertyValue('--needs-map-preview-width')).toBe('246px');
    expect(preview.host.style.getPropertyValue('--needs-map-preview-max-height')).toBe('224px');
    vi.spyOn(preview.container, 'getBoundingClientRect')
      .mockReturnValueOnce({ left: 12, right: 258, top: -70, bottom: 130, width: 246, height: 200 } as DOMRect)
      .mockReturnValue({ left: 12, right: 258, top: 12, bottom: 212, width: 246, height: 200 } as DOMRect);
    act(() => frames.shift()?.(0));
    expect(current.panBy).toHaveBeenCalledWith([0, -82], { duration: 0, animate: false, essential: false });
    act(() => frames.shift()?.(16));
    expect(current.panBy).toHaveBeenCalledOnce();
    expect(state.maps).toHaveLength(1);
  });
});
