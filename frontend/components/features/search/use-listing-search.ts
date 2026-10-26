'use client';

import { useEffect, useState } from 'react';

export interface SearchListing {
  id: string;
  title: string;
  description: string;
  price: number;
  main_category: string;
  sub_category: string;
  seller_id: string;
  sellerRating?: number;
  coordinates: [number, number] | null;
  address?: { label?: string } | string;
  listing_images?: { url: string; main: boolean }[];
}

interface SearchResponse {
  listings: SearchListing[];
  pagination: { total: number; page: number; totalPages: number };
  locationApplied: boolean;
}

export function useListingSearch(parameters: string) {
  const [data, setData] = useState<SearchResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?${parameters}`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Search service temporarily unavailable');
        if (!controller.signal.aborted) setData(result);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setData(null);
          setError(cause instanceof Error ? cause.message : 'Search service temporarily unavailable');
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [parameters, attempt]);

  return { data, isLoading, error, retry: () => setAttempt(value => value + 1) };
}
