// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_LISTING_IDS } from '@/lib/listings/demo-policy'

const read = (path: string) => readFileSync(resolve(process.cwd(), '../supabase', path), 'utf8')
const migration = 'migrations/20261028153000_demo_listing_transaction_policy.sql'
const owner = 'cddec67e-80b7-41dc-a927-2c901c9cdbb8'
const ownerUser = '354c6850-3c10-43bf-ac0d-3af21df78094'
const visitor = '10000000-0000-4000-8000-000000000001'
const realListing = '10000000-0000-4000-8000-000000000002'
const legacyChat = '10000000-0000-4000-8000-000000000003'
const legacyMessage = '10000000-0000-4000-8000-000000000004'
const table = (source: string, name: string) => source.match(new RegExp(`create table if not exists ${name} \\([\\s\\S]*?\\n\\);`, 'i'))![0]
let db: PGlite
let beforeFunctions: unknown[]
const functionPrivileges = () => db.query("select proname, prosecdef, proconfig, proacl::text from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='needs_private' and proname in ('get_or_create_direct_chat','prepare_chat_message') order by proname")
async function as<T>(user: string | null, run: () => Promise<T>, role = 'authenticated') {
  await db.exec(`set role ${role}`)
  await db.query("select set_config('test.user',$1,false)", [user || ''])
  try { return await run() } finally { await db.exec('reset role'); await db.query("select set_config('test.user','',false)") }
}
const open = (id: string, legacy = false) => as(visitor, () => db.query<{ id: string }>(legacy
  ? 'select public.get_or_create_direct_chat(null,$1) id'
  : 'select public.get_or_create_direct_chat(null,$1,$2) id', legacy ? [id] : [id, visitor]))

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,raw_app_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.user',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated,service_role;
    create table profiles(id uuid primary key,user_id uuid unique,display_name text,avatar_url text);
    create table listings(id uuid primary key,seller_id uuid references profiles(id),title text,status text default 'active',price numeric);
    create publication supabase_realtime;`)
  const initial = read('sql/001_init.sql')
  for (const name of ['chats', 'chat_participants', 'messages', 'notifications']) await db.exec(table(initial, name))
  const policies = read('sql/020_fix_rls_identity_model.sql')
  await db.exec(policies.split('-- Chat participants policies')[1].split('-- Payment policies')[0])
  await db.exec(policies.split('-- Notifications policies')[1].split('-- Grant necessary permissions')[0])
  await db.exec(`alter table messages enable row level security; alter table notifications enable row level security;
    grant select on profiles,listings to authenticated;
    grant all on messages,notifications,chats,chat_participants to anon,authenticated,service_role;
    alter publication supabase_realtime add table messages,notifications;`)
  await db.query('insert into auth.users values($1,$2::jsonb),($3,\'{}\')', [ownerUser, JSON.stringify({ demo_batch: 'needs-demo-athens-20261014' }), visitor])
  await db.query('insert into profiles(id,user_id) values($1,$2),($3,$3)', [owner, ownerUser, visitor])
  for (const id of [...DEMO_LISTING_IDS, realListing]) await db.query("insert into listings(id,seller_id,title,price) values($1,$2,'Δοκιμαστική title is not identity',0)", [id, owner])
  await db.exec(read('migrations/20261013232103_chat_storage_repairs.sql').split('-- Owners must')[0])
  await db.exec(read('migrations/20261019172004_chat_inbox_notifications.sql'))
  // Historical demo conversation/messages are legitimate existing data, never deleted by the policy.
  await db.query("insert into chats(id,type,listing_id) values($1,'direct',$2)", [legacyChat, DEMO_LISTING_IDS[0]])
  await db.query('insert into chat_participants(chat_id,user_id) values($1,$2),($1,$3)', [legacyChat, visitor, owner])
  await db.query("insert into messages(id,chat_id,sender_id,content) values($1,$2,$3,'Historical message')", [legacyMessage, legacyChat, visitor])
  beforeFunctions = (await functionPrivileges()).rows
  await db.exec(read(migration))
}, 30000)
beforeEach(async () => {
  await db.query('update auth.users set raw_app_meta_data=$1::jsonb where id=$2', [JSON.stringify({ demo_batch: 'needs-demo-athens-20261014' }), ownerUser])
})
afterAll(async () => { await db?.close() })

describe('sourced demo policy in isolated PostgreSQL', () => {
  it('blocks every sourced demo through both existing chat RPC overloads before insertion', async () => {
    const before = (await db.query('select count(*)::int count from chats')).rows
    for (const id of DEMO_LISTING_IDS) {
      await expect(open(id)).rejects.toThrow('not available for transactions')
      await expect(open(id, true)).rejects.toThrow('not available for transactions')
    }
    expect((await db.query('select count(*)::int count from chats')).rows).toEqual(before)
  })
  it('allows unrelated same-owner, same-wording and zero-price listings and their messages', async () => {
    const result = await open(realListing)
    const id = result.rows[0].id
    const message = await as(visitor, () => db.query<{ message: { content: string } }>('select public.send_chat_message($1,$2,$3,$4) message', [visitor, id, 'Real inquiry', randomUUID()]))
    expect(message.rows[0].message).toMatchObject({ content: 'Real inquiry' })
  })
  it('requires trusted source metadata as well as the exact IDs for database binding', async () => {
    await db.query("update auth.users set raw_app_meta_data='{}' where id=$1", [ownerUser])
    await expect(open(DEMO_LISTING_IDS[1])).resolves.toBeDefined()
  })
  it('blocks new messages in existing demo chats through RPC and service direct insert without deleting history', async () => {
    const before = (await db.query('select count(*)::int count from notifications')).rows
    await expect(as(visitor, () => db.query('select public.send_chat_message($1,$2,$3,$4)', [visitor, legacyChat, 'New demo message', randomUUID()]))).rejects.toThrow('not available for transactions')
    await expect(as(null, () => db.query('insert into messages(chat_id,sender_id,content) values($1,$2,$3)', [legacyChat, visitor, 'Direct bypass']), 'service_role')).rejects.toThrow('not available for transactions')
    expect((await db.query('select id,content from messages where chat_id=$1', [legacyChat])).rows).toEqual([{ id: legacyMessage, content: 'Historical message' }])
    expect((await db.query('select count(*)::int count from notifications')).rows).toEqual(before)
  })
  it('preserves definer, fixed search path, grants, prices and history when replayed', async () => {
    await db.exec(read(migration))
    expect((await functionPrivileges()).rows).toEqual(beforeFunctions)
    expect((await db.query<{ count: number }>('select count(*)::int count from listings where price=0')).rows[0].count).toBe(9)
    expect((await db.query('select id from messages where id=$1', [legacyMessage])).rows).toHaveLength(1)
    await expect(as(null, () => db.query('select public.get_or_create_direct_chat(null,$1,$2)', [realListing, visitor]), 'anon')).rejects.toThrow('permission denied')
  })
})
