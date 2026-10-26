import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocationPicker } from '@/components/features/ads/location-picker';

const context = vi.hoisted(() => ({ locale: 'en' }));
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: context.locale, t: (_key: string, fallback: string) => fallback }) }));
const fetchMock = vi.fn();
const features = [{ id: 'place.athens', text: 'Athens', place_type: ['place'], place_name: 'Athens, Attica, Greece', center: [23.73, 37.98] },
  { id: 'place.thessaloniki', text: 'Thessaloniki', place_type: ['place'], place_name: 'Thessaloniki, Greece', center: [22.94, 40.64] }];
const response = (value = features) => ({ ok: true, json: async () => ({ features: value }) });

beforeEach(() => {
  vi.useFakeTimers(); context.locale = 'en'; fetchMock.mockReset().mockResolvedValue(response());
  vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'test-token'); vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function Harness({ onSelect = vi.fn(), onPublish = vi.fn() }: { onSelect?: React.ComponentProps<typeof LocationPicker>['onLocationSelect']; onPublish?: () => void }) {
  const [name, setName] = useState('');
  return <form onSubmit={event => { event.preventDefault(); onPublish(); }}>
    <LocationPicker locationName={name} onLocationNameChange={setName} onLocationSelect={onSelect} showMap={false} coordinates={null} isLocating={false} onToggleMap={() => {}} onUseCurrentLocation={() => {}} />
    <button type="submit">Publish</button>
  </form>;
}

function enter(query: string) {
  const input = screen.getByRole('combobox');
  fireEvent.focus(input); fireEvent.change(input, { target: { value: query } });
  return input;
}
async function debounce() { await act(async () => { await vi.advanceTimersByTimeAsync(350); }); }

it('waits for three characters and a pause before querying localized suggestions', async () => {
  render(<Harness />);
  enter('At'); await debounce(); expect(fetchMock).not.toHaveBeenCalled();
  const input = enter('Ath');
  await act(async () => { await vi.advanceTimersByTimeAsync(349); });
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const request = new URL(fetchMock.mock.calls[0][0]);
  expect(decodeURIComponent(request.pathname)).toContain('/Ath.json');
  expect(request.searchParams.get('autocomplete')).toBe('true');
  expect(request.searchParams.get('language')).toBe('en');
  expect(request.searchParams.get('limit')).toBe('5');
  expect(screen.getAllByRole('option')).toHaveLength(2);
  expect(input).toHaveAttribute('aria-expanded', 'true');
  expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
});

it('selects with arrow keys and Enter without publishing, passing precise coordinates and city tag', async () => {
  const onSelect = vi.fn(); const onPublish = vi.fn();
  render(<Harness onSelect={onSelect} onPublish={onPublish} />);
  const input = enter('Ath'); await debounce();
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  const option = screen.getByRole('option', { name: 'Athens, Attica, Greece' });
  expect(option).toHaveAttribute('aria-selected', 'true');
  expect(input).toHaveAttribute('aria-activedescendant', option.id);
  expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('Athens, Attica, Greece', { lat: 37.98, lng: 23.73 }, 'Athens');
  expect(input).toHaveValue('Athens, Attica, Greece');
  expect(input).toHaveAttribute('aria-expanded', 'false');
  expect(onPublish).not.toHaveBeenCalled();
  await debounce(); expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('supports pointer selection and closes suggestions after selecting a location', async () => {
  const onSelect = vi.fn();
  render(<Harness onSelect={onSelect} />);
  const input = enter('Ath'); await debounce();
  fireEvent.click(screen.getByRole('option', { name: 'Thessaloniki, Greece' }));
  expect(input).toHaveValue('Thessaloniki, Greece');
  expect(onSelect).toHaveBeenCalledWith('Thessaloniki, Greece', { lat: 40.64, lng: 22.94 }, 'Thessaloniki');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

it('keeps the active keyboard option visible when a long suggestion list needs scrolling', async () => {
  fetchMock.mockResolvedValueOnce(response(Array.from({ length: 5 }, (_, index) => ({ ...features[0], id: `place.${index}`,
    place_name: `Long wrapped address ${index + 1}, Athens, Attica, Greece`,
  }))));
  render(<Harness />);
  const input = enter('Ath'); await debounce();
  const last = screen.getByRole('option', { name: 'Long wrapped address 5, Athens, Attica, Greece' });
  const scrollIntoView = vi.fn();
  Object.defineProperty(last, 'scrollIntoView', { value: scrollIntoView });
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(last).toHaveAttribute('aria-selected', 'true');
  expect(input).toHaveAttribute('aria-activedescendant', last.id);
  expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' });
});

it('aborts old requests and never displays their late response for a newer typed address', async () => {
  let completeOld!: (value: ReturnType<typeof response>) => void;
  fetchMock.mockReturnValueOnce(new Promise(resolve => { completeOld = resolve; }));
  render(<Harness />);
  enter('Ath'); await debounce();
  const oldSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  enter('Thess'); await debounce();
  expect(oldSignal.aborted).toBe(true);
  expect(screen.getAllByRole('option')).toHaveLength(2);
  await act(async () => { completeOld(response([{ ...features[0], id: 'old', place_name: 'Obsolete result' }])); });
  expect(screen.queryByText('Obsolete result')).not.toBeInTheDocument();
  expect(screen.getByRole('combobox')).toHaveValue('Thess');
});

it('Escape dismisses results without propagating to close the surrounding dialog', async () => {
  const onKey = vi.fn();
  render(<div onKeyDown={onKey}><Harness /></div>);
  const input = enter('Ath'); await debounce();
  expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(false);
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(input).toHaveValue('Ath');
  expect(onKey).not.toHaveBeenCalled();
});

it.each(['network', 'token'] as const)('allows manual input when %s prevents autocomplete', async reason => {
  if (reason === 'network') fetchMock.mockRejectedValueOnce(new Error('offline'));
  else vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', '');
  render(<Harness />);
  const input = enter('Athens'); await debounce();
  expect(screen.getByRole('status')).toHaveTextContent('Suggestions are unavailable. You can type your area or choose it on the map.');
  expect(input).toHaveValue('Athens');
  expect(input).toBeEnabled();
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  if (reason === 'token') expect(fetchMock).not.toHaveBeenCalled();
});

it('shows localized empty results while retaining the manually entered address', async () => {
  context.locale = 'el'; fetchMock.mockResolvedValueOnce(response([]));
  render(<Harness />);
  const input = enter('Αθήνα'); await debounce();
  expect(screen.getByRole('combobox', { name: 'Περιοχή' })).toBe(input);
  expect(screen.getByRole('status')).toHaveTextContent('Δεν βρέθηκε τοποθεσία.');
  expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('language')).toBe('el');
  expect(input).toHaveValue('Αθήνα');
});

it('stops a stalled request after ten seconds and restores a useful manual fallback', async () => {
  fetchMock.mockImplementationOnce((_url: string, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  render(<Harness />);
  const input = enter('Athens'); await debounce();
  expect(screen.getByRole('status')).toHaveTextContent('Finding locations…');
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(screen.getByRole('status')).toHaveTextContent('Suggestions are unavailable.');
  expect(input).toHaveValue('Athens');
  expect(input).toBeEnabled();
});

it('cancels requests on blur and ignores responses arriving after unmount', async () => {
  let resolve!: (value: ReturnType<typeof response>) => void;
  fetchMock.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = render(<Harness />);
  const input = enter('Ath'); await debounce();
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  fireEvent.blur(input); expect(signal.aborted).toBe(true);
  view.unmount(); await act(async () => { resolve(response()); });
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});
