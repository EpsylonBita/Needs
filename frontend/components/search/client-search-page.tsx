'use client';

import { Suspense } from 'react';

import dynamic from 'next/dynamic';

import { Skeleton } from '@/components/ui/skeleton';

// Dynamically import components with loading fallbacks
const SearchHeader = dynamic(() => import('./search-header'), {
  loading: () => <Skeleton className="h-20 w-full" />,
  ssr: false
});

const SearchFilters = dynamic(() => import('./search-filters'), {
  loading: () => <Skeleton className="h-64 w-full" />,
  ssr: false
});

const SearchResults = dynamic(() => import('./search-results').then(m => m.SearchResults), {
  loading: () => (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-64 w-full" />
      ))}
    </div>
  ),
  ssr: false
});

/**
 * ClientSearchPage - A client component that wraps all the client-side search functionality
 * This is separated to allow the parent page.tsx to be a server component
 */
export function ClientSearchPage() {
  return (
    <>
      <SearchHeader />
      
      <div className="grid gap-6 md:grid-cols-4">
        <div className="md:col-span-1">
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <SearchFilters />
          </Suspense>
        </div>
        
        <div className="md:col-span-3">
          <Suspense fallback={
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-64 w-full" />
              ))}
            </div>
          }>
            <SearchResults />
          </Suspense>
        </div>
      </div>
    </>
  );
}
