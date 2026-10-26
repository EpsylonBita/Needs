import { Checkout } from '@/components/features/payments/checkout'

export default async function CheckoutPage({ params, searchParams }: {
  params: Promise<{ listingId: string }>
  searchParams: Promise<{ milestoneId?: string | string[]; chatId?: string | string[] }>
}) {
  const { listingId } = await params
  const { milestoneId, chatId } = await searchParams

  return (
    <div className="needs-shell needs-page">
      <div className="max-w-md">
        <Checkout listingId={listingId} milestoneId={typeof milestoneId === 'string' ? milestoneId : undefined} chatId={typeof chatId === 'string' ? chatId : undefined} />
      </div>
    </div>
  )
}
