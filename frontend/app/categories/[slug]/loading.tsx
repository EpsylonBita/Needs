'use client';

import { Skeleton } from '@/components/ui/skeleton';

export function LoadingSubcategories() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="border rounded-lg p-4 flex flex-col">
          <Skeleton className="h-4 w-3/4 mb-2" />
          <Skeleton className="h-3 w-full mb-1.5" />
          <Skeleton className="h-3 w-5/6 mb-1.5" />
          <Skeleton className="h-3 w-2/3 mb-4" />
          <div className="flex justify-between mt-auto">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-8">
      <Skeleton className="h-10 w-1/3 mb-6" />
      <Skeleton className="h-4 w-full max-w-2xl mb-8" />
      <LoadingSubcategories />
    </div>
  );
} 