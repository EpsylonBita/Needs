"use client";

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/contexts/i18n-context'
import { supabase } from '@/lib/supabase/client'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { t } = useI18n()
  useEffect(() => {
    const run = async () => {
      const s = await supabase.auth.getSession()
      const at = s.data.session?.access_token || ''
      const res = await fetch('/api/admin/check', { headers: { ...(at ? { Authorization: `Bearer ${at}` } : {}) } })
      if (!res.ok) router.push('/dashboard')
    }
    run()
  }, [router])
  return (
    <div className="flex min-h-screen min-w-0 w-full flex-col md:flex-row">
      <aside className="w-full min-w-0 shrink-0 border-b bg-card text-card-foreground p-4 space-y-2 md:w-56 md:border-b-0 md:border-r">
        <div className="text-lg font-bold">{t('admin.title','Admin')}</div>
        <nav className="flex flex-wrap gap-2 md:flex-col">
          <Link href="/dashboard/admin/overview" className="px-2 py-1 rounded hover:bg-accent hover:text-accent-foreground">{t('admin.overview','Overview')}</Link>
          <Link href="/dashboard/payments/admin" className="px-2 py-1 rounded hover:bg-accent hover:text-accent-foreground">{t('admin.payments','Payments')}</Link>
          <Link href="/dashboard/admin/disputes" className="px-2 py-1 rounded hover:bg-accent hover:text-accent-foreground">{t('admin.disputes','Disputes')}</Link>
          <Link href="/dashboard/admin/listings" className="px-2 py-1 rounded hover:bg-accent hover:text-accent-foreground">{t('admin.listings','Listings')}</Link>
          <Link href="/dashboard/admin/users" className="px-2 py-1 rounded hover:bg-accent hover:text-accent-foreground">{t('admin.users','Users')}</Link>
          <Link href="/dashboard/admin/account-requests" className="px-2 py-1 rounded hover:bg-accent hover:text-accent-foreground">{t('admin.accountRequests','Account requests')}</Link>
          <Link href="/dashboard/admin/notifications" className="px-2 py-1 rounded hover:bg-accent hover:text-accent-foreground">{t('admin.notifications','Notifications')}</Link>
          <Link href="/dashboard/admin/milestones" className="px-2 py-1 rounded hover:bg-accent hover:text-accent-foreground">{t('admin.milestones','Milestones')}</Link>
          <Link href="/dashboard/admin/status" className="px-2 py-1 rounded hover:bg-accent hover:text-accent-foreground">{t('admin.status','Status')}</Link>
          <Link href="/dashboard/admin/logs" className="px-2 py-1 rounded hover:bg-accent hover:text-accent-foreground">{t('admin.logs','Audit Logs')}</Link>
          <Link href="/dashboard/admin/settings" className="px-2 py-1 rounded hover:bg-accent hover:text-accent-foreground">{t('admin.settings','Settings')}</Link>
        </nav>
      </aside>
      <main className="min-w-0 w-full flex-1 p-3 sm:p-4">{children}</main>
    </div>
  )
}
