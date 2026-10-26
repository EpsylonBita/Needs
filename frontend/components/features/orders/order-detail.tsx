'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, Circle, MessageCircle, RefreshCw, Star } from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { useI18n } from '@/contexts/i18n-context'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { getMyOrder, confirmOrder, captureOrder, reportOrderProblem, submitOrderReview, ORDER_REVIEW_MAX_LENGTH, type OrderDTO } from '@/lib/services/order-service'
import { disputeStatusLabel, orderCopy, orderDate, orderMoney } from './order-copy'
import { OrderPerson, OrderStatus, OrderThumbnail } from './order-parts'
import styles from './orders.module.css'

type Action = 'confirm' | 'capture' | 'complain'

function AccountOrder({ id, userId }: { id: string; userId: string }) {
  const { locale } = useI18n()
  const copy = orderCopy[locale === 'el' ? 'el' : 'en']
  const query = useQuery({ queryKey: ['my-order', userId, id], queryFn: ({ signal }) => getMyOrder(id, userId, signal), retry: false })
  return <div className={styles.page}>
    <Link href="/dashboard/orders" className={styles.back}><ArrowLeft size={15} aria-hidden="true" />{copy.allOrders}</Link>
    <header className={styles.heading}><div><h1>{copy.detail}</h1></div><Button variant="outline" disabled={query.isFetching} aria-label={copy.refresh} onClick={() => { void query.refetch() }}><RefreshCw size={16} className={query.isFetching ? 'animate-spin' : ''} aria-hidden="true" /></Button></header>
    {query.isError && <div role="alert" className={styles.error}><p>{query.data ? copy.stale : copy.detailError}</p><Button variant="outline" disabled={query.isFetching} onClick={() => { void query.refetch() }}>{copy.retry}</Button></div>}
    {query.isPending ? <p role="status" className={styles.loading}>{copy.loadingDetail}</p> : query.data && <OrderContents order={query.data} userId={userId} stale={query.isError} />}
  </div>
}

