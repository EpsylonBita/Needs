'use client'

import Link from 'next/link'
import { ArrowLeft, ArrowUpRight, Bell, Check, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/contexts/i18n-context'
import { notificationCopy } from '@/lib/notifications/copy'
import { formatNotification } from '@/lib/notifications/format-notification'
import { useNotifications } from '@/lib/notifications/use-notifications'

export default function NotificationsPage() {
  const { locale, formatDate } = useI18n()
  const copy = notificationCopy[locale === 'el' ? 'el' : 'en']
  const notifications = useNotifications()
  const loading = !notifications.authReady || (notifications.signedIn && !notifications.hasData && notifications.isPending)

  return <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-24 sm:px-6">
    <Link href="/profile" className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />{copy.back}
    </Link>
    <header className="mt-5 flex flex-wrap items-start justify-between gap-4 border-b pb-6">
      <div><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{copy.title}</h1><p className="mt-2 text-sm text-muted-foreground sm:text-base">{copy.subtitle}</p></div>
      <Button variant="outline" onClick={() => { void notifications.refetch() }} disabled={!notifications.authReady || !notifications.signedIn || notifications.isFetching}>
        <RefreshCw className={`h-4 w-4 ${notifications.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />{copy.refresh}
      </Button>
    </header>
    {loading && <p role="status" className="py-12 text-sm text-muted-foreground">{copy.loading}</p>}
    {notifications.authReady && !notifications.signedIn && <p className="py-12 text-muted-foreground">{copy.signIn}</p>}
    {notifications.isError && <div role="alert" className="my-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-4">
      <p className="text-sm">{copy.error}</p><Button variant="outline" disabled={notifications.isFetching} onClick={() => {
        if (notifications.isFetchNextPageError) void notifications.fetchNextPage()
        else void notifications.refetch()
      }}>{copy.retry}</Button>
    </div>}
    {notifications.updateError && <p role="alert" className="my-4 text-sm text-destructive">{copy.updateError}</p>}
    {notifications.hasData && notifications.rows.length === 0 && !notifications.isError && <div className="flex flex-col items-center px-4 py-16 text-center">
      <Bell className="mb-5 h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-lg font-medium">{copy.empty}</h2><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{copy.emptyHint}</p>
    </div>}
    {notifications.rows.length > 0 && <ul className="divide-y">
      {notifications.rows.map(notification => {
        const content = formatNotification(notification, locale)
        return <li key={notification.id} className="flex gap-4 py-6">
          <div className="pt-1"><span className={`block h-2 w-2 rounded-full ${notification.read ? 'bg-muted' : 'bg-primary'}`} aria-hidden="true" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className={`text-base ${notification.read ? 'font-medium' : 'font-semibold'}`}>{content.title}</h2>
              <time dateTime={notification.created_at} className="text-xs text-muted-foreground">{formatDate(notification.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</time>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{content.description}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
              <span className={`text-xs ${notification.read ? 'text-muted-foreground' : 'font-medium text-primary'}`}>{notification.read ? copy.read : copy.unread}</span>
              {content.href && <Link href={content.href} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline">{content.linkLabel}<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link>}
              {!notification.read && <Button variant="ghost" size="sm" className="sm:ml-auto" disabled={!!notifications.updatingId} onClick={() => notifications.markRead(notification.id)}>
                <Check className="h-4 w-4" aria-hidden="true" />{notifications.updatingId === notification.id ? copy.saving : copy.markRead}
              </Button>}
            </div>
          </div>
        </li>
      })}
    </ul>}
    {notifications.hasNextPage && <div className="flex justify-center border-t py-6"><Button variant="outline" disabled={notifications.isFetching} onClick={() => { void notifications.fetchNextPage() }}>{notifications.isFetchingNextPage ? copy.loading : copy.more}</Button></div>}
    {notifications.hasData && <p role={notifications.isRefetching ? 'status' : undefined} className="mt-6 text-center text-xs text-muted-foreground">{notifications.isRefetching ? copy.refreshing : copy.autoRefresh}</p>}
  </div>
}
