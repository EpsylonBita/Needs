'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Package, UserRound } from 'lucide-react'
import type { OrderDTO, OrderParty } from '@/lib/orders/types'
import { paymentStatusLabel, type OrderCopy } from './order-copy'
import { useAuthorizationDeadline } from './order-authorization'
import styles from './orders.module.css'

export function OrderThumbnail({ order }: { order: OrderDTO }) {
  return <div className={styles.thumbnail}>{order.listing.thumbnail
    ? <Image src={order.listing.thumbnail} alt="" width={184} height={184} unoptimized />
    : <Package size={26} aria-hidden="true" />}</div>
}
export function OrderPerson({ person, copy, link = true }: { person: OrderParty; copy: OrderCopy; link?: boolean }) {
  const content = <>{person.avatar_url ? <Image src={person.avatar_url} alt="" width={32} height={32} unoptimized /> : <span className={styles.avatar}><UserRound size={16} aria-hidden="true" /></span>}<span>{person.display_name || copy.member}</span></>
  return link ? <Link href={`/profile/${encodeURIComponent(person.id)}`} className={styles.person}>{content}</Link> : <div className={styles.person}>{content}</div>
}
export function OrderStatus({ order, copy }: { order: OrderDTO; copy: OrderCopy }) {
  const { expired } = useAuthorizationDeadline(order.authorization?.expires_at)
  const label = expired && order.status === 'requires_capture' && !order.stripe_canceled_at && !order.capture_pending && !order.cancel_pending ? copy.authorizationExpired : paymentStatusLabel(order, copy)
  return <span className={styles.badge} data-status={order.status}>{label}</span>
}
