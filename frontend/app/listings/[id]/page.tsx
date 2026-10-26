import { notFound } from 'next/navigation';
import { ListingDetail } from '@/components/features/search/listing-detail';

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  return <div className="container mx-auto p-4 pt-[72px]"><ListingDetail id={id} /></div>;
}
