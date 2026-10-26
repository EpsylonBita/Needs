import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'

const owner = '10000000-0000-4000-8000-000000000001'
const provider = '10000000-0000-4000-8000-000000000002'
const outsider = '10000000-0000-4000-8000-000000000003'
const listing = '20000000-0000-4000-8000-000000000001'
const chat = '30000000-0000-4000-8000-000000000001'
const readSql = name => readFile(new URL('../../../supabase/sql/' + name, import.meta.url), 'utf8')
const readMigration = name => readFile(new URL('../../../supabase/migrations/' + name, import.meta.url), 'utf8')
function table(sql, name) {
  const start = sql.toLowerCase().indexOf('create table if not exists ' + name + ' (')
  assert.notEqual(start, -1)
  return sql.slice(start, sql.indexOf(');', start) + 2)
}

test('request/offer transactions persist real parties and enforce conversation boundaries', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    `)
    const baseline = await readSql('001_init.sql')
    // Apply the actual core schema and policies, replacing only PostGIS storage.
    await db.exec(baseline.replace('create extension if not exists postgis;', '').replace('geography(Point,4326)', 'text'))
    await db.exec((await readSql('002_indexes_policies.sql')).replace('create index if not exists listings_location_gix on listings using gist (location);', ''))
    await db.exec(await readSql('020_fix_rls_identity_model.sql'))
    await db.exec('alter table chats add column listing_id uuid references listings(id); alter table listings add column contact_number text')
    await db.exec(await readSql('007_moderation_logs.sql'))
    await db.exec(await readSql('010_alter_moderation_logs.sql'))
    await db.exec(await readSql('004_payment_confirmations.sql'))
    await db.exec(await readSql('009_milestones.sql'))
    await db.exec(table(await readSql('021_fix_payment_security.sql'), 'payment_audit_logs'))
    await db.exec((await readSql('021_fix_payment_security.sql')).split('-- Add payment audit log table')[0])
    for (const file of ['013_webhook_events.sql', '023_webhook_events_extended.sql', '024_payments_intent_unique.sql', '025_payments_transactions_disputes_milestones_columns.sql', '027_payments_open_intent_unique.sql']) await db.exec(await readSql(file))
    await db.exec(await readMigration('20261013232046_webhook_event_atomic_processing.sql'))
    await db.query('insert into auth.users values ($1),($2),($3)',[owner,provider,outsider])
    await db.query('insert into profiles(id,user_id) values ($1,$1),($2,$2),($3,$3)', [owner, provider, outsider])
    await db.query("insert into listings(id,seller_id,title,description,price,status,main_category,sub_category,location) values ($1,$2,'Request','Need a plumber',100,'active','Services','I want','fixture')", [listing, owner])
    await db.query("insert into payments(listing_id,buyer_id,seller_id,amount,platform_fee,stripe_payment_intent,status) values ($1,$2,$3,100,5,'pi_legacy_reversed','requires_capture')",[listing,provider,owner])
    await db.exec(await readMigration('20261019120100_request_offer_transactions.sql'))
    await db.exec(await readMigration('20261019120200_review_eligibility.sql'))
    await db.exec(await readMigration('20261019120300_listing_moderation.sql'))
    assert.deepEqual((await db.query("select role_review_required,buyer_id,seller_id,status from payments where stripe_payment_intent='pi_legacy_reversed'")).rows[0],
      {role_review_required:true,buyer_id:provider,seller_id:owner,status:'requires_capture'})
    await db.query("insert into chats(id,type,listing_id) values ($1,'direct',$2)", [chat, listing])
    await db.query('insert into chat_participants(chat_id,user_id) values ($1,$2),($1,$3)', [chat, owner, provider])
    await db.exec('set role service_role')
    const pay = (buyer, seller, intent, selectedChat = chat) => db.query('select public.create_listing_payment($1,$2,$3,100,5,$4,$5) result', [listing,buyer,seller,intent,selectedChat])

    // The requester pays, and only the responding member receives funds.
    const first = (await pay(owner,provider,'pi_request')).rows[0].result
    assert.equal((await pay(owner,provider,'pi_request')).rows[0].result.payment_id, first.payment_id)
    assert.deepEqual((await db.query("select buyer_id,seller_id,chat_id,amount::text from payments where stripe_payment_intent='pi_request'")).rows,
      [{ buyer_id: owner, seller_id: provider, chat_id: chat, amount: '100.00' }])
    await assert.rejects(pay(provider,owner,'pi_wrong_direction'), /requester/)
    await assert.rejects(pay(owner,outsider,'pi_wrong_provider'), /Provider/)
    await assert.rejects(pay(owner,provider,'pi_no_chat',null), /conversation/)
    await assert.rejects(pay(outsider,provider,'pi_outsider'), /participants/)
    await db.exec('reset role')
    await db.query('insert into chat_participants(chat_id,user_id) values ($1,$2)', [chat,outsider])
    await db.exec('set role service_role')
    await assert.rejects(pay(owner,provider,'pi_group'), /participants/)
    await db.exec('reset role')
    await db.query('delete from chat_participants where user_id=$1', [outsider])
    await db.exec('set role service_role')

    // Milestones keep the chosen provider and conversation through proposals,
    // funding and retries; money is represented by a single canonical payment.
    const proposal = (await db.query('select public.create_milestone_proposal($1,$2,$3,40,$4) id', [listing,owner,'First visit',chat])).rows[0].id
    const fund = () => db.query('select public.create_milestone_payment($1,$2,$3,$4,40,2,$5,$6,$7) result', [listing,owner,provider,'First visit','pi_milestone',proposal,chat])
    const funded = (await fund()).rows[0].result
    assert.equal((await fund()).rows[0].result.payment_id, funded.payment_id)
    assert.deepEqual((await db.query('select buyer_id,seller_id,chat_id from milestones where id=$1',[proposal])).rows[0],
      { buyer_id: owner, seller_id: provider, chat_id: chat })
    await assert.rejects(db.query('select public.create_milestone_proposal($1,$2,$3,70,$4)', [listing,owner,'Over budget',chat]), /exceed/)

    // A second conversation must never inherit the first provider's agreement.
    const otherChat = '30000000-0000-4000-8000-000000000002'
    await db.exec('reset role')
    await db.query("insert into chats(id,type,listing_id) values ($1,'direct',$2)",[otherChat,listing])
    await db.query('insert into chat_participants(chat_id,user_id) values ($1,$2),($1,$3)',[otherChat,owner,outsider])
    await db.exec('set role service_role')
    await assert.rejects(db.query('select public.create_milestone_payment($1,$2,$3,$4,40,2,$5,$6,$7)',
      [listing,owner,outsider,'First visit','pi_forged',proposal,otherChat]), /proposal/)

    // Completion from the payment flow is the only review eligibility source.
    await db.query("update payments set status='completed',buyer_confirmed=true,seller_confirmed=true where id=$1",[first.payment_id])
    const review = (await db.query('select public.submit_payment_review($1,$2,5,$3) id',[first.payment_id,owner,'Good work'])).rows[0].id
    assert.deepEqual((await db.query('select seller_id,reviewer_id from reviews where id=$1',[review])).rows[0],{seller_id:provider,reviewer_id:owner})
    await assert.rejects(db.query('select public.submit_payment_review($1,$2,5,$3)',[first.payment_id,owner,'Duplicate']), /duplicate/)

    await db.query("update listings set main_category='Items',sub_category='Free' where id=$1", [listing])
    await assert.rejects(pay(provider,owner,'pi_free'), /does not require/)
    await db.query("update listings set sub_category='Sell' where id=$1", [listing])
    await db.query("update payments set status='failed' where stripe_payment_intent='pi_legacy_reversed'")
    await pay(provider,owner,'pi_offer',null)
    const legacyOfferProposal = (await db.query('select public.create_milestone_proposal($1,$2,$3,20) id',[listing,provider,'Legacy offer'])).rows[0].id
    await db.query('select public.create_milestone_payment($1,$2,$3,$4,20,1,$5,$6,$7)',[listing,provider,owner,'Legacy offer','pi_offer_milestone',legacyOfferProposal,chat])
    assert.equal((await db.query('select chat_id from milestones where id=$1',[legacyOfferProposal])).rows[0].chat_id,chat)
    await assert.rejects(pay(owner,owner,'pi_self',null), /own listing/)
    await db.query('select public.moderate_listing($1,true,$2)',[listing,'admin@example.test'])
    await assert.rejects(pay(provider,owner,'pi_suspended'), /unavailable/)

    await db.exec('reset role; grant usage on schema auth to authenticated')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[provider])
    await db.exec('set role authenticated')
    await assert.rejects(pay(provider,owner,'pi_browser'), /permission denied/)
    await assert.rejects(db.query('select public.resolve_listing_trade($1,$2,$3)',[listing,owner,chat]), /permission denied/)
    await assert.rejects(db.query("update payments set role_review_required=false where stripe_payment_intent='pi_legacy_reversed'"), /Only your own confirmation/)
    await db.exec('reset role')
  } finally { await db.close() }
})
