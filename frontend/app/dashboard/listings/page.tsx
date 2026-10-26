'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Eye, ImageIcon, Package, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { useI18n } from '@/contexts/i18n-context'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { NewListingButton } from '@/components/features/ads/new-listing-button'
import { getMyListings, updateListingStatus, deleteListing, type OwnedListing } from '@/lib/services/listing-service'
import { ownerListingCopy, ownerStatus, statusLabel } from '@/components/features/listings/owner-listing-copy'
import styles from '@/components/features/listings/owner-listings.module.css'

type Filter = 'all' | 'active' | 'paused' | 'sold' | 'held'
function MyListings({ userId }: { userId: string }) {
  const { locale } = useI18n()
  const copy = ownerListingCopy[locale === 'el' ? 'el' : 'en']
  const client = useQueryClient()
  const [filter, setFilter] = useState<Filter>('all')
  const [deleting, setDeleting] = useState<OwnedListing | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const query = useQuery({ queryKey: ['my-listings', userId], queryFn: ({ signal }) => getMyListings(userId, signal), retry: false, refetchOnWindowFocus: true })
  const rows = query.data || []
  const mutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'active' | 'sold' | 'suspended' | 'delete' }) => {
      if (action === 'delete') await deleteListing(id, userId)
      else await updateListingStatus(id, action, userId)
    },
    onSuccess: async (_, { id, action }) => {
      setDeleting(null)
      setFeedback({ kind: 'success', message: action === 'delete' ? copy.deleted : copy.saved })
      await Promise.all([
        client.invalidateQueries({ queryKey: ['my-listings', userId] }),
        client.invalidateQueries({ queryKey: ['my-listing', userId, id] }),
        client.invalidateQueries({ queryKey: ['profile-overview', userId] }),
      ])
    },
    onError: (_, { action }) => setFeedback({ kind: 'error', message: action === 'delete' ? copy.deleteError : copy.actionError }),
    retry: false,
  })
  const act = (id: string, action: 'active' | 'sold' | 'suspended' | 'delete') => { setFeedback(null); mutation.mutate({ id, action }) }
  const filtered = rows.filter(listing => filter === 'all' || ownerStatus(listing) === filter)
  const money = (listing: OwnedListing) => listing.sub_category === 'Free' ? copy.free : new Intl.NumberFormat(locale === 'el' ? 'el-GR' : 'en-GB', { style: 'currency', currency: 'EUR' }).format(listing.price)

  return <div className={styles.page}>
    <Link href="/profile" className={styles.back}><ArrowLeft size={15} />{copy.back}</Link>
    <header className={styles.heading}><div><h1>{copy.title}</h1><p>{copy.subtitle}</p></div><div className={styles.headingActions}>
      <NewListingButton /><Button variant="outline" disabled={query.isFetching} onClick={() => { void query.refetch() }} aria-label={copy.refresh}><RefreshCw size={16} className={query.isFetching ? 'animate-spin' : ''} /></Button>
    </div></header>
    <div className={styles.filters} role="group" aria-label={copy.filter}>{(['all', 'active', 'paused', 'sold', 'held'] as Filter[]).map(value => <button key={value} type="button" className={styles.filter} aria-pressed={filter === value} onClick={() => setFilter(value)}>
      {copy[value]}{query.data && <span>{value === 'all' ? rows.length : rows.filter(listing => ownerStatus(listing) === value).length}</span>}
    </button>)}</div>
    {feedback && !deleting && <p role={feedback.kind === 'error' ? 'alert' : 'status'} className={styles[feedback.kind]}>{feedback.message}</p>}
    {query.isPending ? <p role="status" className={styles.loading}>{copy.loading}</p> : query.isError ? <div role="alert" className={styles.error}><p>{copy.loadError}</p><Button variant="outline" onClick={() => { void query.refetch() }}>{copy.retry}</Button></div> : <>
      {filtered.length === 0 && <div className={styles.empty}><Package size={32} aria-hidden="true" /><h2>{rows.length ? copy.noResults : copy.empty}</h2>{!rows.length && <><p>{copy.emptyHint}</p><NewListingButton variant="outline" /></>}</div>}
      <div className={styles.cards}>{filtered.map(listing => {
        const image = listing.images.find(image => image.main) || listing.images[0]
        const path = `/dashboard/listings/${encodeURIComponent(listing.id)}`
        return <article className={styles.card} key={listing.id} aria-labelledby={`listing-${listing.id}`}>
          <div className={styles.summary}><Link href={path} className={styles.thumbnail} aria-label={`${copy.view}: ${listing.title}`}>
            {image ? <Image src={image.url} alt="" width={240} height={224} unoptimized /> : <Package size={27} aria-hidden="true" />}
          </Link><div className={styles.content}><div className={styles.topline}><h2 id={`listing-${listing.id}`}><Link href={path}>{listing.title}</Link></h2><span className={styles.price}>{money(listing)}</span></div>
            <div className={styles.meta}><span className={styles.badge} data-status={ownerStatus(listing)}>{statusLabel(listing, copy)}</span><span>{listing.main_category === 'Items' ? copy.items : copy.services} · {copy[listing.sub_category]}</span></div>
            <p className={styles.excerpt}>{listing.description}</p>
          </div></div>
          <div className={styles.actions}><div className={styles.actionGroup}>
            <Button asChild variant="outline" size="sm"><Link href={path}><Eye size={15} />{copy.view}</Link></Button>
            {listing.can_edit && <Button asChild size="sm"><Link href={`${path}/edit`}><Pencil size={15} />{copy.edit}</Link></Button>}
            {listing.can_edit_images && <Button asChild variant="ghost" size="sm"><Link href={`${path}/images`}><ImageIcon size={15} />{copy.photos}</Link></Button>}
          </div>{!listing.moderation_suspended && <div className={styles.actionGroup}>
            <Button variant="ghost" size="sm" disabled={mutation.isPending} onClick={() => act(listing.id, listing.status === 'active' ? 'suspended' : 'active')}>{listing.status === 'active' ? copy.pause : copy.activate}</Button>
            {listing.status !== 'sold' && <Button variant="ghost" size="sm" disabled={mutation.isPending} onClick={() => act(listing.id, 'sold')}>{copy.complete}</Button>}
            <Button variant="ghost" size="sm" disabled={mutation.isPending} onClick={() => { setFeedback(null); setDeleting(listing) }}><Trash2 size={14} />{copy.remove}</Button>
          </div>}</div>
          {listing.moderation_suspended && <p className={styles.notice}>{copy.holdNotice}</p>}
        </article>
      })}</div>
    </>}
    <Dialog open={!!deleting} onOpenChange={open => { if (!open && !mutation.isPending) setDeleting(null) }}><DialogContent closeLabel={copy.cancel} closeDisabled={mutation.isPending} className="w-[calc(100%-2rem)] max-w-md rounded-2xl">
      <DialogHeader className="pr-8 text-left"><DialogTitle>{copy.deleteTitle}</DialogTitle><DialogDescription className="pt-2 leading-6">{copy.deleteHint}</DialogDescription></DialogHeader>
      <p className="break-words text-sm font-semibold">{deleting?.title}</p>
      {feedback?.kind === 'error' && <p role="alert" className="text-sm text-destructive">{feedback.message}</p>}
      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={mutation.isPending} onClick={() => setDeleting(null)}>{copy.cancel}</Button><Button variant="destructive" disabled={mutation.isPending} onClick={() => { if (deleting) act(deleting.id, 'delete') }}>{mutation.isPending ? copy.deleting : copy.remove}</Button></div>
    </DialogContent></Dialog>
  </div>
}

export default function MyListingsPage() {
  const { user } = useAuth()
  const { locale } = useI18n()
  if (!user) return <p role="status" className={styles.loading}>{ownerListingCopy[locale === 'el' ? 'el' : 'en'].loading}</p>
  return <MyListings key={user.id} userId={user.id} />
}
