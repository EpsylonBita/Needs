import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db=new PGlite()
const users=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003']
const profiles=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003']
const load=path=>readFile(new URL(`../../../supabase/${path}`,import.meta.url),'utf8')
const migration='migrations/20261019180549_owner_listing_editing.sql'
const table=(source,name)=>source.match(new RegExp(`create table if not exists ${name} \\([\\s\\S]*?\\n\\);`,'i'))[0]
const input={title:'Updated owner listing',description:'A corrected listing description.',price:100,main_category:'Items',sub_category:'Sell',coordinates:[23.73,37.98],address:{label:'Athens'},contact_number:null,tags:['local','used']}

async function as(user,sql,params=[],role='authenticated'){
  await db.exec(`set role ${role}`)
  try{await db.query("select set_config('test.user_id',$1,false)",[user||'']);return await db.query(sql,params)}
  finally{await db.exec('reset role');await db.query("select set_config('test.user_id','',false)")}
}
const rpc=async(user,sql,params=[])=> (await as(user,`select ${sql} as result`,params)).rows[0].result
const read=(id,user=users[0])=>rpc(user,'get_my_listing($1,$2)',[id,user])
const edit=(id,changes={},user=users[0])=>rpc(user,'update_my_listing($1,$2,$3)',[id,user,JSON.stringify({...input,...changes})])
async function listing(owner=profiles[0]){
  return (await db.query("insert into listings(seller_id,title,description,price,main_category,sub_category,location) values($1,'Original title','Original listing description',100,'Items','Sell','SRID=4326;POINT(22 38)') returning id",[owner])).rows[0].id
}
async function image(id,name='first.png'){
  const path=`${users[0]}/${id}/${name}`
  await as(users[0],"insert into storage.objects(name,bucket_id) values($1,'listing-images')",[path])
  return {storage_path:path,url:`https://fixture.supabase.co/storage/v1/object/public/listing-images/${path}`}
}

