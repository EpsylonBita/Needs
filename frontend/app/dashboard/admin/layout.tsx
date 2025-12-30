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
    <div className="flex min-h-screen">
      <aside className="w-56 border-r p-4 space-y-2">
        <div className="text-lg font-bold">{t('admin.title','Admin')}</div>
        <nav className="flex flex-col gap-2">
          <Link href="/dashboard/admin/overview" className="px-2 py-1 rounded hover:bg-gray-100">{t('admin.overview','Overview')}</Link>
          <Link href="/dashboard/admin/payments" className="px-2 py-1 rounded hover:bg-gray-100">{t('admin.payments','Payments')}</Link>
          <Link href="/dashboard/admin/disputes" className="px-2 py-1 rounded hover:bg-gray-100">{t('admin.disputes','Disputes')}</Link>
          <Link href="/dashboard/admin/listings" className="px-2 py-1 rounded hover:bg-gray-100">{t('admin.listings','Listings')}</Link>
          <Link href="/dashboard/admin/users" className="px-2 py-1 rounded hover:bg-gray-100">{t('admin.users','Users')}</Link>
          <Link href="/dashboard/admin/notifications" className="px-2 py-1 rounded hover:bg-gray-100">{t('admin.notifications','Notifications')}</Link>
          <Link href="/dashboard/admin/milestones" className="px-2 py-1 rounded hover:bg-gray-100">{t('admin.milestones','Milestones')}</Link>
          <Link href="/dashboard/admin/status" className="px-2 py-1 rounded hover:bg-gray-100">{t('admin.status','Status')}</Link>
          <Link href="/dashboard/admin/logs" className="px-2 py-1 rounded hover:bg-gray-100">{t('admin.logs','Audit Logs')}</Link>
          <Link href="/dashboard/admin/settings" className="px-2 py-1 rounded hover:bg-gray-100">{t('admin.settings','Settings')}</Link>
        </nav>
      </aside>
      <main className="flex-1 p-4">{children}</main>
    </div>
  )
}
