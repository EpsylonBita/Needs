'use client';

import { useQueryStates, parseAsString, parseAsInteger } from 'nuqs';

let searchResetGeneration = 0;

/** Capture before an async search action; a reset in any control invalidates it. */
export function getSearchResetGeneration(): number {
  return searchResetGeneration;
}

const searchParsers = {
  q: parseAsString.withDefault(''),
  category: parseAsString.withDefault(''),
  subcategory: parseAsString.withDefault(''),
  tags: parseAsString.withDefault(''),
  page: parseAsInteger.withDefault(1),
  distance: parseAsInteger.withDefault(50),
  coordinates: parseAsString.withDefault(''),
};

/** Share one URL-backed search state across the header, filters and results. */
export function useSearchState() {
  const [state, setState] = useQueryStates(searchParsers, { shallow: true });

  return {
    query: { value: state.q, set: (value: string | null) => setState({ q: value || null, page: null }) },
    category: { value: state.category, set: (value: string | null) => setState({ category: value || null, subcategory: null, page: null }) },
    subcategory: { value: state.subcategory, set: (value: string | null) => setState({ subcategory: value || null, page: null }) },
    tags: {
      // Keep the editor's text intact; consumers still receive trimmed tag values.
      raw: state.tags,
      value: state.tags ? state.tags.split(',').map(tag => tag.trim()) : [],
      setRaw: (value: string) => setState({ tags: value || null, page: null }),
      set: (value: string[]) => setState({ tags: value.length ? value.join(',') : null, page: null }),
    },
    page: { value: Math.max(1, state.page), set: (value: number) => setState({ page: Math.max(1, value) }) },
    distance: { value: state.distance, set: (value: number) => setState({ distance: value, page: null }) },
    coordinates: { value: state.coordinates, set: (value: string | null) => setState({ coordinates: value || null, page: null }) },
    reset: () => {
      // Invalidate pending work before the asynchronous URL update begins.
      searchResetGeneration += 1;
      return setState(null);
    },
  };
}
