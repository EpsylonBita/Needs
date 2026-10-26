import { Suspense } from 'react';
import { NearbyDiscovery } from '@/components/features/nearby/nearby-discovery';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata = { title: 'Nearby | Needs', description: 'Find items and services near an area you choose.' };

export default function NearbyPage() {
  return <div className="needs-shell needs-search-page"><Suspense fallback={<Skeleton className="h-80 rounded-2xl" />}><NearbyDiscovery /></Suspense></div>;
}
