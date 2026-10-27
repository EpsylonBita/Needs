import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CreateAdDialog } from '@/components/features/ads/create-ad-dialog';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

const boundary = vi.hoisted(() => ({ create: vi.fn(), remove: vi.fn(), upload: vi.fn(), overview: vi.fn(), analyze: vi.fn(), fetch: vi.fn(), initializeMap: vi.fn(), updateMarker: vi.fn() }));
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: { id: 'auth-account' } }) }));
vi.mock('@/hooks/use-map', () => ({ useMap: () => ({ map: null, initializeMap: boundary.initializeMap, updateMarker: boundary.updateMarker }) }));
vi.mock('@/lib/services/listing-service', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/services/listing-service')>(), createListing: boundary.create, deleteListing: boundary.remove }));
vi.mock('@/lib/services/storage-service', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/services/storage-service')>(), uploadListingImages: boundary.upload }));
vi.mock('@/lib/services/wit-service', () => ({ witService: { analyzeText: boundary.analyze } }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getUser: async () => ({ data: { user: null } }) } } }));
vi.mock('@/components/ui/dialog', () => {
  const Container = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  return { Dialog: Container, DialogContent: Container, DialogDescription: Container, DialogHeader: Container, DialogTitle: Container };
});
vi.mock('next/image', () => ({ default: ({ fill: _fill, unoptimized: _unoptimized, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; unoptimized?: boolean }) => React.createElement('img', props) }));
vi.mock('@/components/features/ads/location-picker', () => ({ LocationPicker: (props: { locationName: string; onLocationNameChange: (name: string) => void; onUseCurrentLocation: () => void; coordinates: number[] | null; onLocationSelect?: (name: string, point: { lat: number; lng: number }, areaTag?: string) => void }) => <><input aria-label="Location" value={props.locationName} onChange={event => props.onLocationNameChange(event.target.value)} /><button type="button" onClick={props.onUseCurrentLocation}>Pick Athens</button><button type="button" onClick={() => { props.onLocationNameChange('Ermou 10, Athens, Greece'); props.onLocationSelect?.('Ermou 10, Athens, Greece', { lat: 37.98, lng: 23.72 }, 'Athens'); }}>Select address suggestion</button><output data-testid="coordinates">{props.coordinates?.join(',') || ''}</output></> }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'test-token');
  vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition: (callback: (position: { coords: { longitude: number; latitude: number } }) => void) => callback({ coords: { longitude: 23.72, latitude: 37.98 } }) } });
  boundary.create.mockResolvedValue({ id: 'created-listing' });
  boundary.remove.mockReset().mockResolvedValue(undefined);
  boundary.upload.mockReset().mockResolvedValue(undefined);
  boundary.overview.mockReset().mockResolvedValue({ activeListings: 1 });
  boundary.analyze.mockImplementation(async (description: string) => description ? { title: 'Wooden desk', location: 'Berlin', category: 'Items', subcategory: 'Sell', tags: [], smartTags: [] } : { tags: [], smartTags: [] });
  boundary.fetch.mockImplementation(async () => ({ ok: true, json: async () => ({ features: [{ center: [13.4, 52.5], place_name: 'Athens' }] }) }));
  vi.stubGlobal('fetch', boundary.fetch);
});
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function OverviewCount() {
  const overview = useQuery({ queryKey: ['profile-overview', 'auth-account'], queryFn: boundary.overview, staleTime: Infinity });
  return <output data-testid="overview-count">{overview.data?.activeListings}</output>;
}

