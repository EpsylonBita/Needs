import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const users = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003']
const profiles = ['20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003']
const legacyChat = '30000000-0000-4000-8000-000000000001'
const legacyMessages = ['40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002']
const load = path => readFile(new URL(`../../../supabase/${path}`, import.meta.url), 'utf8')
const migration = 'migrations/20261019172004_chat_inbox_notifications.sql'
const table = (source, name) => source.match(new RegExp(`create table if not exists ${name} \\([\\s\\S]*?\\n\\);`, 'i'))[0]

async function as(user, sql, params = [], role = 'authenticated') {
  await db.exec(`set role ${role}`)
  try {
    await db.query("select set_config('test.user', $1, false)", [user || ''])
    return await db.query(sql, params)
  } finally {
    await db.exec('reset role')
    await db.query("select set_config('test.user', '', false)")
  }
}
const rpc = async (user, sql, params = []) => (await as(user, `select ${sql} as result`, params)).rows[0].result
const send = (user, chat, content, nonce = randomUUID()) => rpc(user, 'send_chat_message($1,$2,$3,$4)', [user, chat, content, nonce])
const inbox = user => as(user, 'select * from get_my_chats($1)', [user]).then(result => result.rows)
async function freshChat() {
  const id = randomUUID()
  await db.query("insert into chats(id,type) values ($1,'direct')", [id])
  await db.query('insert into chat_participants(chat_id,user_id) values ($1,$2),($1,$3)', [id, profiles[0], profiles[1]])
  return id
}

