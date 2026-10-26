'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, ImageIcon, Package, Pencil } from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { useI18n } from '@/contexts/i18n-context'
import { Button } from '@/components/ui/button'
import { getMyListing } from '@/lib/services/listing-service'
import { ownerListingCopy, ownerStatus, statusLabel } from './owner-listing-copy'
import styles from './owner-listings.module.css'

function Preview({ id, userId }: { id: string; userId: string }) {
  const { locale } = useI18n()
  const copy = ownerListingCopy[locale === 'el' ? 'el' : 'en']
  const query = useQuery({ queryKey: ['my-listing', userId, id], queryFn: ({ signal }) => getMyListing(id, userId, signal), retry: false })
  const listing = query.data
  const path = `/dashboard/listings/${encodeURIComponent(id)}`
  return <div className={styles.page}>
    <Link href="/dashboard/listings" className={styles.back}><ArrowLeft size={15} />{copy.backToList}</Link>
    {query.isPending ? <p role="status" className={styles.loading}>{copy.loading}</p> : query.isError || !listing ? <div role="alert" className={styles.error}><p>{copy.unavailable}</p><Button variant="outline" onClick={() => { void query.refetch() }}>{copy.retry}</Button></div> : <>
      <header className={styles.heading}><div><p>{copy.ownerPreview}</p><h1>{listing.title}</h1></div><div className={styles.headingActions}>
        {listing.can_edit && <Button asChild><Link href={`${path}/edit`}><Pencil size={16} />{copy.edit}</Link></Button>}
        {listing.can_edit_images && <Button asChild variant="outline"><Link href={`${path}/images`}><ImageIcon size={16} />{copy.photos}</Link></Button>}
        {listing.status === 'active' && <Button asChild variant="ghost"><Link href={`/listings/${encodeURIComponent(id)}`}><ExternalLink size={16} />{copy.publicView}</Link></Button>}
      </div></header>
      {listing.status !== 'active' && <p className={styles.notice}>{listing.moderation_suspended ? copy.holdNotice : copy.privateNote}</p>}
      <article className={styles.preview}>
        <div className={styles.previewHeader}><div className={styles.meta}><span className={styles.badge} data-status={ownerStatus(listing)}>{statusLabel(listing, copy)}</span><span>{listing.main_category === 'Items' ? copy.items : copy.services} · {copy[listing.sub_category]}</span></div><span className={styles.price}>{listing.sub_category === 'Free' ? copy.free : new Intl.NumberFormat(locale === 'el' ? 'el-GR' : 'en-GB', { style: 'currency', currency: 'EUR' }).format(listing.price)}</span></div>
        {listing.images.length ? <div className={styles.gallery}>{[...listing.images].sort((a, b) => Number(b.main) - Number(a.main)).map((image, index) => <Image key={image.id} src={image.url} alt={`${listing.title} · ${index + 1}`} width={640} height={480} unoptimized />)}</div> : <div className={styles.empty}><Package size={28} /><p>{copy.noPhotos}</p></div>}
        <h2 className="mb-3 mt-6 text-sm font-semibold">{copy.description}</h2><p className={styles.description}>{listing.description}</p>
        <dl className={styles.details}>
          <div><dt>{copy.location}</dt><dd>{typeof listing.address === 'string' ? listing.address : typeof listing.address?.label === 'string' ? listing.address.label : copy.noLocation}</dd></div>
          {listing.contact_number && <div><dt>{copy.contact}</dt><dd>{listing.contact_number}</dd></div>}
          {listing.tags.length > 0 && <div><dt>{copy.tags}</dt><dd className={styles.tags}>{listing.tags.map(tag => <span key={tag}>{tag}</span>)}</dd></div>}
        </dl>
      </article>
    </>}
  </div>
}

export function OwnerListingPreview({ id }: { id: string }) {
  const { user } = useAuth()
  const { locale } = useI18n()
  if (!user) return <p role="status" className={styles.loading}>{ownerListingCopy[locale === 'el' ? 'el' : 'en'].loading}</p>
  return <Preview key={`${user.id}:${id}`} id={id} userId={user.id} />
}
