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
import { getMyOrder, confirmOrder, captureOrder, reconcileOrder, changeOrderCancellation, reportOrderProblem, submitOrderReview, ORDER_REVIEW_MAX_LENGTH, type OrderDTO } from '@/lib/services/order-service'
import { cancellationStatusLabel, disputeStatusLabel, orderCopy, orderDate, orderMoney } from './order-copy'
import { OrderPerson, OrderStatus, OrderThumbnail } from './order-parts'
import { OrderAuthorization, useAuthorizationDeadline } from './order-authorization'
import styles from './orders.module.css'

type CancellationAction = 'request' | 'accept' | 'reject' | 'withdraw'
type Action = 'confirm' | 'capture' | 'complain' | CancellationAction

function AccountOrder({ id, userId }: { id: string; userId: string }) {
  const { locale } = useI18n()
  const copy = orderCopy[locale === 'el' ? 'el' : 'en']
  const client = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const request = useRef<AbortController | null>(null)
  useLayoutEffect(() => () => request.current?.abort(), [])
  const query = useQuery({ queryKey: ['my-order', userId, id], queryFn: ({ signal }) => getMyOrder(id, userId, signal), retry: false })
  async function refreshStatus() {
    if (request.current && !request.current.signal.aborted) return
    const controller = new AbortController(); request.current = controller
    setRefreshing(true); setRefreshError(false)
    try {
      const saved = await reconcileOrder(id, userId, controller.signal)
      if (controller.signal.aborted) return
      client.setQueryData(['my-order', userId, id], saved)
      await client.invalidateQueries({ queryKey: ['my-orders', userId] })
    } catch { if (!controller.signal.aborted) setRefreshError(true) }
    finally { if (!controller.signal.aborted) { setRefreshing(false); request.current = null } }
  }
  return <div className={styles.page}>
    <Link href="/dashboard/orders" className={styles.back}><ArrowLeft size={15} aria-hidden="true" />{copy.allOrders}</Link>
    <header className={styles.heading}><div><h1>{copy.detail}</h1></div><Button variant="outline" disabled={query.isFetching || refreshing || actionBusy || (query.data && !query.data.actions.can_reconcile)} aria-label={copy.refresh} onClick={() => { void refreshStatus() }}><RefreshCw size={16} className={query.isFetching || refreshing ? 'animate-spin' : ''} aria-hidden="true" /></Button></header>
    {refreshError && <p role="alert" className={styles.error}>{copy.refreshFailed}</p>}
    {query.isError && <div role="alert" className={styles.error}><p>{query.data ? copy.stale : copy.detailError}</p><Button variant="outline" disabled={query.isFetching || refreshing || actionBusy} onClick={() => { void (query.data?.actions.can_reconcile ? refreshStatus() : query.refetch()) }}>{copy.retry}</Button></div>}
    {query.isPending ? <p role="status" className={styles.loading}>{copy.loadingDetail}</p> : query.data && <OrderContents order={query.data} userId={userId} stale={query.isError || refreshError || refreshing} onBusyChange={setActionBusy} />}
  </div>
}

