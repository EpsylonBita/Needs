import { ListingEditor } from '@/components/features/listings/listing-editor'

export default async function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ListingEditor id={id} />
}