before(async () => {
  // Real legacy table/policy definitions and the deployed chat RPC. Local WASM Postgres only.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user',true),'')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create table profiles(id uuid primary key, user_id uuid unique, display_name text, avatar_url text);
    create table listings(id uuid primary key, seller_id uuid references profiles(id), title text, status text default 'active');
    insert into profiles values
      ('${profiles[0]}','${users[0]}','First member','https://example.invalid/a.png'),
      ('${profiles[1]}','${users[1]}','Second member','https://example.invalid/b.png'),
      ('${profiles[2]}','${users[2]}','Outsider',null);
    create publication supabase_realtime;
  `)
  const initial = await load('sql/001_init.sql')
  for (const name of ['chats','chat_participants','messages','notifications']) await db.exec(table(initial, name))
  const policies = await load('sql/020_fix_rls_identity_model.sql')
  await db.exec(policies.split('-- Chat participants policies')[1].split('-- Payment policies')[0])
  await db.exec(policies.split('-- Notifications policies')[1].split('-- Grant necessary permissions')[0])
  await db.exec(`
    alter table messages enable row level security; alter table notifications enable row level security;
    grant select on profiles, listings to authenticated;
    grant all on messages, notifications, chats, chat_participants to anon, authenticated, service_role;
    alter publication supabase_realtime add table messages, notifications;
    insert into chats(id,type) values ('${legacyChat}','direct');
    insert into chat_participants(chat_id,user_id,last_read_at) values
      ('${legacyChat}','${profiles[0]}','2026-01-02'),('${legacyChat}','${profiles[1]}',null);
    insert into messages(id,chat_id,sender_id,content,created_at) values
      ('${legacyMessages[0]}','${legacyChat}','${profiles[1]}','Older message','2026-01-01'),
      ('${legacyMessages[1]}','${legacyChat}','${profiles[1]}','Unread message','2026-01-03');
  `)
  await db.exec((await load('migrations/20261013232103_chat_storage_repairs.sql')).split('-- Owners must')[0])
  // Regression baseline: enriched inbox/read/leave RPCs do not exist in the prior schema.
  await assert.rejects(as(users[0], 'select * from get_my_chats($1)', [users[0]]), /does not exist/)
  await db.exec(await load(migration))
  await db.exec(await load(migration)) // Safe replay: no duplicate events or changed read state.
})
after(async () => db.close())

test('migration preserves legacy messages/read history, adds scoped publication, and does not backfill notifications', async () => {
  const chat = (await inbox(users[0])).find(row => row.chat_id === legacyChat)
  assert.equal(chat.unread_count, 1)
  assert.equal(chat.last_read_sequence, 1)
  assert.equal(chat.last_read_message_id, legacyMessages[0])
  assert.equal(chat.last_message.id, legacyMessages[1])
  assert.equal(chat.last_message.sequence, 2)
  assert.deepEqual(chat.participants, [{ profile_id: profiles[1], display_name: 'Second member', avatar_url: 'https://example.invalid/b.png', left_at: null }])
  assert.equal((await db.query('select count(*)::int n from notifications')).rows[0].n, 0)
  assert.deepEqual((await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime' order by tablename")).rows.map(row => row.tablename), ['chat_participants','messages','notifications'])
})

test('identity mismatch and outsider access fail before any mutation; member realtime rows remain visible', async () => {
  const chat = await freshChat()
  for (const [sql, params] of [
    ['get_my_chats($1)', [users[1]]],
    ['get_chat_messages($1,$2)', [users[1],chat]],
    ['send_chat_message($1,$2,$3,$4)', [users[1],chat,'Wrong account',randomUUID()]],
    ['mark_chat_read($1,$2,$3)', [users[1],chat,legacyMessages[0]]],
    ['leave_chat($1,$2)', [users[1],chat]], ['rejoin_chat($1,$2)', [users[1],chat]],
    ['get_or_create_direct_chat($1,$2,$3)', [profiles[1],null,users[1]]],
  ]) await assert.rejects(rpc(users[0], sql, params), /account changed/)
  assert.equal((await as(users[0], 'select * from chat_participants where chat_id=$1', [chat])).rows.length, 2)
  assert.equal((await as(users[2], 'select * from chat_participants where chat_id=$1', [chat])).rows.length, 0)
  assert.equal((await as(users[2], 'select * from messages where chat_id=$1', [legacyChat])).rows.length, 0)
  assert.deepEqual(await inbox(users[2]), [])
  await assert.rejects(rpc(users[2], 'rejoin_chat($1,$2)', [users[2],chat]), /not a participant/)
  await assert.rejects(send(users[2],chat,'Intruder'), /not a participant/)
  await assert.rejects(as(null, 'select * from get_my_chats($1)', [users[0]], 'anon'), /permission denied/)
  assert.equal((await db.query('select count(*)::int n from messages where chat_id=$1',[chat])).rows[0].n,0)
})

test('sending is authenticated and idempotent, with one private notification only for the other member', async () => {
  const chat = await freshChat()
  const nonce = randomUUID()
  const message = await send(users[0],chat,'  Hello  ',nonce)
  const retry = await send(users[0],chat,'Hello',nonce)
  assert.equal(retry.id,message.id)
  assert.equal(message.sender_id,profiles[0])
  assert.equal(message.content,'Hello')
  assert.equal(message.sequence,1)
  assert.equal(message.client_message_id,nonce)
  const notifications = (await db.query("select * from notifications where payload->>'chat_id'=$1",[chat])).rows
  assert.equal(notifications.length,1)
  assert.equal(notifications[0].user_id,profiles[1])
  assert.deepEqual(notifications[0].payload,{chat_id:chat,message_id:message.id,sender_id:profiles[0]})
  assert.equal((await as(users[0],'select * from notifications where id=$1',[notifications[0].id])).rows.length,0)
  assert.equal((await as(users[1],'select * from notifications where id=$1',[notifications[0].id])).rows.length,1)
  await assert.rejects(send(users[0],chat,'Different',nonce),/already used/)
  await assert.rejects(send(users[0],await freshChat(),'Hello',nonce),/already used/)
  await assert.rejects(send(users[0],chat,'   '),/between 1 and 4000/)
  await assert.rejects(send(users[0],chat,'x'.repeat(4001)),/between 1 and 4000/)
  await assert.rejects(send(users[0],chat,'Missing nonce',null),/identifier is required/)
  await assert.rejects(as(users[0],'insert into messages(chat_id,sender_id,content) values ($1,$2,$3)',[chat,profiles[0],'Bypass']),/permission denied/)
  await assert.rejects(as(users[0],'delete from messages where id=$1',[message.id]),/permission denied/)
  await assert.rejects(as(users[1],"insert into notifications(user_id,type) values ($1,'chat_message')",[profiles[0]]),/permission denied/)
  await assert.rejects(as(users[1],"update notifications set payload='{}' where id=$1",[notifications[0].id]),/permission denied/)
  await as(users[1],'update notifications set read=true where id=$1',[notifications[0].id])
})

test('read watermark marks exactly the rendered history and leaves later messages and unrelated notifications unread', async () => {
  const chat = await freshChat()
  const first = await send(users[1],chat,'Rendered message')
  const later = await send(users[1],chat,'Arrived after rendering')
  const otherChat = await freshChat()
  const otherMessage = await send(users[1],otherChat,'Other chat')
  // Even a malformed/internal notification reference cannot be marked by a chat-id-only match.
  const fake = (await db.query("insert into notifications(user_id,type,payload) values ($1,'chat_message',$2) returning id",[profiles[0],JSON.stringify({chat_id:chat,message_id:otherMessage.id})])).rows[0].id
  const state = await rpc(users[0],'mark_chat_read($1,$2,$3)',[users[0],chat,first.id])
  assert.equal(state.unread_count,1)
  assert.equal(state.last_read_sequence,first.sequence)
  const read = (await db.query("select payload->>'message_id' as message,read from notifications where user_id=$1",[profiles[0]])).rows
  assert.equal(read.find(row=>row.message===first.id).read,true)
  assert.equal(read.find(row=>row.message===later.id).read,false)
  assert.equal((await db.query('select read from notifications where id=$1',[fake])).rows[0].read,false)
  await assert.rejects(rpc(users[0],'mark_chat_read($1,$2,$3)',[users[0],chat,otherMessage.id]),/does not belong/)
  await rpc(users[0],'mark_chat_read($1,$2,$3)',[users[0],chat,later.id])
  const stale = await rpc(users[0],'mark_chat_read($1,$2,$3)',[users[0],chat,first.id])
  assert.equal(stale.last_read_message_id,later.id)
  assert.equal(stale.unread_count,0)
})

test('leave retains history and membership, blocks new messages, and only the caller can rejoin', async () => {
  const chat = await rpc(users[0],'get_or_create_direct_chat($1,$2,$3)',[profiles[1],null,users[0]])
  const message = await send(users[0],chat,'Retain this history')
  await rpc(users[0],'leave_chat($1,$2)',[users[0],chat])
  const mine = (await inbox(users[0])).find(row=>row.chat_id===chat)
  const other = (await inbox(users[1])).find(row=>row.chat_id===chat)
  assert.ok(mine.left_at)
  assert.equal(mine.can_send,false)
  assert.equal(other.other_left,true)
  assert.equal(other.can_send,false)
  assert.equal((await as(users[0],'select * from get_chat_messages($1,$2)',[users[0],chat])).rows[0].id,message.id)
  assert.equal((await db.query('select count(*)::int n from chat_participants where chat_id=$1',[chat])).rows[0].n,2)
  await assert.rejects(send(users[0],chat,'Left sender'),/Rejoin/)
  await assert.rejects(send(users[1],chat,'Recipient left'),/other participant has left/)
  await rpc(users[1],'leave_chat($1,$2)',[users[1],chat])
  assert.equal(await rpc(users[0],'get_or_create_direct_chat($1,$2)',[profiles[1],null]),chat)
  assert.equal((await inbox(users[0])).find(row=>row.chat_id===chat).left_at,null)
  assert.ok((await inbox(users[1])).find(row=>row.chat_id===chat).left_at)
  await rpc(users[1],'rejoin_chat($1,$2)',[users[1],chat])
  assert.equal((await inbox(users[0])).find(row=>row.chat_id===chat).can_send,true)
  assert.equal((await send(users[1],chat,'Back again')).sequence,2)
  assert.equal(await rpc(users[1],'get_or_create_direct_chat($1,$2,$3)',[profiles[0],null,users[1]]),chat)
})

test('bounded sequence pagination is stable with timestamp ties and new incoming messages', async () => {
  const chat = await freshChat()
  const sent = []
  for (let index=0;index<5;index++) sent.push(await send(users[0],chat,`Message ${index}`))
  await db.query("update messages set created_at='2026-01-01' where chat_id=$1",[chat])
  const first = (await as(users[1],'select * from get_chat_messages($1,$2,null,3)',[users[1],chat])).rows
  assert.deepEqual(first.map(row=>row.sequence),[5,4,3])
  await send(users[0],chat,'New arrival')
  const second = (await as(users[1],'select * from get_chat_messages($1,$2,$3,3)',[users[1],chat,first.at(-1).sequence])).rows
  assert.deepEqual(second.map(row=>row.sequence),[2,1])
  assert.equal(new Set([...first,...second].map(row=>row.id)).size,5)
  await assert.rejects(as(users[1],'select * from get_chat_messages($1,$2,null,101)',[users[1],chat]),/Invalid message page/)
  await assert.rejects(as(users[2],'select * from get_chat_messages($1,$2)',[users[2],chat]),/not a participant/)
})

test('notification failure rolls back the message and sequence atomically', async () => {
  const chat = await freshChat()
  await db.exec("alter table notifications add constraint fixture_notification_failure check(type <> 'chat_message') not valid")
  try { await assert.rejects(send(users[0],chat,'Must roll back'),/fixture_notification_failure/) }
  finally { await db.exec('alter table notifications drop constraint fixture_notification_failure') }
  assert.equal((await db.query('select count(*)::int n from messages where chat_id=$1',[chat])).rows[0].n,0)
  assert.equal((await send(users[0],chat,'Retry safely')).sequence,1)
})

test('listing chat idempotency and publisher binding survive the new expected-account overload', async () => {
  const listing = randomUUID()
  await db.query("insert into listings(id,seller_id,title) values ($1,$2,'Listing chat')",[listing,profiles[1]])
  const chat = await rpc(users[0],'get_or_create_direct_chat($1,$2,$3)',[null,listing,users[0]])
  assert.equal(await rpc(users[0],'get_or_create_direct_chat(p_listing_id=>$1)',[listing]),chat)
  await assert.rejects(rpc(users[0],'get_or_create_direct_chat($1,$2,$3)',[profiles[2],listing,users[0]]),/does not own/)
  await rpc(users[1],'leave_chat($1,$2)',[users[1],chat])
  await rpc(users[0],'get_or_create_direct_chat($1,$2,$3)',[null,listing,users[0]])
  assert.ok((await inbox(users[1])).find(row=>row.chat_id===chat).left_at)
  await db.query("update listings set status='sold' where id=$1",[listing])
  await rpc(users[1],'rejoin_chat($1,$2)',[users[1],chat])
  assert.equal((await inbox(users[1])).find(row=>row.chat_id===chat).can_send,true)
})
