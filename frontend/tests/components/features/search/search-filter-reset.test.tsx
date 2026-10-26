import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ locate: vi.fn() }));
vi.mock('@/lib/services/location-service', () => ({ getCurrentLocation: mocks.locate }));

import SearchFilters from '@/components/features/search/search-filters';
import { useSearchState } from '@/hooks/use-search-state';

function ExternalResetControl() {
  const { coordinates, reset } = useSearchState();
  return <>
    <button type="button" onClick={() => { void reset(); }}>Reset from results</button>
    <output aria-label="Active coordinates">{coordinates.value || 'All locations'}</output>
  </>;
}

function TagStateProbe() {
  const { tags } = useSearchState();
  return <output aria-label="Normalized tags">{JSON.stringify(tags.value)}</output>;
}

function pendingLocation() {
  let resolve!: (value: { lat: number; lng: number }) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<{ lat: number; lng: number }>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => { mocks.locate.mockReset(); });

describe('filter reset integration', () => {
  it('preserves multiword tags while typing and exposes trimmed tags to search consumers', async () => {
    const user = userEvent.setup();
    const update = vi.fn();
    render(<NuqsTestingAdapter searchParams="?page=3" hasMemory onUrlUpdate={update}>
      <SearchFilters /><TagStateProbe />
    </NuqsTestingAdapter>);
    const input = screen.getByRole('textbox', { name: 'Tags' });
    await user.type(input, 'home repair');
    expect(input).toHaveValue('home repair');
    await user.type(input, ',  wood working ');
    expect(input).toHaveValue('home repair,  wood working ');
    expect(screen.getByLabelText('Normalized tags')).toHaveTextContent('["home repair","wood working"]');
    await waitFor(() => expect(update.mock.calls.at(-1)?.[0].searchParams.get('tags')).toBe('home repair,  wood working '));
    expect(update.mock.calls.at(-1)?.[0].searchParams.has('page')).toBe(false);
    await user.clear(input);
    expect(screen.getByLabelText('Normalized tags')).toHaveTextContent('[]');
    await waitFor(() => expect(update.mock.calls.at(-1)?.[0].searchParams.has('tags')).toBe(false));
  }, 15_000);

  it('keeps coordinates cleared after an external reset and permits a fresh location request', async () => {
    const first = pendingLocation();
    mocks.locate.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ lng: 23.8, lat: 38.1 });
    const update = vi.fn();
    render(<NuqsTestingAdapter searchParams="?q=desk&coordinates=23.7,37.9&page=3" hasMemory onUrlUpdate={update}>
      <SearchFilters /><ExternalResetControl />
    </NuqsTestingAdapter>);

    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(mocks.locate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Finding your location...' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reset from results' }));
    await waitFor(() => expect(update.mock.calls.at(-1)?.[0].searchParams.toString()).toBe(''));

    await act(async () => { first.resolve({ lng: 1.2, lat: 3.4 }); });
    expect(screen.getByLabelText('Active coordinates')).toHaveTextContent('All locations');
    expect(update.mock.calls.at(-1)?.[0].searchParams.has('coordinates')).toBe(false);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Use my location' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    await waitFor(() => expect(update.mock.calls.at(-1)?.[0].searchParams.get('coordinates')).toBe('23.8,38.1'));
    expect(screen.getByLabelText('Active coordinates')).toHaveTextContent('23.8,38.1');
    expect(mocks.locate).toHaveBeenCalledTimes(2);
  });

  it('does not surface a stale location error after an external reset', async () => {
    const first = pendingLocation();
    mocks.locate.mockReturnValueOnce(first.promise);
    render(<NuqsTestingAdapter searchParams="?q=desk" hasMemory><SearchFilters /><ExternalResetControl /></NuqsTestingAdapter>);
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset from results' }));
    await act(async () => { first.reject(new Error('Permission denied')); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Use my location' })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Active coordinates')).toHaveTextContent('All locations');
  });

  it('represents a valid 250 km URL distance without clamping the native slider to 100', () => {
    render(<NuqsTestingAdapter searchParams="?distance=250"><SearchFilters /></NuqsTestingAdapter>);
    const slider = screen.getByRole('slider', { name: 'Distance (km)' });
    expect(slider).toHaveAttribute('max', '500');
    expect((slider as HTMLInputElement).value).toBe('250');
    expect(slider).toHaveAttribute('aria-valuetext', '250 kilometers');
    expect(screen.getByText('250 km')).toBeInTheDocument();
    expect(mocks.locate).not.toHaveBeenCalled();
  });
});
