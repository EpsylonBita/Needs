import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db=new PGlite()
const users=Array.from({length:3},()=>randomUUID())
const profiles=Array.from({length:3},()=>randomUUID())
const read=path=>readFile(new URL(`../../../supabase/${path}`,import.meta.url),'utf8')
const migration='migrations/20261019183527_participant_orders.sql'
function table(source,name){const start=source.toLowerCase().indexOf(`create table if not exists ${name} (`);return source.slice(start,source.indexOf(');',start)+2)}
async function as(user,sql,params=[],role='authenticated'){
  await db.exec(`set role ${role}`)
  try{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);return await db.query(sql,params)}
  finally{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)")}
}
const rpc=async(user,fn,params=[],role='authenticated')=>(await as(user,`select ${fn} as value`,params,role)).rows[0].value
const detail=(id,user=users[0])=>rpc(user,'get_my_order($1,$2)',[id,user])
const confirm=(id,user=users[0])=>rpc(null,'confirm_order($1,$2)',[id,user],'service_role')
const claim=(id,user=users[0])=>rpc(null,'claim_order_capture($1,$2)',[id,user],'service_role')
const complaint=(id,buyer=profiles[0])=>rpc(null,'open_payment_complaint($1,$2)',[id,buyer],'service_role')
async function event(id,type='payment_intent.amount_capturable_updated'){
  const row=(await db.query('select stripe_payment_intent,amount from payments where id=$1',[id])).rows[0]
  return rpc(null,'process_stripe_webhook_event($1,$2,$3)',[JSON.stringify({id:`evt_${randomUUID()}`,type,data:{object:{id:row.stripe_payment_intent,amount:Number(row.amount)*100,amount_capturable:Number(row.amount)*100}}}),row.stripe_payment_intent,'orders-test'],'service_role')
}
async function payment({request=false,authorized=false,milestone=false,status='requires_capture',created_at='2026-10-19T10:00:00Z',other=false,hidden=false}={}){
  const buyer=other?profiles[2]:profiles[0],seller=profiles[1],listing=randomUUID(),id=randomUUID(),intent=`pi_${randomUUID()}`,chat=randomUUID()
  await db.query('insert into listings(id,seller_id,title,price,status,main_category,sub_category) values($1,$2,$3,100,$4,$5,$6)',[listing,request?buyer:seller,request?'Wanted bicycle':'Bicycle offer',hidden?'suspended':'active','Items',request?'Buy':'Sell'])
  await db.query("insert into chats(id,type,listing_id)values($1,'direct',$2)",[chat,listing])
  await db.query('insert into chat_participants(chat_id,user_id)values($1,$2),($1,$3)',[chat,buyer,seller])
  await db.query("insert into listing_images(listing_id,url,main)values($1,'https://fixture.invalid/image.png',true)",[listing])
  const mid=milestone?randomUUID():null
  if(mid)await db.query("insert into milestones(id,listing_id,buyer_id,seller_id,title,amount,stripe_payment_intent,currency,chat_id)values($1,$2,$3,$4,'Delivery',100,$5,'eur',$6)",[mid,listing,buyer,seller,intent,chat])
  await db.query('insert into payments(id,listing_id,buyer_id,seller_id,amount,platform_fee,stripe_payment_intent,status,currency,milestone_id,chat_id,created_at,buyer_confirmed,seller_confirmed)values($1,$2,$3,$4,100,5,$5,$6,$7,$8,$9,$10,$11,$11)',[id,listing,buyer,seller,intent,status,'eur',mid,chat,created_at,status==='completed'])
  if(authorized)await event(id)
  return {id,listing,chat,mid,intent,buyer,seller}
}

