"use client";

import { useEffect, useState } from 'react'
 
import { supabase } from '@/lib/supabase/client'

type Flag = { key: string; enabled: boolean }

export default function AdminSettingsPage() {
  const [flags, setFlags] = useState<Flag[]>([])
  const [newKey, setNewKey] = useState('')

  useEffect(() => {
    const run = async () => {
      const { data } = await supabase.from('feature_flags').select('key,enabled')
      setFlags((data || []) as Flag[])
    }
    run()
  }, [])

  const toggle = async (key: string, enabled: boolean) => {
    await supabase.from('feature_flags').upsert({ key, enabled })
    const { data } = await supabase.from('feature_flags').select('key,enabled')
    setFlags((data || []) as Flag[])
  }

  const add = async () => {
    if (!newKey) return
    await supabase.from('feature_flags').insert({ key: newKey, enabled: false })
    const { data } = await supabase.from('feature_flags').select('key,enabled')
    setFlags((data || []) as Flag[])
    setNewKey('')
  }

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold">Settings</h1>
      <div className="mt-4 border rounded-md p-3">
        <div className="flex gap-2">
          <input value={newKey} onChange={(e)=>setNewKey(e.target.value)} className="border rounded-md p-2" placeholder="New flag key" />
          <button onClick={add} className="px-3 py-1 rounded-md bg-blue-600 text-white">Add</button>
        </div>
        <div className="mt-4">
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className="p-2">Key</th><th className="p-2">Enabled</th></tr></thead>
            <tbody>
              {flags.map(f => (
                <tr key={f.key} className="border-t">
                  <td className="p-2">{f.key}</td>
                  <td className="p-2">
                    <input type="checkbox" checked={!!f.enabled} onChange={(e)=>toggle(f.key, e.target.checked)} />
                  </td>
                </tr>
              ))}
              {flags.length===0 && (<tr><td className="p-2" colSpan={2}>No flags</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
