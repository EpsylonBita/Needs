import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ setState: vi.fn() }));
vi.mock('nuqs', async importOriginal => {
  const actual = await importOriginal<typeof import('nuqs')>();
  return {
    ...actual,
    useQueryStates: () => [{ q: 'desk', category: 'Items', subcategory: 'Sell', tags: 'wood', page: 3, distance: 50, coordinates: '' }, mocks.setState],
  };
});

import { getSearchResetGeneration, useSearchState } from '@/hooks/use-search-state';

beforeEach(() => {
  mocks.setState.mockReset();
  mocks.setState.mockResolvedValue(new URLSearchParams());
});

describe('shared search reset generation', () => {
  it('invalidates pending work synchronously before starting the URL reset and returns its original promise', async () => {
    const before = getSearchResetGeneration();
    let finish!: (value: URLSearchParams) => void;
    const pending = new Promise<URLSearchParams>(resolve => { finish = resolve; });
    mocks.setState.mockImplementation(value => {
      expect(value).toBeNull();
      expect(getSearchResetGeneration()).toBe(before + 1);
      return pending;
    });
    const { result } = renderHook(() => useSearchState());
    const returned = result.current.reset();
    expect(returned).toBe(pending);
    expect(getSearchResetGeneration()).toBe(before + 1);
    finish(new URLSearchParams());
    await returned;
  });

  it('shares invalidation across independent filter and result hook instances', async () => {
    const filters = renderHook(() => useSearchState());
    const results = renderHook(() => useSearchState());
    const locationGeneration = getSearchResetGeneration();
    await results.result.current.reset();
    expect(getSearchResetGeneration()).toBe(locationGeneration + 1);
    await filters.result.current.reset();
    expect(getSearchResetGeneration()).toBe(locationGeneration + 2);
    expect(mocks.setState).toHaveBeenNthCalledWith(1, null);
    expect(mocks.setState).toHaveBeenNthCalledWith(2, null);
  });

  it('keeps ordinary filter changes separate from a reset and preserves atomic category clearing', async () => {
    const { result } = renderHook(() => useSearchState());
    const before = getSearchResetGeneration();
    await result.current.category.set('Services');
    expect(mocks.setState).toHaveBeenLastCalledWith({ category: 'Services', subcategory: null, page: null });
    await result.current.coordinates.set('23.7,37.9');
    expect(mocks.setState).toHaveBeenLastCalledWith({ coordinates: '23.7,37.9', location: null, page: null });
    expect(getSearchResetGeneration()).toBe(before);
  });

  it('stores the selected label and center atomically and clears both together', async () => {
    const { result } = renderHook(() => useSearchState());
    await result.current.location.set('23.72,37.98', 'Athens');
    expect(mocks.setState).toHaveBeenLastCalledWith({ coordinates: '23.72,37.98', location: 'Athens', page: null });
    await result.current.location.set(null);
    expect(mocks.setState).toHaveBeenLastCalledWith({ coordinates: null, location: null, page: null });
  });

  it('does not revive previously captured work if the asynchronous URL update fails', async () => {
    const { result } = renderHook(() => useSearchState());
    const before = getSearchResetGeneration();
    mocks.setState.mockRejectedValueOnce(new Error('URL update failed'));
    await expect(result.current.reset()).rejects.toThrow('URL update failed');
    expect(getSearchResetGeneration()).toBe(before + 1);
  });

  it('preserves raw tag edits while keeping the existing array setter compatible', async () => {
    const { result } = renderHook(() => useSearchState());
    expect(result.current.tags.raw).toBe('wood');
    expect(result.current.tags.value).toEqual(['wood']);
    await result.current.tags.setRaw('home repair,  ');
    expect(mocks.setState).toHaveBeenLastCalledWith({ tags: 'home repair,  ', page: null });
    await result.current.tags.set(['home repair', 'wood working']);
    expect(mocks.setState).toHaveBeenLastCalledWith({ tags: 'home repair,wood working', page: null });
    await result.current.tags.setRaw('');
    expect(mocks.setState).toHaveBeenLastCalledWith({ tags: null, page: null });
  });
});
