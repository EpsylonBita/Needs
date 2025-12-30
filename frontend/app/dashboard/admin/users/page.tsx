"use client";

import { useEffect, useState } from 'react'
 
import { supabase } from '@/lib/supabase/client'

type Profile = { id: string; display_name: string | null; email: string | null; reputation: number | null; stripe_account_id: string | null }

export default function AdminUsersPage() {
  const [rows, setRows] = useState<Profile[]>([])
  const [filterOnboarded, setFilterOnboarded] = useState<'all'|'onboarded'|'not_onboarded'>('all')

  useEffect(() => {
    const run = async () => {
      let query = supabase.from('profiles').select('id,display_name,email,reputation,stripe_account_id')
      const { data } = await query
      setRows((data || []) as Profile[])
    }
    run()
    const ch = supabase.channel('admin-users').on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, run).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const filtered = rows.filter(r => filterOnboarded==='all' ? true : filterOnboarded==='onboarded' ? !!r.stripe_account_id : !r.stripe_account_id)

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold">Users</h1>
      <div className="mt-2 flex gap-2 items-center">
        <select value={filterOnboarded} onChange={(e)=>setFilterOnboarded(e.target.value as any)} className="border rounded-md p-2">
          <option value="all">All</option>
          <option value="onboarded">Onboarded</option>
          <option value="not_onboarded">Not Onboarded</option>
        </select>
      </div>
      <div className="mt-4 border rounded-md">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left"><th className="p-2">Display</th><th className="p-2">Email</th><th className="p-2">Reputation</th><th className="p-2">Stripe</th></tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id} className="border-t">
                <td className="p-2">{u.display_name || ''}</td>
                <td className="p-2">{u.email || ''}</td>
                <td className="p-2">{Number(u.reputation||0).toFixed(2)}</td>
                <td className="p-2">{u.stripe_account_id ? 'Onboarded' : 'Missing'}</td>
              </tr>
            ))}
            {filtered.length===0 && (<tr><td className="p-2" colSpan={4}>No users</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  )
}
