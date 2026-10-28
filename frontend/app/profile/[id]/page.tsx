"use client";

import { useEffect, useRef, useState } from 'react'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { MapPin, UserRound } from 'lucide-react'

import { supabase } from '@/lib/supabase/client'
import { withCsrfHeaders } from '@/lib/utils/csrf'
import { useAuth } from '@/contexts/auth-context'
import { useI18n } from '@/contexts/i18n-context'
import { Button } from '@/components/ui/button'
import { orderMoney } from '@/components/features/orders/order-copy'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ListingCard } from '@/components/features/search/search-results'
import { demoListingCopy, isDemoListing } from '@/lib/listings/demo-policy'
import type { SearchListing } from '@/components/features/search/use-listing-search'
import { publicProfileCopy } from '@/components/features/profile/public-profile-copy'

const copies = {
  en: { user: 'NEEDS member', reputation: 'Reputation', rating: 'Rating', noReviews: 'No reviews', dashboard: 'Dashboard', listings: 'Listings', title: 'Title', price: 'Price', status: 'Status', noListings: 'No public listings.', active: 'Available', sold: 'Sold', paused: 'Paused', closed: 'Closed', unavailableStatus: 'Unavailable', review: 'Leave a Review', payment: 'Completed payment', comment: 'Review comment', optional: 'Comment (optional)', submit: 'Submit Review', submitting: 'Submitting…', submitted: 'Your review was submitted.', integer: 'Choose an integer rating from 1 to 5.', session: 'Your session changed. Sign in again before submitting your review.', submitError: 'Could not submit your review. Try again.', paymentsError: 'Could not load your completed payments. Refresh and try again.', reviewsError: 'Could not load your previous reviews. Refresh and try again.', loading: 'Loading profile…', loadError: 'This profile could not be loaded. Try again.', unavailable: 'This profile is not available.', retry: 'Try again', browse: 'Explore listings', duplicate: 'You have already reviewed this payment.' },
  el: { user: 'Μέλος του NEEDS', reputation: 'Φήμη', rating: 'Βαθμολογία', noReviews: 'Χωρίς αξιολογήσεις', dashboard: 'Πίνακας ελέγχου', listings: 'Αγγελίες', title: 'Τίτλος', price: 'Τιμή', status: 'Κατάσταση', noListings: 'Δεν υπάρχουν δημόσιες αγγελίες.', active: 'Διαθέσιμη', sold: 'Πωλήθηκε', paused: 'Σε παύση', closed: 'Έκλεισε', unavailableStatus: 'Μη διαθέσιμη', review: 'Γράψε αξιολόγηση', payment: 'Ολοκληρωμένη πληρωμή', comment: 'Σχόλιο αξιολόγησης', optional: 'Σχόλιο (προαιρετικό)', submit: 'Υποβολή αξιολόγησης', submitting: 'Υποβολή…', submitted: 'Η αξιολόγησή σου υποβλήθηκε.', integer: 'Επίλεξε ακέραιη βαθμολογία από 1 έως 5.', session: 'Η σύνδεσή σου άλλαξε. Συνδέσου ξανά πριν υποβάλεις αξιολόγηση.', submitError: 'Η αξιολόγηση δεν υποβλήθηκε. Δοκίμασε ξανά.', paymentsError: 'Οι ολοκληρωμένες πληρωμές σου δεν φορτώθηκαν. Ανανέωσε και δοκίμασε ξανά.', reviewsError: 'Οι προηγούμενες αξιολογήσεις σου δεν φορτώθηκαν. Ανανέωσε και δοκίμασε ξανά.', loading: 'Φόρτωση προφίλ…', loadError: 'Το προφίλ δεν φορτώθηκε. Δοκίμασε ξανά.', unavailable: 'Αυτό το προφίλ δεν είναι διαθέσιμο.', retry: 'Δοκίμασε ξανά', browse: 'Αναζήτηση αγγελιών', duplicate: 'Έχεις ήδη αξιολογήσει αυτή την πληρωμή.' },
}

