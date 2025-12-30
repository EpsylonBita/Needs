'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryState, parseAsString, parseAsInteger, parseAsArrayOf } from 'nuqs';

/**
 * A custom hook that uses nuqs to manage search state via URL query parameters.
 * This approach has several benefits:
 * - The URL reflects the current search state (shareable URLs)
 * - Back/forward navigation works with search state
 * - Less client-side state management needed
 * - Better performance with fewer rerenders
 * 
 * @returns An object containing search state and methods to update it
 */
export function useSearchState() {
  const router = useRouter();
  const pathname = usePathname();
  
  // Use nuqs to manage URL query parameters
  const [query, setQueryRaw] = useQueryState('q', parseAsString);
  const [category, setCategoryRaw] = useQueryState('category', parseAsString);
  const [subcategory, setSubcategoryRaw] = useQueryState('subcategory', parseAsString);
  const [tagsString, setTagsStringRaw] = useQueryState('tags', parseAsString);
  const [page, setPageRaw] = useQueryState('page', parseAsInteger.withDefault(1));
  const [distance, setDistanceRaw] = useQueryState('distance', parseAsInteger.withDefault(50));
  const [coordinates, setCoordinatesRaw] = useQueryState('coordinates', parseAsString);

  // Parse tags from comma-separated string to array
  const tags = {
    value: tagsString ? tagsString.split(',').map(tag => tag.trim()) : [],
    set: (newTags: string[]) => setTagsStringRaw(newTags.length > 0 ? newTags.join(',') : null)
  };

  // Wrapped setters for better type safety and convenience
  const setQuery = useCallback((value: string | null) => {
    setQueryRaw(value || null);
  }, [setQueryRaw]);
  
  const setCategory = useCallback((value: string | null) => {
    setCategoryRaw(value || null);
    // When category changes, reset subcategory
    if (!value) {
      setSubcategoryRaw(null);
    }
  }, [setCategoryRaw, setSubcategoryRaw]);
  
  const setSubcategory = useCallback((value: string | null) => {
    setSubcategoryRaw(value || null);
  }, [setSubcategoryRaw]);
  
  const setPage = useCallback((value: number) => {
    setPageRaw(value);
  }, [setPageRaw]);
  
  const setDistance = useCallback((value: number) => {
    setDistanceRaw(value);
  }, [setDistanceRaw]);
  
  const setCoordinates = useCallback((value: string | null) => {
    setCoordinatesRaw(value || null);
  }, [setCoordinatesRaw]);

  // Reset all search parameters
  const reset = useCallback(() => {
    setQueryRaw(null);
    setCategoryRaw(null);
    setSubcategoryRaw(null);
    setTagsStringRaw(null);
    setPageRaw(1, { shallow: true });
    setDistanceRaw(50, { shallow: true });
    setCoordinatesRaw(null);
  }, [setQueryRaw, setCategoryRaw, setSubcategoryRaw, setTagsStringRaw, setPageRaw, setDistanceRaw, setCoordinatesRaw]);

  return {
    query: { value: query || '', set: setQuery },
    category: { value: category || '', set: setCategory },
    subcategory: { value: subcategory || '', set: setSubcategory },
    tags,
    page: { value: page, set: setPage },
    distance: { value: distance, set: setDistance },
    coordinates: { value: coordinates || '', set: setCoordinates },
    reset
  };
} 