function OrderContents({ order, userId, stale }: { order: OrderDTO; userId: string; stale: boolean }) {
  const { locale } = useI18n()
  const copy = orderCopy[locale === 'el' ? 'el' : 'en']
  const client = useQueryClient()
  const current = useRef(false)
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<Action | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [captureRequested, setCaptureRequested] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const [rating, setRating] = useState('')
  const [comment, setComment] = useState('')
  useLayoutEffect(() => { current.current = true; return () => { current.current = false } }, [])
  const other = order.my_role === 'buyer' ? order.seller : order.buyer
  const ownConfirmed = order.my_role === 'buyer' ? order.buyer_confirmed : order.seller_confirmed
  const otherConfirmed = order.my_role === 'buyer' ? order.seller_confirmed : order.buyer_confirmed
  const pendingCapture = order.capture_pending || (captureRequested && !['completed', 'refunded', 'failed', 'disputed'].includes(order.status))
  const moneyEnabled = order.payments_enabled && !order.role_review_required
  const allowed = (action: Action) => !busy && !stale && (action === 'confirm'
    ? moneyEnabled && !pendingCapture && order.actions.can_confirm && !ownConfirmed
    : action === 'capture' ? moneyEnabled && order.actions.can_capture && ownConfirmed && otherConfirmed
      : order.actions.can_complain)

  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['my-order', userId, order.id] }),
      client.invalidateQueries({ queryKey: ['my-orders', userId] }),
      client.invalidateQueries({ queryKey: ['profile-overview', userId] }),
    ])
  }
  function open(action: Action) {
    if (!allowed(action)) return
    setError(''); setNotice(''); setDialog(action)
  }
  async function act(action: Action) {
    if (inFlight.current || !allowed(action)) return
    inFlight.current = true; setBusy(true); setError(''); setNotice('')
    try {
      if (action === 'confirm') {
        const saved = await confirmOrder(order.id, userId)
        if (!current.current) return
        client.setQueryData(['my-order', userId, order.id], saved)
        setNotice(copy.confirmationSaved)
      } else if (action === 'capture') {
        await captureOrder(order.id, userId)
        if (!current.current) return
        setCaptureRequested(true)
        setNotice(copy.pending)
      } else {
        await reportOrderProblem(order.id, userId)
        if (!current.current) return
        setNotice(copy.reportSaved)
      }
      setDialog(null)
      await refresh()
    } catch (failure) {
      if (current.current) {
        setError(failure instanceof Error && /older request payment|administrator review/i.test(failure.message) ? copy.legacy : copy.actionError)
        await refresh()
      }
    } finally { inFlight.current = false; if (current.current) setBusy(false) }
  }
  async function review() {
    if (inFlight.current || stale || !order.actions.can_review || order.review) return
    const score = Number(rating)
    if (!Number.isInteger(score) || score < 1 || score > 5 || comment.trim().length > ORDER_REVIEW_MAX_LENGTH) { setError(copy.reviewInvalid); return }
    inFlight.current = true; setBusy(true); setError(''); setNotice('')
    try {
      await submitOrderReview(order.id, score, comment.trim(), userId)
      if (!current.current) return
      setShowReview(false); setComment(''); setRating(''); setNotice(copy.reviewSaved)
      await refresh()
    } catch {
      if (current.current) { setError(copy.actionError); await refresh() }
    } finally { inFlight.current = false; if (current.current) setBusy(false) }
  }
  const title = dialog === 'capture' ? pendingCapture ? copy.reconcileTitle : copy.captureTitle : dialog === 'complain' ? copy.reportTitle : order.my_role === 'buyer' ? copy.confirmBuyerTitle : copy.confirmSellerTitle
  const hint = dialog === 'capture' ? pendingCapture ? copy.reconcileHint : copy.captureHint : dialog === 'complain' ? copy.reportHint : order.my_role === 'buyer' ? copy.confirmBuyerHint : copy.confirmSellerHint
  const submitLabel = dialog === 'capture' ? pendingCapture ? copy.reconcile : copy.captureButton : dialog === 'complain' ? copy.report : copy.confirm

  return <>
    {!order.payments_enabled && <p className={styles.notice}>{copy.disabled}</p>}
    {order.role_review_required && <p className={styles.notice}>{copy.legacy}</p>}
    {pendingCapture && <p role="status" className={styles.notice}>{copy.pending}</p>}
    {notice && notice !== copy.pending && <p role="status" className={styles.success}>{notice}</p>}
    {error && !dialog && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.detailGrid}>
      <div className={styles.stack}>
        <section className={styles.panel}>
          <div className={styles.summary}><OrderThumbnail order={order} /><div className={styles.content}><div className={styles.topline}><h2>{order.listing.title}</h2><span className={styles.amount}>{orderMoney(order.amount, order.currency, locale)}</span></div><div className={styles.meta}><OrderStatus order={order} copy={copy} /><span>{order.my_role === 'buyer' ? copy.buying : copy.providing}</span></div></div></div>
          {order.status === 'requires_capture' && <p className={styles.notice}>{order.authorization_state === 'authorized' ? copy.authorizedHint : copy.unverifiedHint}</p>}
          <dl className={styles.facts}><div><dt>{copy.created}</dt><dd><time dateTime={order.created_at}>{orderDate(order.created_at, locale)}</time></dd></div><div><dt>{copy.fee}</dt><dd>{orderMoney(order.platform_fee, order.currency, locale)}</dd></div><div><dt>{copy.reference}</dt><dd>{order.id}</dd></div>{order.milestone && <div><dt>{copy.milestones}</dt><dd>{order.milestone.title} · {orderMoney(order.milestone.amount, order.currency, locale)}</dd></div>}</dl>
          {!order.listing.available && <p className={`${styles.muted} mt-5`}>{copy.unavailable}</p>}
          <div className={`${styles.actions} mt-5`}>{order.listing.available && <Button asChild variant="outline"><Link href={`/listings/${encodeURIComponent(order.listing.id)}`}>{copy.viewListing}</Link></Button>}{order.chat_id && <Button asChild variant="outline"><Link href={`/chat?chat=${encodeURIComponent(order.chat_id)}`}><MessageCircle size={15} aria-hidden="true" />{copy.chat}</Link></Button>}</div>
        </section>
        <section className={styles.panel} aria-labelledby="order-problems"><h2 id="order-problems" className={styles.sectionTitle}>{copy.complaintHeading}</h2>
          {order.complaint?.status === 'open' && <p className={styles.notice}>{copy.complaintOpen}</p>}
          {order.disputes.length ? <div className={styles.stack}>{order.disputes.map(dispute => <div key={dispute.id}><div className={styles.meta}><span>{dispute.is_bank_dispute ? copy.bankDispute : copy.complaint}</span><span className={styles.badge}>{disputeStatusLabel(dispute.status, copy)}</span><time dateTime={dispute.created_at}>{orderDate(dispute.created_at, locale)}</time></div></div>)}</div> : order.complaint ? <p className={styles.muted}>{copy.complaint}: {disputeStatusLabel(order.complaint.status, copy)}</p> : <p className={styles.muted}>{copy.noComplaint}</p>}
          {(order.refund.succeeded_amount > 0 || order.refund.pending_amount > 0) && <dl className={styles.facts}>{order.refund.succeeded_amount > 0 && <div><dt>{copy.refundedAmount}</dt><dd>{orderMoney(order.refund.succeeded_amount, order.currency, locale)}</dd></div>}{order.refund.pending_amount > 0 && <div><dt>{copy.refundPending}</dt><dd>{orderMoney(order.refund.pending_amount, order.currency, locale)}</dd></div>}</dl>}
          {order.refund.failed && <p className={styles.notice}>{copy.refundFailed}</p>}
          {order.actions.can_complain && <div className={`${styles.actions} mt-5`}><Button variant="outline" disabled={!allowed('complain')} onClick={() => open('complain')}>{copy.report}</Button></div>}
        </section>
        {(order.actions.can_review || order.review) && <section className={styles.panel} aria-labelledby="order-review"><h2 id="order-review" className={styles.sectionTitle}>{copy.reviewHeading}</h2>
          {order.review ? <p className={styles.person}><Star size={17} aria-hidden="true" />{copy.reviewed} {order.review.rating}/5</p> : showReview ? <form className={styles.reviewForm} onSubmit={event => { event.preventDefault(); void review() }}>
            <p className={styles.muted}>{copy.reviewHint}</p><div><label htmlFor="order-rating">{copy.rating}</label><select id="order-rating" className={styles.select} disabled={busy || stale} value={rating} onChange={event => setRating(event.target.value)}><option value="">{copy.chooseRating}</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}/5</option>)}</select></div>
            <div><label htmlFor="order-comment">{copy.comment}</label><Textarea id="order-comment" maxLength={ORDER_REVIEW_MAX_LENGTH} disabled={busy || stale} value={comment} onChange={event => setComment(event.target.value)} /></div><div className={styles.actions}><Button type="submit" disabled={busy || stale}>{busy ? copy.saving : copy.submitReview}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => { setShowReview(false); setError('') }}>{copy.cancel}</Button></div>
          </form> : <Button variant="outline" disabled={busy || stale} onClick={() => { setError(''); setShowReview(true) }}>{copy.review}</Button>}
        </section>}
      </div>
      <aside className={styles.stack}>
        <section className={styles.panel}><h2 className={styles.sectionTitle}>{order.my_role === 'buyer' ? copy.provider : copy.payer}</h2><OrderPerson person={other} copy={copy} /></section>
        <section className={styles.panel} aria-labelledby="order-confirmations"><h2 id="order-confirmations" className={styles.sectionTitle}>{copy.confirmations}</h2>
          {[{ label: copy.ownConfirmation, confirmed: ownConfirmed }, { label: copy.otherConfirmation, confirmed: otherConfirmed }].map(item => <div key={item.label} className={styles.confirmation} data-confirmed={item.confirmed}>{item.confirmed ? <CheckCircle2 size={19} aria-hidden="true" /> : <Circle size={19} aria-hidden="true" />}<div><p>{item.label}</p><small>{item.confirmed ? copy.confirmed : copy.waiting}</small></div></div>)}
          <div className={styles.actions}>{!ownConfirmed && order.status === 'requires_capture' && <Button disabled={!allowed('confirm')} onClick={() => open('confirm')}>{copy.confirm}</Button>}{order.status === 'requires_capture' && <Button variant={ownConfirmed ? 'default' : 'outline'} disabled={!allowed('capture')} onClick={() => open('capture')}>{pendingCapture ? copy.reconcile : copy.capture}</Button>}</div>
        </section>
      </aside>
    </div>
    <Dialog open={!!dialog} onOpenChange={open => { if (!open && !busy) { setDialog(null); setError('') } }}><DialogContent closeLabel={copy.cancel} closeDisabled={busy} className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl p-5 sm:p-6">
      <DialogHeader className="pr-9 text-left"><DialogTitle className="leading-6">{title}</DialogTitle><DialogDescription className="pt-2 leading-6">{hint}</DialogDescription></DialogHeader>
      <p className="break-words text-sm font-medium">{order.listing.title}</p>{dialog === 'capture' && <p className={styles.amount}>{orderMoney(order.amount, order.currency, locale)}</p>}
      {error && <p role="alert" className="text-sm leading-6 text-destructive">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" disabled={busy} onClick={() => { setDialog(null); setError('') }}>{copy.cancel}</Button><Button disabled={!dialog || !allowed(dialog)} onClick={() => { if (dialog) void act(dialog) }} className="h-auto min-h-11 whitespace-normal">{busy ? copy.saving : submitLabel}</Button></div>
    </DialogContent></Dialog>
  </>
}

export function OrderDetail({ id }: { id: string }) {
  const { user, isInitialized } = useAuth()
  const { locale } = useI18n()
  const copy = orderCopy[locale === 'el' ? 'el' : 'en']
  if (!isInitialized) return <p role="status" className={styles.loading}>{copy.loadingDetail}</p>
  if (!user) return <div className={styles.page}><p>{copy.signIn}</p><Button asChild className="mt-4"><Link href={`/login?redirectTo=${encodeURIComponent(`/dashboard/orders/${id}`)}`}>{copy.login}</Link></Button></div>
  return <AccountOrder key={`${user.id}:${id}`} id={id} userId={user.id} />
}
