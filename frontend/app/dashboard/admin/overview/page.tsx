"use client";

import { useEffect, useState } from 'react'
 
import { supabase } from '@/lib/supabase/client'

export default function AdminOverviewPage() {
  const [kpis, setKpis] = useState<any>({ volume: 0, fee: 0, activeListings: 0, newUsers: 0, openDisputes: 0, pendingTransfers: 0 })

  useEffect(() => {
    const run = async () => {
      const p = await supabase.from('payments').select('amount,platform_fee')
      const pr = (p.data || []) as any[]
      const volume = pr.reduce((a,r)=>a+Number(r.amount||0),0)
      const fee = pr.reduce((a,r)=>a+Number(r.platform_fee||0),0)
      const l = await supabase.from('listings').select('id').eq('status','active')
      const activeListings = (l.data||[]).length
      const since = new Date(Date.now()-30*24*3600*1000).toISOString()
      const u = await supabase.from('profiles').select('id,created_at').gte('created_at', since)
      const newUsers = (u.data||[]).length
      const d = await supabase.from('disputes').select('id').eq('status','open')
      const openDisputes = (d.data||[]).length
      const t = await supabase.from('transactions').select('id').eq('type','transfer').eq('status','created')
      const pendingTransfers = (t.data||[]).length
      setKpis({ volume, fee, activeListings, newUsers, openDisputes, pendingTransfers })
    }
    run()
    const channel = supabase
      .channel('admin-overview')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => run())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'disputes' }, () => run())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'listings' }, () => run())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => run())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Overview</h1>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="border rounded-md p-4"><div className="text-sm">Total Volume</div><div className="text-2xl font-bold">${kpis.volume.toFixed(2)}</div></div>
        <div className="border rounded-md p-4"><div className="text-sm">Platform Fees</div><div className="text-2xl font-bold">${kpis.fee.toFixed(2)}</div></div>
        <div className="border rounded-md p-4"><div className="text-sm">Active Listings</div><div className="text-2xl font-bold">{kpis.activeListings}</div></div>
        <div className="border rounded-md p-4"><div className="text-sm">New Users (30d)</div><div className="text-2xl font-bold">{kpis.newUsers}</div></div>
        <div className="border rounded-md p-4"><div className="text-sm">Open Disputes</div><div className="text-2xl font-bold">{kpis.openDisputes}</div></div>
        <div className="border rounded-md p-4"><div className="text-sm">Pending Transfers</div><div className="text-2xl font-bold">{kpis.pendingTransfers}</div></div>
      </div>
    </div>
  )
}
