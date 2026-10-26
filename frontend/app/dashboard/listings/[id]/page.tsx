import { notFound } from 'next/navigation'
import { OwnerListingPreview } from '@/components/features/listings/owner-listing-preview'

export default async function OwnerListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound()
  return <OwnerListingPreview id={id} />
}
