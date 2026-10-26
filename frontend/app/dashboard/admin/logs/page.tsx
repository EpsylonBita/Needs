"use client";

import { useEffect, useState } from 'react'

import { useRouter } from 'next/navigation'
 
import { adminRequest } from '../admin-request'

type LogRow = { id: string; admin_email: string; listing_id: string; action: string; created_at: string }

export default function AdminModerationLogsPage() {
  const [rows, setRows] = useState<LogRow[]>([])
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const router = useRouter()

  useEffect(() => {
    const run = async () => {
      try {
        const data = await adminRequest<{ logs: LogRow[] }>('/api/admin/logs')
        setAllowed(true)
        setRows(data.logs)
      } catch (cause) {
        if ((cause as { status?: number }).status === 403) { setAllowed(false); router.push('/dashboard'); return }
        setError(cause instanceof Error ? cause.message : 'Unable to load moderation logs')
      }
    }
    run()
  }, [router])

  return (
    <div className="container mx-auto p-4 pt-[72px]">
      <h1 className="text-2xl font-bold">Moderation Audit Logs</h1>
      {allowed === false && (<div className="mt-2">Forbidden</div>)}
      {error && <div role="alert" className="mt-2 text-red-600">{error}</div>}
      <div className="mt-4 border rounded-md">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="p-2">When</th>
              <th className="p-2">Admin</th>
              <th className="p-2">Listing</th>
              <th className="p-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-2">{new Date(l.created_at).toLocaleString()}</td>
                <td className="p-2">{l.admin_email}</td>
                <td className="p-2">{l.listing_id}</td>
                <td className="p-2">{l.action}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td className="p-2" colSpan={4}>No logs</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
