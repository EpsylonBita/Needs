"use client";

import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase/client'
import { withCsrfHeaders } from '@/lib/utils/csrf'

type MilestoneRow = { id: string; title: string; amount: number; status: string; stripe_payment_intent: string | null }

export default function MilestonesPage() {
  const [rows, setRows] = useState<MilestoneRow[]>([])
  const [_myProfileId, setMyProfileId] = useState<string | null>(null)
  const [enabled, setEnabled] = useState<boolean>(true)

  useEffect(() => {
    const run = async () => {
      const u = await supabase.auth.getUser()
      const uid = u.data.user?.id
      if (!uid) return
      const { data: me } = await supabase.from('profiles').select('id').eq('user_id', uid).limit(1).single()
      const pid = me?.id
      if (!pid) return
      setMyProfileId(pid)
      const { data } = await supabase
        .from('milestones')
        .select('id,title,amount,status,stripe_payment_intent')
        .or(`buyer_id.eq.${pid},seller_id.eq.${pid}`)
        .order('created_at', { ascending: false })
      setRows((data || []) as MilestoneRow[])
      const { data: flag } = await supabase.from('feature_flags').select('enabled').eq('key','milestones_enabled').single()
      setEnabled(!!flag?.enabled)
    }
    run()
  }, [])

  const capture = async (row: MilestoneRow) => {
    if (!row.stripe_payment_intent) return
    const res = await fetch('/api/payments/capture', { method: 'POST', headers: await withCsrfHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ intentId: row.stripe_payment_intent }) })
    if (res.ok) {
      const refreshed = await supabase.from('milestones').select('id,title,amount,status,stripe_payment_intent').eq('id', row.id).single()
      if (refreshed.data) setRows(prev => prev.map(x => x.id===row.id ? (refreshed.data as MilestoneRow) : x))
    }
  }

  const confirmBuyer = async (row: MilestoneRow) => {
    await supabase.from('milestones').update({ buyer_confirmed: true }).eq('id', row.id)
    const refreshed = await supabase.from('milestones').select('id,title,amount,status,stripe_payment_intent,buyer_confirmed,seller_confirmed').eq('id', row.id).single()
    if (refreshed.data) setRows(prev => prev.map(x => x.id===row.id ? (refreshed.data as MilestoneRow) : x))
  }

  const confirmSeller = async (row: MilestoneRow) => {
    await supabase.from('milestones').update({ seller_confirmed: true }).eq('id', row.id)
    const refreshed = await supabase.from('milestones').select('id,title,amount,status,stripe_payment_intent,buyer_confirmed,seller_confirmed').eq('id', row.id).single()
    if (refreshed.data) setRows(prev => prev.map(x => x.id===row.id ? (refreshed.data as MilestoneRow) : x))
  }

  return (
    <div className="container mx-auto p-4 pt-[72px]">
      <h1 className="text-2xl font-bold">Milestones</h1>
      {!enabled && (<div className="mt-2 text-sm text-yellow-700">Milestones are disabled</div>)}
      <div className="mt-4 border rounded-md">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="p-2">Title</th>
              <th className="p-2">Amount</th>
              <th className="p-2">Status</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2">{r.title}</td>
                <td className="p-2">${Number(r.amount).toFixed(2)}</td>
                <td className="p-2">{r.status}</td>
                <td className="p-2 space-x-2">
                  {r.status === 'requires_capture' && (
                    <>
                      <button onClick={() => confirmBuyer(r)} className="px-3 py-1 rounded-md bg-blue-600 text-white">I’m done (Buyer)</button>
                      <button onClick={() => confirmSeller(r)} className="px-3 py-1 rounded-md bg-purple-600 text-white">I’m done (Seller)</button>
                      <button onClick={() => capture(r)} disabled={!((r as any).buyer_confirmed && (r as any).seller_confirmed)} className="px-3 py-1 rounded-md bg-green-600 text-white">Capture</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td className="p-2" colSpan={4}>No milestones</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