type ProfileRow = { id: string; display_name?: string; avatar_url?: string; title?: string; bio?: string; location?: string; created_at?: string }
type ListingRow = SearchListing & { status: string }
type ReviewPayment = { id: string; listing_id: string; title: string; amount: number; currency: string }

export default function PublicProfilePage() {
  const params = useParams()
  const { user } = useAuth()
  const idParam = (params?.id ?? '') as string | string[]
  const id = Array.isArray(idParam) ? idParam[0] : idParam
  // Navigation and account changes start a fresh state owner. A late review
  // response for the previous context must never mutate the next profile.
  return <ProfileContent key={`${id}:${user?.id || 'guest'}`} id={id} viewerId={user?.id} />
}

function ProfileContent({ id, viewerId }: { id: string; viewerId?: string }) {
  const { locale } = useI18n()
  const language = locale === 'el' ? 'el' : 'en'
  const copy = copies[language]
  const publicCopy = publicProfileCopy[language]
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [rating, setRating] = useState<{ avg: number; count: number } | null>(null)
  const [listings, setListings] = useState<ListingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [isOwner, setIsOwner] = useState(false)
  const [eligiblePayments, setEligiblePayments] = useState<ReviewPayment[]>([])
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null)
  const [reviewRating, setReviewRating] = useState<number>(5)
  const [reviewComment, setReviewComment] = useState<string>('')
  const [reviewSubmitted, setReviewSubmitted] = useState<boolean>(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [submittingReview, setSubmittingReview] = useState(false)
  const reviewRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setLoadFailed(false)
      setEligiblePayments([])
      setSelectedPaymentId(null)
      setReviewSubmitted(false)
      setReviewError(null)
      setSubmittingReview(false)
      setIsOwner(false)
      const { data: p, error: profileError } = await supabase.from('profiles').select('id,display_name,avatar_url,title,bio,location,created_at').eq('id', id).single()
      if (cancelled) return
      if (profileError && profileError.code !== 'PGRST116') throw profileError
      setProfile(p)
      if (!p) return
      const { data: revs, error: ratingsError } = await supabase
        .from('reviews')
        .select('rating')
        .eq('seller_id', id)
      if (cancelled) return
      if (ratingsError) throw ratingsError
      if (revs && revs.length > 0) {
        const sum = revs.reduce((acc: number, r: { rating?: number }) => acc + Number(r.rating || 0), 0)
        setRating({ avg: sum / revs.length, count: revs.length })
      } else {
        setRating({ avg: 0, count: 0 })
      }
      const { data: ls, error: listingsError } = await supabase
        .from('listings')
        .select('id,title,description,main_category,sub_category,price,status,seller_id,address,listing_images(url,main)')
        .eq('seller_id', id)
        .eq('status', 'active')
        .eq('moderation_suspended', false)
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (listingsError) throw listingsError
      setListings((ls || []) as ListingRow[])
      if (!viewerId) return
      const u = await supabase.auth.getUser()
      if (cancelled) return
      const uid = u.data.user?.id
      if (uid && uid === viewerId) {
        const { data: me } = await supabase.from('profiles').select('id').eq('user_id', uid).limit(1).single()
        if (cancelled) return
        if (me?.id) {
          setIsOwner(me.id === id)
          if (me.id === id) return
          const { data: pays, error: paymentsError } = await supabase
            .from('payments')
            .select('id,listing_id,amount,currency')
            .eq('buyer_id', me.id)
            .eq('seller_id', id)
            .eq('status', 'completed')
          if (cancelled) return
          if (paymentsError) { setReviewError(copy.paymentsError); return }
          const { data: writtenReviews, error: reviewsError } = await supabase.from('reviews')
            .select('payment_id').eq('reviewer_id', me.id).eq('seller_id', id)
          if (cancelled) return
          if (reviewsError) {
            setReviewError(copy.reviewsError)
            return
          }
          const reviewedIds = new Set((writtenReviews || []).map(review => review.payment_id))
          const eligible = (pays || []).filter(payment => !reviewedIds.has(payment.id))
          const listingIds = Array.from(new Set(eligible.map((payment: { listing_id: string }) => payment.listing_id)))
          if (listingIds.length > 0) {
            const { data: ls } = await supabase.from('listings').select('id,title,price,status').in('id', listingIds)
            if (cancelled) return
            // A completed listing can be hidden by listing RLS. The payer's
            // payment still identifies the provider and is eligible for review.
            setEligiblePayments(eligible.map(payment => ({
              id: payment.id, listing_id: payment.listing_id, amount: Number(payment.amount), currency: payment.currency || 'eur',
              title: ls?.find(listing => listing.id === payment.listing_id)?.title || copy.payment,
            })))
            setSelectedPaymentId(eligible[0]?.id || null)
          }
        }
      }
    }
    void run().catch(() => {
      if (!cancelled) setLoadFailed(true)
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => {
      cancelled = true
      reviewRequest.current?.abort()
      reviewRequest.current = null
    }
  }, [id, viewerId, attempt, copy])

  if (loading) return <div className="needs-shell needs-page"><p role="status">{copy.loading}</p></div>
  if (loadFailed) return <div className="needs-shell needs-page space-y-4"><h1 className="text-2xl font-semibold">{copy.user}</h1><p role="alert">{copy.loadError}</p><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>{copy.retry}</Button></div>
  if (!profile) return <div className="needs-shell needs-page space-y-4"><h1 className="text-2xl font-semibold">{copy.unavailable}</h1><Link href="/search" className="inline-flex min-h-11 items-center text-primary">{copy.browse}</Link></div>

  return (
    <div className="needs-shell needs-page space-y-6">
      <div className="flex flex-wrap items-center gap-4 justify-between">
        <Avatar className="h-16 w-16"><AvatarImage src={profile.avatar_url} alt="" className="object-cover" /><AvatarFallback><UserRound aria-hidden="true" className="h-7 w-7" /></AvatarFallback></Avatar>
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="break-words text-2xl font-bold">{profile.display_name || copy.user}</h1>
          {profile.title && <p className="break-words font-medium">{profile.title}</p>}
          {profile.location && <p className="flex items-center gap-2 text-sm text-muted-foreground"><MapPin aria-hidden="true" className="h-4 w-4 shrink-0" /><span className="break-words">{profile.location}</span></p>}
          {profile.created_at && Number.isFinite(Date.parse(profile.created_at)) && <p className="text-sm text-muted-foreground">{publicCopy.memberSince.replace('{date}', new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric' }).format(new Date(profile.created_at)))}</p>}
          {rating && (
            <div className="text-sm text-muted-foreground">{rating.count > 0 ? `${copy.rating}: ${rating.avg.toLocaleString(language, { maximumFractionDigits: 2 })} / 5 (${rating.count})` : copy.noReviews}</div>
          )}
        </div>
        {isOwner && <div>
          <Link href="/dashboard" className="inline-flex min-h-11 items-center px-3 py-2 rounded-md bg-primary text-primary-foreground">{copy.dashboard}</Link>
        </div>}
      </div>
      {profile.bio && <p className="max-w-3xl whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{profile.bio}</p>}
      <div className="max-w-3xl space-y-2 text-sm leading-relaxed text-muted-foreground">
        <p>{rating?.count ? publicCopy.reviewBasis : publicCopy.noHistory}</p>
        <details><summary className="w-fit cursor-pointer rounded-sm py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{publicCopy.reputationHeading}</summary><p className="mt-1">{publicCopy.reputationExplanation}</p></details>
      </div>

      <div>
        <h2 className="text-xl font-semibold">{copy.listings}</h2>
        <div className="mt-4 grid min-w-0 gap-5 lg:grid-cols-2">
          {listings.map((listing, index) => <div key={listing.id} className="min-w-0 space-y-2">
            <ListingCard listing={listing} index={index} />
            <p className="px-1 text-xs font-medium text-muted-foreground">{isDemoListing(listing.id) ? demoListingCopy[locale === 'el' ? 'el' : 'en'].unavailable : ({ active: copy.active, sold: copy.sold, paused: copy.paused, inactive: copy.paused, closed: copy.closed } as Record<string, string>)[listing.status] || copy.unavailableStatus}</p>
          </div>)}
          {listings.length === 0 && <p className="py-4 text-sm text-muted-foreground">{copy.noListings}</p>}
        </div>
      </div>

      {reviewError && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{reviewError}</p><Button variant="outline" disabled={submittingReview} onClick={() => setAttempt(value => value + 1)}>{copy.retry}</Button></div>}
      {reviewSubmitted && <p role="status" className="text-sm">{copy.submitted}</p>}
      {eligiblePayments.length > 0 && (
        <div className="border rounded-md p-3 space-y-2">
          <div className="text-sm font-medium">{copy.review}</div>
          <div className="flex flex-wrap gap-2 items-center">
            <label htmlFor="review-payment" className="sr-only">{copy.payment}</label>
            <select id="review-payment" disabled={submittingReview} value={selectedPaymentId || ''} onChange={(e)=>setSelectedPaymentId(e.target.value)} className="min-h-11 min-w-0 max-w-full border border-input bg-background text-foreground rounded-md p-2">
              {eligiblePayments.map(payment => (<option key={payment.id} value={payment.id}>{payment.title} · {orderMoney(payment.amount, payment.currency, language)} · {payment.id.slice(0, 8)}</option>))}
            </select>
            <input aria-label={copy.rating} disabled={submittingReview} type="number" min={1} max={5} step={1} value={reviewRating} onChange={(e)=>setReviewRating(Number(e.target.value))} className="min-h-11 w-20 border border-input bg-background text-foreground rounded-md p-2" />
          </div>
          <textarea aria-label={copy.comment} disabled={submittingReview} maxLength={4000} value={reviewComment} onChange={(e)=>setReviewComment(e.target.value)} className="w-full border border-input bg-background text-foreground rounded-md p-2" placeholder={copy.optional} />
          <button
            onClick={async () => {
              if (!selectedPaymentId || submittingReview || reviewRequest.current) return
              setReviewError(null)
              setReviewSubmitted(false)
              if (!Number.isInteger(reviewRating) || reviewRating < 1 || reviewRating > 5) {
                setReviewError(copy.integer)
                return
              }
              setSubmittingReview(true)
              const controller = new AbortController()
              reviewRequest.current = controller
              try {
                const s = await supabase.auth.getSession()
                if (controller.signal.aborted) return
                const at = s.data.session?.access_token
                if (s.error || !at || !viewerId || s.data.session?.user.id !== viewerId) throw new Error(copy.session)
                const headers = await withCsrfHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${at}` })
                if (controller.signal.aborted) return
                const res = await fetch('/api/reviews/submit', { method: 'POST', headers, body: JSON.stringify({ paymentId: selectedPaymentId, rating: reviewRating, comment: reviewComment }), signal: controller.signal })
                const result = await res.json().catch(() => null)
                if (controller.signal.aborted) return
                if (!res.ok) throw new Error(result?.error === copies.en.duplicate ? copy.duplicate : language === 'el' ? copy.submitError : typeof result?.error === 'string' ? result.error : copy.submitError)
                const remaining = eligiblePayments.filter(payment => payment.id !== selectedPaymentId)
                setEligiblePayments(remaining)
                setSelectedPaymentId(remaining[0]?.id || null)
                setReviewComment('')
                setReviewSubmitted(true)
                setRating(previous => previous ? {
                  count: previous.count + 1, avg: (previous.avg * previous.count + reviewRating) / (previous.count + 1),
                } : { count: 1, avg: reviewRating })
              } catch (failure) {
                if (!controller.signal.aborted) setReviewError(failure instanceof Error ? failure.message : copy.submitError)
              } finally {
                if (!controller.signal.aborted) setSubmittingReview(false)
                if (reviewRequest.current === controller) reviewRequest.current = null
              }
            }}
            disabled={submittingReview || !selectedPaymentId}
            className="min-h-11 px-3 py-2 rounded-md bg-primary text-primary-foreground disabled:opacity-50"
          >{submittingReview ? copy.submitting : copy.submit}</button>
        </div>
      )}

    </div>
  )
}
