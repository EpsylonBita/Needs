'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpRight, RefreshCw, ShoppingBag } from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { useI18n } from '@/contexts/i18n-context'
import { Button } from '@/components/ui/button'
import { getMyOrders, type OrderCursor } from '@/lib/services/order-service'
import { orderCopy, orderDate, orderMoney } from './order-copy'
import { OrderPerson, OrderStatus, OrderThumbnail } from './order-parts'
import styles from './orders.module.css'

function AccountOrders({ userId }: { userId: string }) {
  const { locale } = useI18n()
  const copy = orderCopy[locale === 'el' ? 'el' : 'en']
  const [role, setRole] = useState<'all' | 'buyer' | 'seller'>('all')
  const [status, setStatus] = useState('all')
  const query = useInfiniteQuery({
    queryKey: ['my-orders', userId], initialPageParam: null as OrderCursor | null,
    queryFn: ({ pageParam, signal }) => getMyOrders(userId, pageParam, signal),
    getNextPageParam: last => last.next_cursor || undefined, retry: false,
  })
  const rows = [...new Map((query.data?.pages.flatMap(page => page.rows) || []).map(order => [order.id, order])).values()]
  const filtered = rows.filter(order => (role === 'all' || order.my_role === role) && (status === 'all' || order.status === status))
  const hasData = !!query.data
  const paymentsEnabled = query.data?.pages[0]?.payments_enabled
  return <div className={styles.page}>
    <Link href="/profile" className={styles.back}><ArrowLeft size={15} aria-hidden="true" />{copy.back}</Link>
    <header className={styles.heading}><div><h1>{copy.title}</h1><p>{copy.subtitle}</p></div><Button variant="outline" disabled={query.isFetching} aria-label={copy.refresh} onClick={() => { void query.refetch() }}><RefreshCw size={16} className={query.isFetching ? 'animate-spin' : ''} aria-hidden="true" /></Button></header>
    <div className={styles.filters}>
      <div className={styles.roles} role="group" aria-label={copy.filter}>{(['all', 'buyer', 'seller'] as const).map(value => <button key={value} type="button" className={styles.filter} aria-pressed={role === value} onClick={() => setRole(value)}>{copy[value]}</button>)}</div>
      <select aria-label={copy.statusFilter} value={status} onChange={event => setStatus(event.target.value)} className={styles.select}>
        <option value="all">{copy.anyStatus}</option>{(['requires_payment_method', 'requires_capture', 'completed', 'failed', 'refunded', 'disputed'] as const).map(value => <option value={value} key={value}>{copy[value]}</option>)}
      </select>
    </div>
    {hasData && !paymentsEnabled && <p className={styles.notice}>{copy.disabled}</p>}
    {query.isError && <div role="alert" className={styles.error}><p>{hasData ? query.isFetchNextPageError ? copy.moreError : copy.stale : copy.loadError}</p><Button variant="outline" disabled={query.isFetching} onClick={() => { void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch()) }}>{copy.retry}</Button></div>}
    {query.isPending ? <p role="status" className={styles.loading}>{copy.loading}</p> : hasData && <>
      {!filtered.length && <div className={styles.empty}><ShoppingBag size={32} aria-hidden="true" /><h2>{rows.length ? copy.noResults : copy.empty}</h2>{!rows.length && <><p className={styles.muted}>{copy.emptyHint}</p><Button asChild variant="outline"><Link href="/search">{copy.browse}</Link></Button></>}</div>}
      <div className={styles.cards}>{filtered.map(order => {
        const path = `/dashboard/orders/${encodeURIComponent(order.id)}`
        const other = order.my_role === 'buyer' ? order.seller : order.buyer
        return <article key={order.id} className={styles.card} aria-labelledby={`order-${order.id}`}>
          <div className={styles.summary}><OrderThumbnail order={order} /><div className={styles.content}>
            <div className={styles.topline}><h2 id={`order-${order.id}`}><Link href={path}>{order.listing.title}</Link></h2><span className={styles.amount}>{orderMoney(order.amount, order.currency, locale)}</span></div>
            <div className={styles.meta}><OrderStatus order={order} copy={copy} /><span>{order.my_role === 'buyer' ? copy.buying : copy.providing}</span><time dateTime={order.created_at}>{orderDate(order.created_at, locale)}</time></div>
            {order.milestone && <p className={`${styles.muted} mt-2`}>{copy.milestones}: {order.milestone.title}</p>}
          </div></div>
          {order.role_review_required && <p className={styles.notice}>{copy.legacy}</p>}
          <div className={styles.cardFooter}><OrderPerson person={other} copy={copy} /><div className={styles.actions}><Button asChild variant="outline"><Link href={path}>{copy.view}<ArrowUpRight size={15} aria-hidden="true" /></Link></Button></div></div>
        </article>
      })}</div>
      {query.hasNextPage && <div className={styles.more}><p className={styles.muted}>{copy.loadedHint}</p><Button variant="outline" disabled={query.isFetching} onClick={() => { void query.fetchNextPage() }}>{query.isFetchingNextPage ? copy.loadingMore : copy.more}</Button></div>}
    </>}
  </div>
}

export function OrdersList() {
  const { user, isInitialized } = useAuth()
  const { locale } = useI18n()
  const copy = orderCopy[locale === 'el' ? 'el' : 'en']
  if (!isInitialized) return <p role="status" className={styles.loading}>{copy.loading}</p>
  if (!user) return <div className={styles.page}><p>{copy.signIn}</p><Button asChild className="mt-4"><Link href="/login?redirectTo=%2Fdashboard%2Forders">{copy.login}</Link></Button></div>
  return <AccountOrders key={user.id} userId={user.id} />
}
