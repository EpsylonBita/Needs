'use client'

import { useEffect, useState } from 'react'
import type { OrderDTO } from '@/lib/orders/types'
import { orderCopy } from './order-copy'
import styles from './orders.module.css'

export function useAuthorizationDeadline(value: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now())
  const deadline = value ? Date.parse(value) : Number.NaN
  useEffect(() => {
    if (!Number.isFinite(deadline)) return
    const update = () => setNow(Date.now())
    const timer = window.setInterval(update, 1000)
    window.addEventListener('focus', update)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update) }
  }, [deadline])
  return { deadline, remaining: deadline - now, expired: Number.isFinite(deadline) && deadline <= now }
}

export function OrderAuthorization({ order, locale, compact = false }: { order: OrderDTO; locale: string; compact?: boolean }) {
  const copy = orderCopy[locale === 'el' ? 'el' : 'en']
  const { deadline, remaining, expired } = useAuthorizationDeadline(order.authorization?.expires_at)
  if (order.stripe_canceled_at) return <p className={styles.notice}>{compact ? copy.released : copy.releasedHint}</p>
  if (!['requires_capture', 'requires_payment_method'].includes(order.status)) return null
  const exact = (value: string) => new Intl.DateTimeFormat(locale === 'el' ? 'el-GR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'long' }).format(new Date(value))
  const totalMinutes = Math.max(0, Math.ceil(remaining / 60000))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor(totalMinutes % 1440 / 60)
  const minutes = totalMinutes % 60
  const countdown = [days ? `${days} ${copy.dayShort}` : '', hours ? `${hours} ${copy.hourShort}` : '', `${minutes} ${copy.minuteShort}`].filter(Boolean).join(' ')
  return <div className={styles.notice}>
    {Number.isFinite(deadline) ? <>
      <p>{copy.expires}: <time dateTime={order.authorization.expires_at!}>{exact(order.authorization.expires_at!)}</time></p>
      {expired ? <p role="status" className="font-medium">{copy.authorizationExpired}. {copy.expiredHint}</p> : <>
        <p>{copy.timeLeft}: {countdown}</p>
        {remaining < 3600000 ? <p role="status" className="font-medium text-destructive">{copy.expiresHour}</p> : remaining < 86400000 && <p role="status" className="font-medium">{copy.expiresDay}</p>}
        {!compact && <p>{copy.noAutoCharge}</p>}
      </>}
    </> : <p>{copy.deadlineUnknown}</p>}
    {!compact && order.authorization?.attention_required && !expired && <p>{copy.attention}</p>}
    {!compact && order.authorization?.last_checked_at && <p>{copy.checked}: <time dateTime={order.authorization.last_checked_at}>{exact(order.authorization.last_checked_at)}</time></p>}
  </div>
}
