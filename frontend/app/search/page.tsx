import { Suspense } from 'react';

import { ClientSearchPage } from '@/components/features/search/client-search-page';
import { Skeleton } from '@/components/ui/skeleton';

// Force dynamic rendering to prevent static generation issues
export const dynamic = 'force-dynamic';

export default function SearchPage() {
  return (
    <div className="container py-6 space-y-6">
      <Suspense fallback={<Skeleton className="h-20 w-full" />}>
        <ClientSearchPage />
      </Suspense>
    </div>
  );
} 