function OrderContents({ order, userId, stale, onBusyChange }: { order: OrderDTO; userId: string; stale: boolean; onBusyChange: (busy: boolean) => void }) {
  const { locale } = useI18n()
  const copy = orderCopy[locale === 'el' ? 'el' : 'en']
  const client = useQueryClient()
  const current = useRef(false)
  const inFlight = useRef(false)
  const [busy, setBusyState] = useState(false)
  const setBusy = (value: boolean) => { setBusyState(value); onBusyChange(value) }
  const [dialog, setDialog] = useState<Action | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [captureRequested, setCaptureRequested] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const [rating, setRating] = useState('')
  const [comment, setComment] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [expectedCancellationId, setExpectedCancellationId] = useState<string | null>(null)
  const { expired } = useAuthorizationDeadline(order.authorization?.expires_at)
  useLayoutEffect(() => { current.current = true; return () => { current.current = false } }, [])
  const other = order.my_role === 'buyer' ? order.seller : order.buyer
  const ownConfirmed = order.my_role === 'buyer' ? order.buyer_confirmed : order.seller_confirmed
  const otherConfirmed = order.my_role === 'buyer' ? order.seller_confirmed : order.buyer_confirmed
  const pendingCapture = !order.stripe_canceled_at && (order.capture_pending || (captureRequested && !['completed', 'refunded', 'failed', 'disputed'].includes(order.status)))
  const cancellationOpen = order.cancel_pending || ['proposed', 'accepted'].includes(order.cancellation?.status || '')
  const moneyEnabled = order.payments_enabled && !order.role_review_required
  const allowed = (action: Action) => !busy && !stale && (action === 'confirm'
    ? moneyEnabled && !expired && !cancellationOpen && !order.stripe_canceled_at && !pendingCapture && order.actions.can_confirm && !ownConfirmed
    : action === 'capture' ? moneyEnabled && !expired && !cancellationOpen && !order.stripe_canceled_at && order.actions.can_capture && ownConfirmed && otherConfirmed
      : action === 'complain' ? order.actions.can_complain
        : !order.cancel_pending && !pendingCapture && !!({ request: order.actions.can_request_cancel, accept: order.actions.can_accept_cancel, reject: order.actions.can_reject_cancel, withdraw: order.actions.can_withdraw_cancel }[action]))

  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['my-order', userId, order.id] }),
      client.invalidateQueries({ queryKey: ['my-orders', userId] }),
      client.invalidateQueries({ queryKey: ['profile-overview', userId] }),
    ])
  }
  function open(action: Action) {
    if (!allowed(action)) return
    setError(''); setNotice(''); setExpectedCancellationId(order.cancellation?.id || null); setDialog(action)
  }
  async function act(action: Action) {
    if (inFlight.current || !allowed(action)) return
    if (action === 'request' && (cancelReason.trim().length < 5 || cancelReason.trim().length > 1000)) { setError(copy.cancelReasonInvalid); return }
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
      } else if (action === 'complain') {
        await reportOrderProblem(order.id, userId)
        if (!current.current) return
        setNotice(copy.reportSaved)
      } else {
        const saved = await changeOrderCancellation(order.id, { action, expectedCancellationId, ...(action === 'request' ? { reason: cancelReason.trim() } : {}) }, userId)
        if (!current.current) return
        client.setQueryData(['my-order', userId, order.id], saved)
        setCancelReason('')
        setNotice(saved.cancel_pending ? copy.cancelPending : copy.cancelSaved)
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
  const cancellationDialog = dialog && ['request', 'accept', 'reject', 'withdraw'].includes(dialog) ? dialog as CancellationAction : null
  const cancellationLabels = { request: [copy.requestCancelTitle, copy.requestCancelHint, copy.requestCancel], accept: [copy.acceptCancelTitle, copy.acceptCancelHint, copy.acceptCancel], reject: [copy.rejectCancelTitle, copy.rejectCancelHint, copy.rejectCancel], withdraw: [copy.withdrawCancelTitle, copy.withdrawCancelHint, copy.withdrawCancel] }
  const title = cancellationDialog ? cancellationLabels[cancellationDialog][0] : dialog === 'capture' ? pendingCapture ? copy.reconcileTitle : copy.captureTitle : dialog === 'complain' ? copy.reportTitle : order.my_role === 'buyer' ? copy.confirmBuyerTitle : copy.confirmSellerTitle
  const hint = cancellationDialog ? cancellationLabels[cancellationDialog][1] : dialog === 'capture' ? pendingCapture ? copy.reconcileHint : copy.captureHint : dialog === 'complain' ? copy.reportHint : order.my_role === 'buyer' ? copy.confirmBuyerHint : copy.confirmSellerHint
  const submitLabel = cancellationDialog ? cancellationLabels[cancellationDialog][2] : dialog === 'capture' ? pendingCapture ? copy.reconcile : copy.captureButton : dialog === 'complain' ? copy.report : copy.confirm

  return <>
    {!order.payments_enabled && <p className={styles.notice}>{copy.disabled}</p>}
    {order.role_review_required && <p className={styles.notice}>{copy.legacy}</p>}
    {pendingCapture && <p role="status" className={styles.notice}>{copy.pending}</p>}
    {order.cancel_pending && <p role="status" className={styles.notice}>{copy.cancelPending}</p>}
    {notice && notice !== copy.pending && notice !== copy.cancelPending && <p role="status" className={styles.success}>{notice}</p>}
    {error && !dialog && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.detailGrid}>
      <div className={styles.stack}>
        <section className={styles.panel}>
          <div className={styles.summary}><OrderThumbnail order={order} /><div className={styles.content}><div className={styles.topline}><h2>{order.listing.title}</h2><span className={styles.amount}>{orderMoney(order.amount, order.currency, locale)}</span></div><div className={styles.meta}><OrderStatus order={order} copy={copy} /><span>{order.my_role === 'buyer' ? copy.buying : copy.providing}</span></div></div></div>
          {order.status === 'requires_capture' && !order.stripe_canceled_at && !expired && <p className={styles.notice}>{order.authorization_state === 'authorized' ? copy.authorizedHint : copy.unverifiedHint}</p>}
          <OrderAuthorization order={order} locale={locale} />
          <dl className={styles.facts}><div><dt>{copy.created}</dt><dd><time dateTime={order.created_at}>{orderDate(order.created_at, locale)}</time></dd></div><div><dt>{copy.fee}</dt><dd>{orderMoney(order.platform_fee, order.currency, locale)}</dd></div><div><dt>{copy.reference}</dt><dd>{order.id}</dd></div>{order.milestone && <div><dt>{copy.milestones}</dt><dd>{order.milestone.title} · {orderMoney(order.milestone.amount, order.currency, locale)}</dd></div>}</dl>
          {!order.listing.available && <p className={`${styles.muted} mt-5`}>{copy.unavailable}</p>}
          <div className={`${styles.actions} mt-5`}>{order.listing.available && <Button asChild variant="outline"><Link href={`/listings/${encodeURIComponent(order.listing.id)}`}>{copy.viewListing}</Link></Button>}{order.chat_id && <Button asChild variant="outline"><Link href={`/chat?chat=${encodeURIComponent(order.chat_id)}`}><MessageCircle size={15} aria-hidden="true" />{copy.chat}</Link></Button>}</div>
        </section>
        {(order.cancellation || order.cancel_pending || order.actions.can_request_cancel) && <section className={styles.panel} aria-labelledby="order-cancellation"><h2 id="order-cancellation" className={styles.sectionTitle}>{copy.cancelHeading}</h2>
          {order.cancellation && <div className="space-y-2 text-sm"><p className="font-medium">{cancellationStatusLabel(order.cancellation.status, copy)}</p><p className="whitespace-pre-wrap break-words">{order.cancellation.reason}</p>{order.cancellation.status === 'proposed' && <p className={styles.muted}>{order.cancellation.requested_by === order[order.my_role].id ? copy.waitingCancellation : copy.reviewCancellation}</p>}</div>}
          <div className={`${styles.actions} mt-4`}>{(['request', 'accept', 'reject', 'withdraw'] as const).map(action => ({ request: order.actions.can_request_cancel, accept: order.actions.can_accept_cancel, reject: order.actions.can_reject_cancel, withdraw: order.actions.can_withdraw_cancel }[action]) && <Button key={action} variant="outline" disabled={!allowed(action)} onClick={() => open(action)}>{cancellationLabels[action][2]}</Button>)}</div>
        </section>}
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
      {dialog === 'request' && <div className="space-y-2"><label htmlFor="cancel-order-reason" className="text-sm font-medium">{copy.cancelReason}</label><Textarea id="cancel-order-reason" value={cancelReason} onChange={event => setCancelReason(event.target.value)} maxLength={1000} disabled={busy} /></div>}
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
