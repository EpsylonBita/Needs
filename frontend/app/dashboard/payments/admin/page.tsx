"use client";

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'

import { supabase } from '@/lib/supabase/client'

type Dispute = { id: string; status: string; reason: string | null; payment_id: string }

export default function PaymentsAdminPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [loading, setLoading] = useState(false)
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [revenue, setRevenue] = useState<{ totalFee: number; totalVolume: number } | null>(null)
  const router = useRouter()
  const [yearFilter, setYearFilter] = useState<number | 'all'>('all')
  const [showVolume, setShowVolume] = useState(true)
  const [showFee, setShowFee] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all'|'requires_capture'|'completed'|'refunded'|'failed'>('all')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [rows, setRows] = useState<any[]>([])

  useEffect(() => {
    const run = async () => {
      const s = await supabase.auth.getSession()
      const at = s.data.session?.access_token || ''
      const chk = await fetch('/api/admin/check', { headers: { ...(at ? { Authorization: `Bearer ${at}` } : {}) } })
      if (!chk.ok) {
        setAllowed(false)
        router.push('/dashboard')
        return
      }
      setAllowed(true)
      const d = await supabase.from('disputes').select('id,status,reason,payment_id').order('created_at', { ascending: false })
      setDisputes((d.data || []) as Dispute[])
      const p = await supabase.from('payments').select('amount,platform_fee')
      const rows = (p.data || []) as any[]
      const totalFee = rows.reduce((acc, r) => acc + Number(r.platform_fee || 0), 0)
      const totalVolume = rows.reduce((acc, r) => acc + Number(r.amount || 0), 0)
      setRevenue({ totalFee, totalVolume })
      const res = await fetch(`/api/admin/payments/list?status=${statusFilter}&year=${yearFilter}&limit=20&offset=${page*20}`)
      const json = await res.json()
      setRows(json.rows || [])
      setTotal(json.total || 0)
    }
    run()
  }, [statusFilter, yearFilter, page, router])

  const resolve = async (id: string) => {
    setLoading(true)
    const t = await fetch('/api/csrf').then(r => r.json()).then(j => j.csrfToken)
    const s = await supabase.auth.getSession()
    const at = s.data.session?.access_token || ''
    await fetch(`/api/payments/disputes/${id}/resolve`, { method: 'POST', headers: { 'X-CSRF-Token': t, ...(at ? { Authorization: `Bearer ${at}` } : {}) } })
    const d = await supabase.from('disputes').select('id,status,reason,payment_id').order('created_at', { ascending: false })
    setDisputes((d.data || []) as any)
    setLoading(false)
  }

  const refund = async (id: string) => {
    setLoading(true)
    const t = await fetch('/api/csrf').then(r => r.json()).then(j => j.csrfToken)
    const s = await supabase.auth.getSession()
    const at = s.data.session?.access_token || ''
    await fetch(`/api/payments/disputes/${id}/refund`, { method: 'POST', headers: { 'X-CSRF-Token': t, ...(at ? { Authorization: `Bearer ${at}` } : {}) } })
    const d = await supabase.from('disputes').select('id,status,reason,payment_id').order('created_at', { ascending: false })
    setDisputes((d.data || []) as any)
    setLoading(false)
  }

  return (
    <div className="container mx-auto p-4 pt-[72px]">
      <h1 className="text-2xl font-bold">Payments Admin</h1>
      {allowed === false && (<div className="mt-4">Forbidden</div>)}
      {revenue && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="border rounded-md p-4">
            <div className="text-sm text-gray-600">Total Volume</div>
            <div className="text-2xl font-bold">${revenue.totalVolume.toFixed(2)}</div>
          </div>
          <div className="border rounded-md p-4">
            <div className="text-sm text-gray-600">Platform Fees</div>
            <div className="text-2xl font-bold">${revenue.totalFee.toFixed(2)}</div>
          </div>
        </div>
      )}
      {revenue && (
        <div className="mt-6 border rounded-md p-4">
          <h2 className="text-xl font-semibold mb-2">Monthly Revenue</h2>
          <div className="flex items-center gap-3 mb-3">
            <select value={yearFilter} onChange={(e)=>setYearFilter(e.target.value==='all'?'all':Number(e.target.value))} className="border rounded-md p-2">
              <option value="all">All Years</option>
              {[2023,2024,2025,2026].map(y => (<option key={y} value={y}>{y}</option>))}
            </select>
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={showVolume} onChange={(e)=>setShowVolume(e.target.checked)} /> Volume</label>
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={showFee} onChange={(e)=>setShowFee(e.target.checked)} /> Platform Fee</label>
          </div>
          <MonthlyRevenueChart year={yearFilter} showVolume={showVolume} showFee={showFee} />
        </div>
      )}
      <div className="mt-6 border rounded-md p-4">
        <h2 className="text-xl font-semibold mb-2">Payments</h2>
        <div className="flex gap-2 items-center mb-2">
          <select value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value as any)} className="border rounded-md p-2">
            <option value="all">All</option>
            <option value="requires_capture">Requires Capture</option>
            <option value="completed">Completed</option>
            <option value="refunded">Refunded</option>
            <option value="failed">Failed</option>
          </select>
          <a href={`/api/admin/payments/export?status=${statusFilter}&year=${yearFilter}`} className="px-3 py-1 rounded-md bg-gray-100">Export CSV</a>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-left"><th className="p-2">ID</th><th className="p-2">Status</th><th className="p-2">Amount</th><th className="p-2">Fee</th><th className="p-2">When</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t">
                <td className="p-2">{r.id}</td>
                <td className="p-2">{r.status}</td>
                <td className="p-2">${Number(r.amount).toFixed(2)}</td>
                <td className="p-2">${Number(r.platform_fee||0).toFixed(2)}</td>
                <td className="p-2">{new Date(r.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {rows.length===0 && (<tr><td className="p-2" colSpan={5}>No payments</td></tr>)}
          </tbody>
        </table>
        <div className="p-2 flex items-center gap-2">
          <button disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))} className="px-3 py-1 rounded-md bg-gray-200">Prev</button>
          <span className="text-sm">Page {page+1} / {Math.max(1, Math.ceil(total/20))}</span>
          <button disabled={(page+1)>=Math.ceil(total/20)} onClick={()=>setPage(p=>p+1)} className="px-3 py-1 rounded-md bg-gray-200">Next</button>
        </div>
      </div>
      <div className="mt-6 border rounded-md">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="p-2">ID</th>
              <th className="p-2">Status</th>
              <th className="p-2">Reason</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {disputes.map((d) => (
              <tr key={d.id} className="border-t">
                <td className="p-2">{d.id}</td>
                <td className="p-2">{d.status}</td>
                <td className="p-2">{d.reason || ''}</td>
                <td className="p-2 space-x-2">
                  <button disabled={loading} onClick={() => resolve(d.id)} className="px-3 py-1 rounded-md bg-green-600 text-white">Resolve</button>
                  <button disabled={loading} onClick={() => refund(d.id)} className="px-3 py-1 rounded-md bg-red-600 text-white">Refund</button>
                </td>
              </tr>
            ))}
            {disputes.length === 0 && (
              <tr><td className="p-2" colSpan={4}>No disputes</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
export const dynamic = 'force-dynamic'
function MonthlyRevenueChart({ year, showVolume, showFee }: { year: number | 'all'; showVolume: boolean; showFee: boolean }) {
  const [data, setData] = useState<any[]>([])
  useEffect(() => {
    const run = async () => {
      const { supabase } = await import('@/lib/supabase/client')
      let query = supabase.from('monthly_payments_agg').select('year, month, volume, fee')
      if (year !== 'all') query = query.eq('year', year)
      const { data: rows } = await query
      const arr = (rows || []).map((r: any) => ({ month: `${r.year}-${String(r.month).padStart(2,'0')}`, volume: Number(r.volume || 0), fee: Number(r.fee || 0) }))
      setData(arr)
    }
    run()
  }, [year])
  return (
    <div style={{ width: '100%', height: 300 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" />
          <YAxis />
          <Tooltip />
          <Legend />
          {showVolume && (<Line type="monotone" dataKey="volume" stroke="#3B82F6" name="Volume" />)}
          {showFee && (<Line type="monotone" dataKey="fee" stroke="#10B981" name="Platform Fee" />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