async function fillListing(withPhoto = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  client.setQueryData(['profile-overview', 'auth-account'], { activeListings: 0 });
  client.setQueryData(['profile-overview', 'other-account'], { activeListings: 7 });
  const close = vi.fn();
  render(<QueryClientProvider client={client}><OverviewCount /><CreateAdDialog open onOpenChange={close} /></QueryClientProvider>);
  if (withPhoto) {
    const photo = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], 'desk.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Photos from device'), { target: { files: [photo] } });
    await screen.findByAltText('Listing photo 1');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  } else fireEvent.click(screen.getByRole('button', { name: 'Skip photos' }));
  fireEvent.change(screen.getByLabelText('What would you like to list?'), { target: { value: 'A large wooden desk in good condition.' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Publish listing' })).toBeEnabled());
  return { client, close };
}

function publish() { fireEvent.click(screen.getByRole('button', { name: 'Publish listing' })); }

describe('Create listing location state and persistence', () => {
  it('retains a suggested address point and adds only its area to the tags', async () => {
    await fillListing();
    fireEvent.click(screen.getByRole('button', { name: 'Select address suggestion' }));
    expect(screen.getByTestId('coordinates')).toHaveTextContent('23.72,37.98');
    expect(screen.getByRole('button', { name: 'Athens' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Ermou 10, Athens, Greece' })).not.toBeInTheDocument();
    publish();
    await waitFor(() => expect(boundary.create).toHaveBeenCalledWith(expect.objectContaining({
      coordinates: [23.72, 37.98], address: { label: 'Ermou 10, Athens, Greece' }, tags: expect.arrayContaining(['Athens']),
    })));
    expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it('removes a selected area tag and point when the address is edited', async () => {
    await fillListing();
    fireEvent.click(screen.getByRole('button', { name: 'Select address suggestion' }));
    fireEvent.click(screen.getByRole('button', { name: 'Athens' }));
    fireEvent.click(screen.getByRole('button', { name: 'Athens' }));
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Berlin' } });
    expect(screen.getByTestId('coordinates')).toHaveTextContent('');
    expect(screen.queryByRole('button', { name: 'Athens' })).not.toBeInTheDocument();
    publish();
    await waitFor(() => expect(boundary.create).toHaveBeenCalledWith(expect.objectContaining({ coordinates: [13.4, 52.5], address: { label: 'Berlin' } })));
  });

  it('adds the reverse-geocoded city tag when location is enabled, preserving exclusions', async () => {
    boundary.fetch.mockResolvedValue({ ok: true, json: async () => ({ features: [{ place_name: 'Ermou 10, Athens, Greece', context: [{ id: 'place.1', text: 'Athens' }] }] }) });
    await fillListing();
    fireEvent.click(screen.getByRole('button', { name: 'Pick Athens' }));
    const city = await screen.findByRole('button', { name: 'Athens' });
    expect(city).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(city);
    fireEvent.change(screen.getByLabelText('What would you like to list?'), { target: { value: 'A different description of a wooden desk.' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish listing' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Athens' })).toHaveAttribute('aria-pressed', 'false');
    publish();
    await waitFor(() => expect(boundary.create).toHaveBeenCalled());
    expect(boundary.create.mock.calls[0][0].tags).not.toContain('Athens');
  });

  it('refreshes only the creating account overview and keeps confirmation until dismissed', async () => {
    let finish!: (result: { id: string }) => void;
    boundary.create.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const { client, close } = await fillListing();
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Berlin' } });
    publish();
    await waitFor(() => expect(boundary.create).toHaveBeenCalled());
    expect(screen.getByTestId('overview-count')).toHaveTextContent('0');
    expect(boundary.overview).not.toHaveBeenCalled();
    await act(async () => finish({ id: 'created-listing' }));
    await waitFor(() => expect(screen.getByTestId('overview-count')).toHaveTextContent('1'));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByText('Your listing is published!').closest('[role="status"]')).toHaveTextContent('Your listing is published!');
    expect(screen.getByText('Your listing is published!').closest('[role="status"]')).toHaveFocus();
    expect(screen.getByRole('link', { name: 'View listing' })).toHaveAttribute('href', '/listings/created-listing');
    expect(screen.queryByRole('button', { name: 'Publish listing' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(close).toHaveBeenCalledWith(false);
    expect(client.getQueryState(['profile-overview', 'other-account'])?.isInvalidated).toBe(false);
  });

  it('waits for photo upload before confirming publication and blocks duplicate submissions', async () => {
    let finishUpload!: () => void;
    boundary.upload.mockReturnValueOnce(new Promise<void>(resolve => { finishUpload = resolve; }));
    const { close } = await fillListing(true);
    publish();
    await waitFor(() => expect(boundary.upload).toHaveBeenCalled());
    expect(screen.queryByText('Your listing is published!')).not.toBeInTheDocument();
    const pending = screen.getByRole('button', { name: 'Publishing…' });
    expect(pending).toBeDisabled();
    await act(async () => { fireEvent.submit(pending.closest('form')!); });
    expect(boundary.create).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    await act(async () => finishUpload());
    expect(screen.getByText('Your listing is published!').closest('[role="status"]')).toHaveTextContent('Your listing is published!');
    expect(screen.queryByRole('textbox', { name: 'What would you like to list?' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View listing' })).toHaveAttribute('href', '/listings/created-listing');
    expect(boundary.create).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });

  it('refreshes the overview and prevents duplicate publication when image upload and rollback fail', async () => {
    boundary.upload.mockRejectedValueOnce(new Error('Storage unavailable'));
    boundary.remove.mockRejectedValueOnce(new Error('Rollback unavailable'));
    const { close } = await fillListing(true);
    publish();
    await screen.findByText(/Your listing created-listing is saved in My Listings/);
    await waitFor(() => expect(screen.getByTestId('overview-count')).toHaveTextContent('1'));
    expect(screen.queryByText('Your listing is published!')).not.toBeInTheDocument();
    expect(boundary.remove).toHaveBeenCalledWith('created-listing');
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Publish listing' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Manage photos' })).toHaveAttribute('href', '/dashboard/listings/created-listing/images');
  });

  it('keeps the draft for retry when an unsuccessful photo upload is rolled back', async () => {
    boundary.upload.mockRejectedValueOnce(new Error('Storage unavailable'));
    const { close } = await fillListing(true);
    publish();
    await screen.findByText('Failed to create ad: Storage unavailable');
    expect(screen.queryByText('Your listing is published!')).not.toBeInTheDocument();
    expect(boundary.remove).toHaveBeenCalledWith('created-listing');
    expect(boundary.overview).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Publish listing' })).toBeEnabled();
    expect(screen.getByLabelText('Title')).toHaveValue('Wooden desk');
    expect(close).not.toHaveBeenCalled();
  });

  it('does not refresh the overview when listing persistence itself fails', async () => {
    boundary.create.mockRejectedValueOnce(new Error('Listing unavailable'));
    await fillListing();
    publish();
    await screen.findByText('Failed to create ad: Listing unavailable');
    expect(screen.queryByText('Your listing is published!')).not.toBeInTheDocument();
    expect(screen.getByTestId('overview-count')).toHaveTextContent('0');
    expect(boundary.overview).not.toHaveBeenCalled();
  });

  it('submits a typed location through form validation and geocodes it', async () => {
    await fillListing();
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Berlin' } });
    publish();
    await waitFor(() => expect(boundary.create).toHaveBeenCalledWith(expect.objectContaining({ coordinates: [13.4, 52.5], address: { label: 'Berlin' } })));
  });

  it('invalidates picked coordinates when the user types a replacement address', async () => {
    await fillListing();
    fireEvent.click(screen.getByRole('button', { name: 'Pick Athens' }));
    await screen.findByDisplayValue('Athens');
    expect(screen.getByTestId('coordinates')).toHaveTextContent('23.72,37.98');
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Berlin' } });
    expect(screen.getByTestId('coordinates')).toBeEmptyDOMElement();
    publish();
    await waitFor(() => expect(boundary.create).toHaveBeenCalledWith(expect.objectContaining({ coordinates: [13.4, 52.5], address: { label: 'Berlin' } })));
  });

  it('preserves a deliberately picked address when a later description suggests another area', async () => {
    await fillListing();
    fireEvent.click(screen.getByRole('button', { name: 'Pick Athens' }));
    await screen.findByDisplayValue('Athens');
    fireEvent.change(screen.getByLabelText('What would you like to list?'), { target: { value: 'A wooden desk in Berlin with two drawers.' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish listing' })).toBeEnabled());
    expect(screen.getByLabelText('Location')).toHaveValue('Athens');
    expect(screen.getByTestId('coordinates')).toHaveTextContent('23.72,37.98');
    publish();
    await waitFor(() => expect(boundary.create).toHaveBeenCalledWith(expect.objectContaining({ coordinates: [23.72, 37.98], address: { label: 'Athens' } })));
  });

  it('does not overwrite typed text when an earlier reverse-geocoding request completes', async () => {
    let finishReverse: (response: unknown) => void = () => {};
    boundary.fetch.mockImplementationOnce(() => new Promise(resolve => { finishReverse = resolve; }));
    await fillListing();
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Paris' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pick Athens' }));
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Berlin' } });
    await act(async () => { finishReverse({ ok: true, json: async () => ({ features: [{ place_name: 'Athens' }] }) }); });
    expect(screen.getByLabelText('Location')).toHaveValue('Berlin');
    expect(screen.getByTestId('coordinates')).toBeEmptyDOMElement();
  });

  it('blocks publication until reverse geocoding has resolved the selected point', async () => {
    await fillListing();
    let finishReverse!: (response: unknown) => void;
    boundary.fetch.mockImplementationOnce(() => new Promise(resolve => { finishReverse = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Pick Athens' }));
    const publishButton = screen.getByRole('button', { name: 'Publish listing' });
    expect(publishButton).toBeDisabled();
    // Also exercise submission from a form event while the location is pending.
    await act(async () => { fireEvent.submit(publishButton.closest('form')!); });
    expect(boundary.create).not.toHaveBeenCalled();
    await act(async () => { finishReverse({ ok: true, json: async () => ({ features: [{ place_name: 'Athens' }] }) }); });
    expect(screen.getByLabelText('Location')).toHaveValue('Athens');
    expect(publishButton).toBeEnabled();
    publish();
    await waitFor(() => expect(boundary.create).toHaveBeenCalledWith(expect.objectContaining({ coordinates: [23.72, 37.98], address: { label: 'Athens' } })));
  });

  it.each(['success', 'error'] as const)('ignores an earlier geolocation %s callback while a newer lookup is pending', async outcome => {
    type Position = { coords: { longitude: number; latitude: number } };
    const callbacks: { success: (position: Position) => void; error: () => void }[] = [];
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition: (success: (position: Position) => void, error: () => void) => callbacks.push({ success, error }) } });
    await fillListing();
    fireEvent.click(screen.getByRole('button', { name: 'Pick Athens' }));
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Paris' } });
    expect(screen.getByRole('button', { name: 'Publish listing' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Pick Athens' }));
    await act(async () => {
      if (outcome === 'success') callbacks[0].success({ coords: { longitude: 1, latitude: 2 } });
      else callbacks[0].error();
    });
    expect(screen.getByRole('button', { name: 'Publish listing' })).toBeDisabled();
    expect(screen.getByLabelText('Location')).toHaveValue('Paris');
    expect(screen.getByTestId('coordinates')).toBeEmptyDOMElement();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(boundary.fetch).not.toHaveBeenCalled();
    await act(async () => { callbacks[1].success({ coords: { longitude: 23.72, latitude: 37.98 } }); });
    await screen.findByDisplayValue('Athens');
    expect(screen.getByRole('button', { name: 'Publish listing' })).toBeEnabled();
    expect(screen.getByTestId('coordinates')).toHaveTextContent('23.72,37.98');
    expect(boundary.fetch).toHaveBeenCalledOnce();
  });
});
