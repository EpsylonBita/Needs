import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ theme: 'light', createMap: vi.fn(), createMarker: vi.fn() }));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: state.theme }) }));
vi.mock('mapbox-gl', () => ({ default: {
  Map: class {
    setStyle = vi.fn();
    remove = vi.fn();
    addControl = vi.fn();
    on = vi.fn();
    constructor(options: unknown) { state.createMap(options); }
  },
  Marker: class {
    coordinates?: [number, number];
    on = vi.fn();
    addTo = vi.fn(() => this);
    setLngLat = vi.fn((coordinates: [number, number]) => { this.coordinates = coordinates; return this; });
    getLngLat = () => ({ lng: this.coordinates?.[0], lat: this.coordinates?.[1] });
    constructor(options: unknown) { state.createMarker(options); }
  },
  NavigationControl: class {},
} }));

import { useMap } from '@/hooks/use-map';

beforeEach(() => { state.theme = 'light'; vi.clearAllMocks(); });
afterEach(cleanup);

describe('create-listing map theme', () => {
  it('switches map styles without replacing the map or selected marker', () => {
    const { result, rerender } = renderHook(() => useMap());
    let dispose: (() => void) | undefined;
    act(() => { dispose = result.current.initializeMap('location-map', { center: [23.72, 37.98], zoom: 12 }); });
    act(() => result.current.updateMarker([23.74, 37.96]));
    const map = result.current.map!;
    const marker = result.current.marker!;
    const initialize = result.current.initializeMap;

    state.theme = 'dark';
    rerender();
    expect(map.setStyle).toHaveBeenLastCalledWith('mapbox://styles/mapbox/dark-v11');
    expect(result.current.map).toBe(map);
    expect(result.current.marker).toBe(marker);
    expect(result.current.initializeMap).toBe(initialize);
    expect(marker.getLngLat()).toEqual({ lng: 23.74, lat: 37.96 });
    expect(marker.setLngLat).toHaveBeenCalledTimes(1);
    expect(state.createMap).toHaveBeenCalledTimes(1);
    expect(state.createMarker).toHaveBeenCalledTimes(1);
    expect(map.remove).not.toHaveBeenCalled();

    state.theme = 'light';
    rerender();
    expect(map.setStyle).toHaveBeenLastCalledWith('mapbox://styles/mapbox/streets-v12');
    expect(state.createMap).toHaveBeenCalledTimes(1);
    act(() => dispose?.());
  });

  it('uses the latest theme when the location picker is opened later', () => {
    const { result, rerender } = renderHook(() => useMap());
    state.theme = 'dark';
    rerender();
    let dispose: (() => void) | undefined;
    act(() => { dispose = result.current.initializeMap('location-map', { center: [23.72, 37.98], zoom: 12 }); });
    expect(state.createMap).toHaveBeenCalledWith(expect.objectContaining({ style: 'mapbox://styles/mapbox/dark-v11', center: [23.72, 37.98], zoom: 12 }));
    expect(state.createMap).toHaveBeenCalledWith(expect.objectContaining({ performanceMetricsCollection: false }));
    expect(result.current.map!.setStyle).not.toHaveBeenCalled();
    act(() => dispose?.());
  });

  it('releases the map on unmount even when its caller ignores the returned disposer', () => {
    const { result, unmount } = renderHook(() => useMap());
    act(() => { result.current.initializeMap('location-map', { center: [23.72, 37.98], zoom: 12 }); });
    const map = result.current.map!;
    expect(map.remove).not.toHaveBeenCalled();
    unmount();
    expect(map.remove).toHaveBeenCalledOnce();
  });

  it('allocates one map for repeated calls before rendering and disposes it only once', () => {
    const { result, unmount } = renderHook(() => useMap());
    let dispose: (() => void) | undefined;
    act(() => {
      dispose = result.current.initializeMap('location-map', { center: [23.72, 37.98], zoom: 12 });
      result.current.initializeMap('location-map', { center: [23.72, 37.98], zoom: 12 });
    });
    const map = result.current.map!;
    expect(state.createMap).toHaveBeenCalledOnce();
    expect(state.createMarker).toHaveBeenCalledOnce();
    act(() => dispose?.());
    expect(map.remove).toHaveBeenCalledOnce();
    unmount();
    expect(map.remove).toHaveBeenCalledOnce();
  });
});