before(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,service_role;
    create table profiles(id uuid primary key,user_id uuid unique,display_name text,avatar_url text);
    create table listings(id uuid primary key,seller_id uuid references profiles(id),title text,price numeric,status text,main_category text,sub_category text);
    create table feature_flags(key text primary key,enabled boolean);
    create table chats(id uuid primary key,type text,listing_id uuid references listings(id));
    create table chat_participants(chat_id uuid references chats(id),user_id uuid references profiles(id),left_at timestamptz,primary key(chat_id,user_id));`)
  const initial=await read('sql/001_init.sql')
  for(const name of ['listing_images','payments','transactions','disputes','notifications','reviews'])await db.exec(table(initial,name))
  await db.exec(await read('sql/004_payment_confirmations.sql'))
  await db.exec(await read('sql/009_milestones.sql'))
  const security=await read('sql/021_fix_payment_security.sql')
  await db.exec(table(security,'payment_audit_logs'))
  await db.exec(security.split('-- Add payment audit log table')[0])
  for(const name of ['013_webhook_events.sql','023_webhook_events_extended.sql','024_payments_intent_unique.sql','025_payments_transactions_disputes_milestones_columns.sql','026_payment_atomic_functions.sql','027_payments_open_intent_unique.sql','028_payment_atomic_function.sql'])await db.exec(await read(`sql/${name}`))
  await db.exec(await read('migrations/20261013232046_webhook_event_atomic_processing.sql'))
  await db.exec(await read('migrations/20261014085831_payment_dispute_workflow.sql'))
  await db.exec(await read('migrations/20261019120100_request_offer_transactions.sql'))
  await db.exec(await read('migrations/20261019120200_review_eligibility.sql'))
  const policies=await read('sql/020_fix_rls_identity_model.sql')
  await db.exec(policies.split('-- Payment policies')[1].split('-- Reviews policies')[0])
  await db.exec(`alter table payments enable row level security;alter table payment_audit_logs enable row level security;
    grant select on profiles to authenticated;grant select,update on payments,milestones to authenticated;
    grant insert on payment_audit_logs to authenticated;
    grant all on all tables in schema public to service_role;`)
  for(let i=0;i<3;i++)await db.query('insert into profiles(id,user_id,display_name)values($1,$2,$3)',[profiles[i],users[i],['Buyer','Provider','Outsider'][i]])
  // Demonstrate the old gap before applying the fix: unverified own-side
  // confirmations can be freely set then withdrawn through authenticated SQL.
  const vulnerable=await payment()
  await as(users[0],'update payments set buyer_confirmed=true where id=$1',[vulnerable.id])
  await as(users[0],'update payments set buyer_confirmed=false where id=$1',[vulnerable.id])
  assert.equal((await db.query('select buyer_confirmed from payments where id=$1',[vulnerable.id])).rows[0].buyer_confirmed,false)
  await db.exec(await read(migration));await db.exec(await read(migration))
})
after(async()=>db.close())

test('participant read handles request/offer roles and hidden listings without leaking another order',async()=>{
  for(const request of[false,true]){
    const p=await payment({request,hidden:true})
    const buyer=await detail(p.id),seller=await detail(p.id,users[1])
    assert.equal(buyer.my_role,'buyer');assert.equal(seller.my_role,'seller')
    assert.equal(buyer.buyer.id,profiles[0]);assert.equal(buyer.seller.id,profiles[1])
    assert.equal(buyer.listing.available,false);assert.equal(buyer.listing.title,request?'Wanted bicycle':'Bicycle offer')
    assert.equal(buyer.listing.thumbnail,'https://fixture.invalid/image.png');assert.equal(buyer.chat_id,p.chat)
    assert.equal(buyer.payments_enabled,false)
    await assert.rejects(detail(p.id,users[2]),/Order not found/)
    await assert.rejects(rpc(users[1],'get_my_order($1,$2)',[p.id,users[0]]),/account changed/)
    await assert.rejects(rpc(null,'get_my_order($1,$2)',[p.id,users[0]],'anon'),/permission denied/)
    await db.query('delete from chat_participants where chat_id=$1 and user_id=$2',[p.chat,profiles[0]])
    assert.equal((await detail(p.id)).chat_id,null)
  }
})

test('keyset pagination preserves equal timestamps, bounded sizes, null legacy dates and party isolation',async()=>{
  const made=[]
  for(let i=0;i<5;i++)made.push(await payment({created_at:'2099-01-01T00:00:00Z'}))
  const foreign=await payment({other:true,created_at:'2100-01-01T00:00:00Z'})
  const legacy=await payment({created_at:null})
  const sorted=made.map(x=>x.id).sort().reverse()
  const first=await rpc(users[0],'get_my_orders($1,$2,$3,$4)',[users[0],null,null,2])
  assert.deepEqual(first.rows.map(x=>x.id),sorted.slice(0,2));assert.equal(first.profile_id,profiles[0])
  const second=await rpc(users[0],'get_my_orders($1,$2,$3,$4)',[users[0],first.next_cursor.created_at,first.next_cursor.id,2])
  assert.deepEqual(second.rows.map(x=>x.id),sorted.slice(2,4));assert.ok(!second.rows.some(x=>x.id===foreign.id))
  const last=await rpc(users[0],'get_my_orders($1,$2,$3,$4)',[users[0],'1970-01-01T00:00:01Z',randomUUID(),100])
  assert.ok(last.rows.some(x=>x.id===legacy.id));assert.equal(last.next_cursor,null)
  for(const args of[[users[0],null,null,0],[users[0],null,null,101],[users[0],null,randomUUID(),20]])await assert.rejects(rpc(users[0],'get_my_orders($1,$2,$3,$4)',args),/Invalid orders page/)
  await db.exec("insert into feature_flags values('payments_enabled',true)")
  assert.equal((await detail(made[0].id)).payments_enabled,true)
  await db.exec("delete from feature_flags where key='payments_enabled'")
})

test('authorization requires real webhook evidence, not requires_capture or a milestone label',async()=>{
  const p=await payment({milestone:true})
  await db.query("update milestones set status='requires_capture' where id=$1",[p.mid])
  assert.equal((await detail(p.id)).authorization_state,'unverified')
  await assert.rejects(confirm(p.id),/cannot be confirmed/)
  await assert.rejects(complaint(p.id),/not been verified/)
  await assert.rejects(as(users[0],"insert into payment_audit_logs(payment_id,action)values($1,'payment_authorized')",[p.id]),/row-level security/)
  await event(p.id)
  const authorized=await detail(p.id)
  assert.equal(authorized.authorization_state,'authorized');assert.equal(authorized.actions.can_confirm,true)
  assert.equal(authorized.actions.can_complain,true)
})

test('confirmation is canonical, monotone, caller-only and immune to an unrelated retried milestone',async()=>{
  const p=await payment({authorized:true,milestone:true})
  await db.query('update milestones set seller_confirmed=true where id=$1',[p.mid])
  assert.equal((await detail(p.id)).seller_confirmed,true)
  const result=await confirm(p.id)
  assert.equal(result.buyer_confirmed,true);assert.equal(result.seller_confirmed,true);assert.equal(result.actions.can_capture,true)
  assert.equal((await confirm(p.id)).buyer_confirmed,true,'lost-response retry is idempotent')
  await assert.rejects(confirm(p.id,users[2]),/Order not found/)
  await assert.rejects(as(users[0],'update payments set buyer_confirmed=false where id=$1',[p.id]),/cannot be withdrawn/)
  await assert.rejects(as(users[0],'update payments set seller_confirmed=true where id=$1',[p.id]),/own confirmation/)
  await assert.rejects(as(users[0],'update payments set amount=1 where id=$1',[p.id]),/own confirmation/)
  await db.query("update milestones set stripe_payment_intent='pi_new_attempt' where id=$1",[p.mid])
  assert.equal((await detail(p.id)).seller_confirmed,false);assert.equal((await detail(p.id)).milestone,null)
})

test('direct browser updates cannot confirm unverified, held, disputed, settled or pending-capture records',async()=>{
  for(const state of['unverified','held','disputed','completed','capturing']){
    const p=await payment({authorized:state!=='unverified',milestone:true})
    if(state==='held')await db.query('update payments set role_review_required=true where id=$1',[p.id])
    if(state==='disputed')await complaint(p.id)
    if(state==='completed')await db.query("update payments set status='failed' where id=$1",[p.id])
    if(state==='capturing')await db.query('update payments set capture_claim_id=gen_random_uuid() where id=$1',[p.id])
    await assert.rejects(as(users[0],'update payments set buyer_confirmed=true where id=$1',[p.id]),/cannot be confirmed/)
    await assert.rejects(as(users[0],'update milestones set buyer_confirmed=true where id=$1',[p.mid]),/cannot be confirmed/)
    await assert.rejects(confirm(p.id),/cannot be confirmed/)
  }
  const valid=await payment({authorized:true,milestone:true})
  await as(users[0],'update milestones set buyer_confirmed=true where id=$1',[valid.mid])
  assert.equal((await detail(valid.id)).buyer_confirmed,true)
  await assert.rejects(as(users[0],'update milestones set buyer_confirmed=null where id=$1',[valid.mid]),/cannot be withdrawn/)
})

test('capture claim and complaint serialize in both orders, with stable retry ownership and no timeout release',async()=>{
  const first=await payment({authorized:true})
  await confirm(first.id);await confirm(first.id,users[1])
  const reserved=await claim(first.id,users[1]),retry=await claim(first.id)
  assert.equal(reserved.claim_id,retry.claim_id);assert.equal(reserved.status,'claimed')
  assert.equal((await detail(first.id)).capture_pending,true)
  await assert.rejects(complaint(first.id),/being reconciled/)
  await assert.rejects(claim(first.id,users[2]),/Order not found/)
  await assert.rejects(rpc(null,'resolve_order_capture($1,$2,$3)',[first.id,randomUUID(),'not_captured'],'service_role'),/does not match/)
  await assert.rejects(rpc(null,'resolve_order_capture($1,$2,$3)',[first.id,reserved.claim_id,'unknown'],'service_role'),/Unknown/)
  await rpc(null,'resolve_order_capture($1,$2,$3)',[first.id,reserved.claim_id,'captured'],'service_role')
  assert.equal((await detail(first.id)).status,'requires_capture');assert.equal((await detail(first.id)).capture_pending,true)
  await assert.rejects(complaint(first.id),/being reconciled/)
  await rpc(null,'resolve_order_capture($1,$2,$3)',[first.id,reserved.claim_id,'not_captured'],'service_role')
  assert.equal((await detail(first.id)).capture_pending,false)
  const opened=await complaint(first.id)
  assert.equal((await complaint(first.id)).dispute_id,opened.dispute_id)
  await assert.rejects(claim(first.id),/without an open dispute/)
  // PGlite serializes statements; both legal lock acquisition orders are tested.
  // A multi-connection database is required to demonstrate actual blocking.
})

test('webhook settlement clears effective reservation and exposes support/refund/review state truthfully',async()=>{
  const p=await payment({authorized:true,milestone:true})
  await confirm(p.id);await confirm(p.id,users[1]);const reserved=await claim(p.id)
  await event(p.id,'payment_intent.succeeded')
  const settled=await detail(p.id)
  assert.equal(settled.status,'completed');assert.equal(settled.authorization_state,'settled');assert.equal(settled.capture_pending,false)
  assert.equal(settled.actions.can_capture,false);assert.equal(settled.actions.can_review,true);assert.equal(settled.actions.can_complain,true)
  assert.equal((await claim(p.id)).status,'completed')
  await complaint(p.id)
  await db.query("insert into transactions(payment_id,type,amount,status)values($1,'refund',20,'succeeded'),($1,'refund',30,'pending'),($1,'refund',10,'failed'),($1,'refund',100,'superseded')",[p.id])
  const refund=await detail(p.id);assert.deepEqual(refund.refund,{succeeded_amount:20,pending_amount:30,failed:true})
  assert.equal(refund.complaint.status,'open');assert.equal(refund.actions.can_complain,false)
  await rpc(null,'submit_payment_review($1,$2,$3,$4)',[p.id,profiles[0],5,'Delivered'],'service_role')
  assert.equal((await detail(p.id)).actions.can_review,false);assert.equal((await detail(p.id)).review.rating,5)
  assert.equal(reserved.intent_id,p.intent)
})

test('browser roles cannot invoke service mutations, private projections or fake capture/financial state',async()=>{
  const p=await payment({authorized:true})
  for(const role of['anon','authenticated'])for(const fn of['confirm_order(uuid,uuid)','claim_order_capture(uuid,uuid)','resolve_order_capture(uuid,uuid,text)','open_payment_complaint(uuid,uuid)','needs_private.order_json(uuid,uuid)'])
    assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,fn])).rows[0].allowed,false,`${role}:${fn}`)
  for(const field of['capture_claim_id','stripe_payment_intent','status']){
    const value=field==='capture_claim_id'?randomUUID():field==='status'?'failed':'pi_forged'
    await assert.rejects(as(users[0],`update payments set ${field}=$2 where id=$1`,[p.id,value]),/own confirmation/)
  }
  assert.equal((await detail(p.id)).capture_pending,false)
})
