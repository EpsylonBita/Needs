import { notFound } from 'next/navigation';
import { ListingDetail } from '@/components/features/search/listing-detail';

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  return <div className="needs-shell max-w-[1160px] pb-12 pt-3 lg:pb-16 lg:pt-5"><ListingDetail id={id} /></div>;
}