before(async()=>{
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user_id',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated,service_role;
    create table profiles(id uuid primary key,user_id uuid unique,display_name text,avatar_url text,title text,bio text,location text,cover_image text,role text,stripe_account_id text);
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(name text primary key,bucket_id text);
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated,service_role;
    grant all on storage.objects to authenticated,service_role;
    create publication supabase_realtime;
    -- PGlite lacks PostGIS. These narrow text-domain stand-ins exercise the actual
    -- SQL/RLS/transactions; production coordinate conversion is checked separately.
    create domain geography as text; create domain geometry as text;
    create function st_isempty(geometry) returns boolean language sql immutable as $$ select $1::text like '%EMPTY%' $$;
    create function st_x(geometry) returns double precision language sql immutable as $$ select substring($1::text from 'POINT\\(([-0-9.]+) ')::double precision $$;
    create function st_y(geometry) returns double precision language sql immutable as $$ select substring($1::text from ' ([-0-9.]+)\\)')::double precision $$;
    insert into profiles(id,user_id) values ('${profiles[0]}','${users[0]}'),('${profiles[1]}','${users[1]}'),('${profiles[2]}','${users[2]}');
  `)
  const initial=await load('sql/001_init.sql')
  for(const name of ['listings','listing_images','listing_tags','chats','chat_participants','messages','payments','reviews','notifications'])
    await db.exec(table(initial,name).replace('geography(Point,4326)','geography'))
  await db.exec(table(await load('sql/009_milestones.sql'),'milestones'))
  await db.exec(`
    alter table payments add column milestone_id uuid,add column currency text,add column chat_id uuid;
    create table payment_audit_logs(id uuid default gen_random_uuid(),payment_id uuid,listing_id uuid references listings(id),action text,buyer_id uuid,seller_id uuid,amount numeric,platform_fee numeric,metadata jsonb);
    create table moderation_logs(id uuid default gen_random_uuid(),admin_email text,listing_id uuid references listings(id) on delete cascade,action text,admin_notes text);
    alter table listings enable row level security;alter table listing_images enable row level security;
    alter table payments enable row level security;alter table reviews enable row level security;alter table milestones enable row level security;
    alter table notifications enable row level security;
    grant select on profiles,listings,listing_images,listing_tags to anon;
    grant all on all tables in schema public to authenticated,service_role;
  `)
  const policies=await load('sql/020_fix_rls_identity_model.sql')
  await db.exec(policies.split('-- Listings policies')[1].split('-- Chat participants policies')[0])
  await db.exec(policies.split('-- Notifications policies')[1].split('-- Grant necessary permissions')[0])
  await db.exec("create policy listings_select_active on listings for select using(status='active')")
  await db.exec(await load('migrations/20261013232103_chat_storage_repairs.sql'))
  await db.exec(await load('migrations/20261013232626_listing_fields_and_tag_policies.sql'))
  await db.exec(await load('migrations/20261019120300_listing_moderation.sql'))
  await db.exec(await load('migrations/20261019164527_listing_history_and_notifications.sql'))
  const trade=await load('migrations/20261019120100_request_offer_transactions.sql')
  await db.exec(trade.slice(trade.indexOf('create or replace function public.resolve_listing_trade'),trade.indexOf('-- Replace old signatures')))
  await db.exec(trade.slice(trade.indexOf('create or replace function public.create_listing_payment('),trade.indexOf('create or replace function public.create_milestone_payment(')))
  // Baseline: prior owner UPDATE grants permit changing category after a payment.
  const vulnerable=await listing()
  await db.query("insert into payments(listing_id,buyer_id,seller_id,amount,platform_fee,status) values($1,$2,$3,100,5,'completed')",[vulnerable,profiles[1],profiles[0]])
  await as(users[0],"update listings set sub_category='Buy' where id=$1",[vulnerable])
  assert.equal((await db.query('select sub_category from listings where id=$1',[vulnerable])).rows[0].sub_category,'Buy')
  await db.query("update listings set sub_category='Sell' where id=$1",[vulnerable])
  await db.exec(await load(migration));await db.exec(await load(migration))
})
after(async()=>db.close())

test('owner RPC returns canonical coordinates/tags/images and saves complete content atomically',async()=>{
  const id=await listing()
  const result=await edit(id,{tags:[' local ','local','used']})
  assert.equal(result.title,input.title);assert.equal(result.price,100)
  assert.deepEqual(result.coordinates,input.coordinates);assert.deepEqual(result.tags,['local','used'])
  assert.deepEqual(result.address,input.address);assert.equal(result.contact_number,null)
  assert.equal(result.can_edit,true);assert.equal(result.can_edit_images,true)
  assert.equal(result.category_locked,false);assert.equal(result.price_locked,false)
  const saved=await edit(id,{coordinates:null,address:null})
  assert.deepEqual(saved.coordinates,input.coordinates);assert.equal(saved.address,null)
  const mine=await rpc(users[0],'get_my_listings($1)',[users[0]])
  assert.ok(mine.some(row=>row.id===id))
  assert.equal((await rpc(users[2],'get_my_listings($1)',[users[2]])).length,0)
  await db.query("insert into listing_images(listing_id,url,main) values($1,'https://example.invalid/legacy.png',null)",[id])
  assert.equal((await read(id)).images[0].main,false,'nullable legacy main flag remains readable')
  await db.exec("alter table listing_tags add constraint fixture_tag_failure check(tag<>'fail-transaction') not valid")
  try{await assert.rejects(edit(id,{title:'Must not be saved',tags:['fail-transaction']}),/fixture_tag_failure/)}
  finally{await db.exec('alter table listing_tags drop constraint fixture_tag_failure')}
  assert.equal((await read(id)).title,input.title);assert.deepEqual((await read(id)).tags,['local','used'])
})

test('owner-only and expected-account checks cover every read/write RPC; no forged administrative fields',async()=>{
  const id=await listing()
  const calls=[['get_my_listing($1,$2)',[id,users[0]]],['get_my_listings($1)',[users[0]]],
    ['update_my_listing($1,$2,$3)',[id,users[0],JSON.stringify(input)]],['update_my_listing_status($1,$2,$3)',[id,'sold',users[0]]],
    ['delete_my_listing($1,$2)',[id,users[0]]],['attach_listing_images($1,$2,$3)',[id,'[]',users[0]]],
    ['set_main_listing_image($1,$2,$3)',[id,randomUUID(),users[0]]],['delete_listing_image($1,$2,$3)',[id,randomUUID(),users[0]]]]
  for(const [sql,params] of calls)await assert.rejects(rpc(users[1],sql,params),/account changed/)
  await assert.rejects(read(id,users[1]),/do not own/)
  await assert.rejects(edit(id,{},users[1]),/do not own/)
  await assert.rejects(as(null,'select get_my_listing($1,$2)',[id,users[0]],'anon'),/permission denied/)
  for(const field of ['seller_id','status','owner_status','moderation_suspended','id','created_at'])
    await assert.rejects(edit(id,{[field]:field==='moderation_suspended'?false:randomUUID()}),/Unsupported listing fields/)
  await assert.rejects(as(users[0],'select needs_private.listing_edit_flags($1)',[id]),/permission denied/)
  assert.equal((await read(id)).title,'Original title')
})

test('invalid input is rejected without partial tags/location updates and direct commercial writes cannot bypass invariants',async()=>{
  const id=await listing()
  for(const changes of [{title:'ab'},{description:'short'},{title:'x'.repeat(201)},{description:'x'.repeat(10001)},
    {price:-1},{price:12.123},{price:1e11},{coordinates:[181,0]},{coordinates:[0,91]},{coordinates:['1',2]},
    {coordinates:{}},{main_category:'Services',sub_category:'Sell'},{sub_category:'Free',price:1},
    {tags:Array.from({length:21},(_,i)=>`tag${i}`)},{tags:['']},{tags:['x'.repeat(51)]},{contact_number:'x'.repeat(51)},{address:'unverified string'}])
    await assert.rejects(edit(id,changes))
  assert.equal((await read(id)).title,'Original title');assert.deepEqual((await read(id)).coordinates,[22,38])
  await assert.rejects(as(users[0],"update listings set main_category='Services' where id=$1",[id]),/valid category/)
  await assert.rejects(as(users[0],"update listings set sub_category='Free' where id=$1",[id]),/zero price/)
  const free=await edit(id,{sub_category:'Free',price:0});assert.equal(free.price,0)
})

test('historical categories/free-paid type are retained, while only open payments and milestone budgets lock price',async()=>{
  for(const kind of ['completed-payment','open-payment','milestone','failed-milestone','review','order']){
    const id=await listing()
    if(kind.endsWith('payment'))await db.query('insert into payments(listing_id,buyer_id,seller_id,amount,platform_fee,status) values($1,$2,$3,100,5,$4)',[id,profiles[1],profiles[2],kind==='open-payment'?'requires_capture':'completed'])
    if(kind.includes('milestone'))await db.query('insert into milestones(listing_id,buyer_id,seller_id,title,amount,status) values($1,$2,$3,$4,30,$5)',[id,profiles[1],profiles[2],'Existing agreement',kind==='failed-milestone'?'failed':'pending'])
    if(kind==='review')await db.query('insert into reviews(listing_id,reviewer_id,seller_id,rating) values($1,$2,$3,5)',[id,profiles[1],profiles[0]])
    if(kind==='order'){
      await db.exec('create table if not exists orders(id uuid default gen_random_uuid(),listing_id uuid references listings(id))')
      await db.query('insert into orders(listing_id) values($1)',[id])
    }
    // Payment/milestone rows deliberately hidden by RLS must still lock owner edits.
    const flags=await read(id)
    assert.equal(flags.category_locked,true,kind)
    assert.equal(flags.price_locked,['open-payment','milestone'].includes(kind),kind)
    await assert.rejects(edit(id,{sub_category:'Buy'}),/transaction or review history/)
    await assert.rejects(edit(id,{price:0}),/free\/paid type/)
    await assert.rejects(as(users[0],"update listings set sub_category='Buy' where id=$1",[id]),/transaction or review history/)
    if(flags.price_locked)await assert.rejects(edit(id,{price:200}),/agreed price cannot change/)
    else assert.equal((await edit(id,{price:200})).price,200)
    assert.equal((await edit(id,{price:flags.price_locked?100:200,title:'Corrected historical listing'})).title,'Corrected historical listing')
  }
})

test('existing payment RPC and owner edits enforce both serialized orderings against the same listing terms',async()=>{
  const paymentFirst=await listing()
  await as(null,'select create_listing_payment($1,$2,$3,100,5,$4)',[paymentFirst,profiles[1],profiles[0],`pi_fixture_${randomUUID()}`],'service_role')
  await assert.rejects(edit(paymentFirst,{price:200}),/agreed price cannot change/)
  const editFirst=await listing()
  await edit(editFirst,{price:200})
  await assert.rejects(as(null,'select create_listing_payment($1,$2,$3,100,5,$4)',[editFirst,profiles[1],profiles[0],`pi_fixture_${randomUUID()}`],'service_role'),/Invalid listing payment/)
  await as(null,'select create_listing_payment($1,$2,$3,200,10,$4)',[editFirst,profiles[1],profiles[0],`pi_fixture_${randomUUID()}`],'service_role')
  assert.equal((await read(editFirst)).price_locked,true)
  // PGlite is single-session: these prove both legal serializations. Actual lock
  // contention is not simulated by Promise.all on one connection.
})

test('moderation holds allow private content correction but block status/delete/images through RPC and direct APIs',async()=>{
  const id=await listing();const img=await image(id)
  const images=await rpc(users[0],'attach_listing_images($1,$2,$3)',[id,JSON.stringify([img]),users[0]])
  await db.query('update listings set moderation_suspended=true where id=$1',[id])
  const corrected=await edit(id)
  assert.equal(corrected.status,'suspended');assert.equal(corrected.moderation_suspended,true)
  assert.equal(corrected.can_edit,true);assert.equal(corrected.can_edit_images,false)
  assert.equal((await as(null,'select id from listings where id=$1',[id],'anon')).rows.length,0)
  for(const [sql,params] of [['update_my_listing_status($1,$2,$3)',[id,'active',users[0]]],['delete_my_listing($1,$2)',[id,users[0]]],
    ['attach_listing_images($1,$2,$3)',[id,JSON.stringify([img]),users[0]]],['set_main_listing_image($1,$2,$3)',[id,images[0].id,users[0]]],
    ['delete_listing_image($1,$2,$3)',[id,images[0].id,users[0]]]])await assert.rejects(rpc(users[0],sql,params),/moderation|administrator/)
  assert.equal((await as(users[0],'delete from listing_images where id=$1 returning id',[images[0].id])).rows.length,0)
  assert.equal((await as(users[0],'update listing_images set main=false where id=$1 returning id',[images[0].id])).rows.length,0)
  assert.equal((await as(users[0],"delete from storage.objects where name=$1 returning name",[img.storage_path])).rows.length,0)
  await assert.rejects(as(users[0],"insert into storage.objects(name,bucket_id) values($1,'listing-images')",[`${users[0]}/${id}/blocked.png`]),/row-level security/)
  assert.equal((await db.query('select count(*)::int n from listing_images where listing_id=$1',[id])).rows[0].n,1)
})

test('photo attachment is atomic/idempotent, checks ownership/existence, and deleting main promotes one remaining image',async()=>{
  const id=await listing();const first=await image(id,'a.png');const second=await image(id,'b.png')
  let images=await rpc(users[0],'attach_listing_images($1,$2,$3)',[id,JSON.stringify([first,second]),users[0]])
  assert.equal(images.length,2);assert.equal(images.filter(image=>image.main).length,1)
  const again=await rpc(users[0],'attach_listing_images($1,$2,$3)',[id,JSON.stringify([first]),users[0]])
  assert.equal(again.length,2)
  const b=images.find(image=>image.storage_path===second.storage_path)
  images=await rpc(users[0],'set_main_listing_image($1,$2,$3)',[id,b.id,users[0]])
  assert.equal(images.find(image=>image.main).id,b.id)
  await as(users[0],'delete from storage.objects where name=$1',[second.storage_path])
  const deleted=await rpc(users[0],'delete_listing_image($1,$2,$3)',[id,b.id,users[0]])
  assert.equal(deleted.storage_path,second.storage_path)
  images=(await read(id)).images;assert.equal(images.length,1);assert.equal(images[0].main,true)
  const fresh=await image(id,'c.png')
  await assert.rejects(rpc(users[0],'attach_listing_images($1,$2,$3)',[id,JSON.stringify([fresh,{...fresh,storage_path:`${users[1]}/${id}/foreign.png`}]),users[0]]),/does not belong/)
  assert.equal((await read(id)).images.length,1,'failed second attachment rolls back first metadata insert')
  await assert.rejects(rpc(users[1],'attach_listing_images($1,$2,$3)',[id,JSON.stringify([fresh]),users[1]]),/do not own/)
  const missing={storage_path:`${users[0]}/${id}/missing.png`,url:`https://fixture.supabase.co/storage/v1/object/public/listing-images/${users[0]}/${id}/missing.png`}
  await assert.rejects(rpc(users[0],'attach_listing_images($1,$2,$3)',[id,JSON.stringify([missing]),users[0]]),/Upload the image/)
  const bucket=(await db.query("select file_size_limit,allowed_mime_types from storage.buckets where id='listing-images'")).rows[0]
  assert.equal(bucket.file_size_limit,5242880);assert.deepEqual(bucket.allowed_mime_types,['image/jpeg','image/png','image/webp','image/gif'])
})

test('owner status changes preserve guards and delete still protects history; orphaned owner files remain removable',async()=>{
  const unused=await listing();const img=await image(unused)
  assert.equal((await rpc(users[0],'update_my_listing_status($1,$2,$3)',[unused,'suspended',users[0]])).status,'suspended')
  assert.equal((await rpc(users[0],'update_my_listing_status($1,$2,$3)',[unused,'active',users[0]])).status,'active')
  await rpc(users[0],'delete_my_listing($1,$2)',[unused,users[0]])
  assert.equal((await as(users[0],'delete from storage.objects where name=$1 returning name',[img.storage_path])).rows.length,1)
  const retained=await listing()
  await db.query('insert into reviews(listing_id,reviewer_id,seller_id,rating) values($1,$2,$3,4)',[retained,profiles[1],profiles[0]])
  await assert.rejects(rpc(users[0],'delete_my_listing($1,$2)',[retained,users[0]]),/Pause it instead/)
})
