// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const root = resolve(process.cwd(), '../supabase')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')
const payer = '00000000-0000-4000-8000-000000000001'
const provider = '00000000-0000-4000-8000-000000000002'
const outsider = '00000000-0000-4000-8000-000000000003'
const listing = '00000000-0000-4000-8000-000000000004'
const payment = '00000000-0000-4000-8000-000000000005'
const legacyReview = '00000000-0000-4000-8000-000000000006'
let db: PGlite

async function asRole<T>(role: string, run: () => Promise<T>) {
  await db.exec(`set role ${role}`)
  try { return await run() } finally { await db.exec('reset role') }
}
const submit = (rating: number | string = 5, reviewer = payer) => db.query<{ id: string }>(
  'select public.submit_payment_review($1,$2,$3::numeric,$4) id', [payment, reviewer, rating, 'Helpful work'],
)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;`)
  // Use the actual legacy tables and policies; only unrelated geography/index
  // support is replaced, matching the repository's local database test strategy.
  await db.exec(read('sql/001_init.sql').replace('create extension if not exists postgis;', '').replace('geography(Point,4326)', 'text'))
  await db.exec(read('sql/002_indexes_policies.sql').replace('create index if not exists listings_location_gix on listings using gist (location);', ''))
  await db.exec(read('sql/020_fix_rls_identity_model.sql'))
  await db.exec(`grant select, update on payments to service_role;
    insert into auth.users values ('${payer}'),('${provider}'),('${outsider}');
    insert into profiles(id,user_id) values ('${payer}','${payer}'),('${provider}','${provider}'),('${outsider}','${outsider}');
    insert into listings(id,seller_id,title,description,price,main_category,sub_category,location)
      values('${listing}','${payer}','Request for help','The publisher is the payer',20,'Services','I want','fixture');
    insert into payments(id,listing_id,buyer_id,seller_id,amount,platform_fee,status)
      values('${payment}','${listing}','${payer}','${provider}',20,1,'completed');
    insert into reviews(id,listing_id,seller_id,reviewer_id,rating,comment)
      values('${legacyReview}','${listing}','${provider}','${outsider}',2,'Legacy text');`)
  await db.exec(read('migrations/20261019120200_review_eligibility.sql'))
}, 30000)

beforeEach(async () => {
  await db.exec(`delete from reviews where id <> '${legacyReview}'; update payments set status='completed' where id='${payment}';`)
})
afterAll(async () => { await db?.close() })

describe('Review database invariants', () => {
  it('preserves legacy content without assigning a payment or permitting silent verification', async () => {
    expect((await db.query('select payment_id,rating,comment from reviews where id=$1', [legacyReview])).rows[0]).toEqual({ payment_id: null, rating: 2, comment: 'Legacy text' })
    await expect(asRole('service_role', () => db.query('update reviews set payment_id=$1 where id=$2', [payment, legacyReview]))).rejects.toThrow('legacy review')
  })

  it('blocks direct browser insert/update and direct RPC execution', async () => {
    await asRole('authenticated', async () => {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [payer])
      await expect(db.query('insert into reviews(listing_id,seller_id,reviewer_id,rating) values($1,$2,$3,5)', [listing, provider, payer])).rejects.toThrow('permission denied')
      await expect(db.query('update reviews set rating=5 where id=$1', [legacyReview])).rejects.toThrow('permission denied')
      await expect(submit()).rejects.toThrow('permission denied')
    })
  })

  it('reviews the actual provider of a request, not its publisher', async () => {
    const result = await asRole('service_role', () => submit())
    expect((await db.query('select payment_id,listing_id,seller_id,reviewer_id,rating from reviews where id=$1', [result.rows[0].id])).rows[0])
      .toEqual({ payment_id: payment, listing_id: listing, seller_id: provider, reviewer_id: payer, rating: 5 })
  })

  it.each(['requires_capture', 'failed', 'refunded'])('rejects a %s payment', async status => {
    await db.query('update payments set status=$1 where id=$2', [status, payment])
    await expect(asRole('service_role', () => submit())).rejects.toThrow('not eligible')
  })

  it('rejects nonparticipants and the provider as reviewer', async () => {
    for (const reviewer of [outsider, provider]) await expect(asRole('service_role', () => submit(5, reviewer))).rejects.toThrow('not eligible')
  })

  it.each([0, 6, 1.5, 'NaN'])('rejects invalid numeric rating %s before integer conversion', async rating => {
    await expect(asRole('service_role', () => submit(rating))).rejects.toThrow('integer rating')
  })

  it('keeps exactly one review under competing submissions with a database unique invariant', async () => {
    await asRole('service_role', async () => {
      const outcomes = await Promise.allSettled([submit(5), submit(1)])
      expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
      const rejected = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult
      expect(rejected.reason.code).toBe('23505')
    })
    expect((await db.query('select count(*)::int n from reviews where payment_id=$1', [payment])).rows[0]).toEqual({ n: 1 })
  })

  it('rejects missing payment and mismatched seller/listing even for server table writes', async () => {
    await asRole('service_role', async () => {
      await expect(db.query('insert into reviews(listing_id,seller_id,reviewer_id,rating) values($1,$2,$3,5)', [listing, provider, payer])).rejects.toThrow('completed payment is required')
      await expect(db.query('insert into reviews(payment_id,listing_id,seller_id,reviewer_id,rating) values($1,$2,$3,$4,5)', [payment, listing, payer, payer])).rejects.toThrow('Only the payer')
      await expect(db.query('insert into reviews(payment_id,listing_id,seller_id,reviewer_id,rating) values($1,$2,$3,$4,5)', [payment, outsider, provider, payer])).rejects.toThrow('Only the payer')
    })
  })

  it('prevents reassignment of an existing review', async () => {
    const result = await asRole('service_role', () => submit())
    await expect(asRole('service_role', () => db.query('update reviews set reviewer_id=$1 where id=$2', [outsider, result.rows[0].id]))).rejects.toThrow('cannot be reassigned')
  })
})
