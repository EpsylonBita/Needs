"use client";

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'

type Dispute = { id: string; status: string; reason: string | null; payment_id: string }

export default function AdminDisputesPage() {
  const [rows, setRows] = useState<Dispute[]>([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all'|'open'|'resolved'|'refunded'|'rejected'>('all')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    const run = async () => {
      const res = await fetch(`/api/admin/disputes/list?status=${statusFilter}&limit=20&offset=${page*20}`)
      const json = await res.json()
      setRows(json.rows || [])
      setTotal(json.total || 0)
    }
    run()
    const ch = supabase.channel('admin-disputes').on('postgres_changes', { event: '*', schema: 'public', table: 'disputes' }, run).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [statusFilter, page])

  const resolve = async (id: string) => {
    setLoading(true)
    const t = await fetch('/api/csrf').then(r => r.json()).then(j => j.csrfToken)
    const s = await supabase.auth.getSession()
    const at = s.data.session?.access_token || ''
    await fetch(`/api/payments/disputes/${id}/resolve`, { method: 'POST', headers: { 'X-CSRF-Token': t, ...(at ? { Authorization: `Bearer ${at}` } : {}) } })
    const { data } = await supabase.from('disputes').select('id,status,reason,payment_id').eq('id', id).single()
    if (data) setRows(prev => prev.map(r => r.id===id ? data as any : r))
    setLoading(false)
  }

  const refund = async (id: string) => {
    setLoading(true)
    const t = await fetch('/api/csrf').then(r => r.json()).then(j => j.csrfToken)
    const s = await supabase.auth.getSession()
    const at = s.data.session?.access_token || ''
    await fetch(`/api/payments/disputes/${id}/refund`, { method: 'POST', headers: { 'X-CSRF-Token': t, ...(at ? { Authorization: `Bearer ${at}` } : {}) } })
    const { data } = await supabase.from('disputes').select('id,status,reason,payment_id').eq('id', id).single()
    if (data) setRows(prev => prev.map(r => r.id===id ? data as any : r))
    setLoading(false)
  }

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold">Disputes</h1>
      <div className="mt-2 flex items-center gap-2">
        <select value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value as any)} className="border rounded-md p-2">
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="refunded">Refunded</option>
          <option value="rejected">Rejected</option>
        </select>
        <a href={`/api/admin/disputes/export?status=${statusFilter}`} className="px-3 py-1 rounded-md bg-gray-100">Export CSV</a>
      </div>
      <div className="mt-4 border rounded-md">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left"><th className="p-2">ID</th><th className="p-2">Status</th><th className="p-2">Reason</th><th className="p-2">Actions</th></tr>
          </thead>
          <tbody>
            {rows.map((d)=>(
              <tr key={d.id} className="border-t">
                <td className="p-2">{d.id}</td>
                <td className="p-2">{d.status}</td>
                <td className="p-2">{d.reason || ''}</td>
                <td className="p-2 space-x-2">
                  <button disabled={loading} onClick={()=>resolve(d.id)} className="px-3 py-1 rounded-md bg-green-600 text-white">Resolve</button>
                  <button disabled={loading} onClick={()=>refund(d.id)} className="px-3 py-1 rounded-md bg-red-600 text-white">Refund</button>
                </td>
              </tr>
            ))}
            {rows.length===0 && (<tr><td className="p-2" colSpan={4}>No disputes</td></tr>)}
          </tbody>
        </table>
        <div className="p-2 flex items-center gap-2">
          <button disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))} className="px-3 py-1 rounded-md bg-gray-200">Prev</button>
          <span className="text-sm">Page {page+1} / {Math.max(1, Math.ceil(total/20))}</span>
          <button disabled={(page+1)>=Math.ceil(total/20)} onClick={()=>setPage(p=>p+1)} className="px-3 py-1 rounded-md bg-gray-200">Next</button>
        </div>
      </div>
    </div>
  )
}