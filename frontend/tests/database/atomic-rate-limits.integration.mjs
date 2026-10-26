import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../../../supabase/migrations/20261026140000_atomic_rate_limits.sql', import.meta.url), 'utf8')
const schema = await readFile(new URL('../../../supabase/sql/015_rate_limits.sql', import.meta.url), 'utf8')

async function fixture(run) {
  const db = new PGlite()
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
    await db.exec(schema)
    await db.exec(migration)
    await db.exec(migration)
    await run(db)
  } finally { await db.close() }
}

const consume = async (db, key, limit = 7, windowMs = 86_400_000) => (
  await db.query('select public.consume_rate_limit($1, $2, $3) result', [key, limit, windowMs])
).rows[0].result

test('atomic counter admits only the quota and does not increment rejected requests', async () => fixture(async (db) => {
  await db.exec('set role service_role')
  // PGlite queues one connection; this verifies SQL behavior, not multi-session load.
  const results = await Promise.all(Array.from({ length: 25 }, () => consume(db, 'payments:user')))
  assert.equal(results.filter(result => result.allowed).length, 7)
  assert.equal(results.filter(result => !result.allowed).length, 18)
  assert.deepEqual(results.filter(result => result.allowed).map(result => result.remaining).sort(), [0, 1, 2, 3, 4, 5, 6])
  assert.equal((await db.query('select count from public.rate_limits where key=$1', ['payments:user'])).rows[0].count, 7)
  for (const result of results.filter(result => !result.allowed)) {
    assert.equal(result.remaining, 0)
    assert.ok(result.retry_after > 0 && result.retry_after <= 86400)
    assert.ok(Date.parse(result.reset_at) > Date.now())
  }
  assert.equal((await consume(db, 'payments:other')).allowed, true)
}))

test('expired windows do not consume the current quota and existing current counters are honored', async () => fixture(async (db) => {
  await db.exec('set role service_role')
  await db.query("insert into rate_limits(key, window_start, count) values ($1, now() - interval '2 days', 100)", ['expired'])
  const first = await consume(db, 'expired', 1)
  assert.equal(first.allowed, true)
  assert.equal(first.remaining, 0)
  assert.equal(first.retry_after, 0)
  assert.equal((await consume(db, 'expired', 1)).allowed, false)
  assert.equal((await db.query('select count(*)::integer count from rate_limits where key=$1', ['expired'])).rows[0].count, 2)
}))

test('only service_role may consume or modify rate limits', async () => fixture(async (db) => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    await assert.rejects(consume(db, 'forbidden'), /permission denied/)
    await assert.rejects(db.query('select * from public.rate_limits'), /permission denied/)
    await assert.rejects(db.query("insert into rate_limits values ('forbidden', now(), 0)"), /permission denied/)
    await db.exec('reset role')
  }
  await db.exec('set role service_role')
  assert.equal((await consume(db, 'allowed')).allowed, true)
}))

test('invalid parameters cannot consume quota', async () => fixture(async (db) => {
  await db.exec('set role service_role')
  for (const args of [[null, 2, 1000], ['', 2, 1000], [' '.repeat(3), 2, 1000], ['x'.repeat(513), 2, 1000], ['bad', 0, 1000], ['bad', null, 1000], ['bad', 2, 0], ['bad', 2, null]]) {
    await assert.rejects(consume(db, ...args), /Invalid rate limit configuration/)
  }
  assert.equal((await db.query('select count(*)::integer count from rate_limits')).rows[0].count, 0)
}))
