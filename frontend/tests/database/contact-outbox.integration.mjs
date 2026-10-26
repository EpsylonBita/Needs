import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'

const submitSql = 'select * from submit_support_request($1,$2,$3,$4,$5,$6,$7)'
const message = ['a'.repeat(64), 'Maria', 'Test', 'maria@example.com', 'Question', 'Please help with this listing.']
const claimSql = "select * from claim_support_notifications($1,1,'support@example.com','contact@example.com')"

test('contact outbox deduplicates submissions, leases work, bounds retries and remains private', async () => {
  const db = new PGlite()
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261013233747_support_requests.sql', import.meta.url), 'utf8'))
    await db.exec("insert into support_requests(first_name,last_name,email,subject,message) values ('Legacy','Contact','legacy@example.com','Old request','This was saved before notifications.')")
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261014085736_support_notification_outbox.sql', import.meta.url), 'utf8'))
    await db.exec('set role service_role')
    assert.equal((await db.query("select notification_status from support_requests where email='legacy@example.com'")).rows[0].notification_status, 'not_requested')

    const key = '11111111-1111-4111-8111-111111111111'
    const first = (await db.query(submitSql, [key, ...message])).rows[0]
    const duplicate = (await db.query(submitSql, [key, ...message])).rows[0]
    assert.equal(first.request_id, duplicate.request_id)
    assert.equal((await db.query('select count(*)::int total from support_requests')).rows[0].total, 2)
    await assert.rejects(db.query(submitSql, [key, 'b'.repeat(64), ...message.slice(1)]), /another message/)

    const claim = (await db.query(claimSql, [first.request_id])).rows[0]
    assert.equal(claim.notification_attempts, 1)
    assert.ok(claim.notification_first_attempt_at)
    assert.equal(claim.notification_to, 'support@example.com')
    assert.equal(claim.notification_from, 'contact@example.com')
    assert.equal((await db.query(claimSql, [first.request_id])).rows.length, 0)
    await db.query("update support_requests set notification_claim_until=now()-interval '1 second' where id=$1", [first.request_id])
    const reclaimed = (await db.query("select * from claim_support_notifications($1,1,'changed@example.com','changed-sender@example.com')", [first.request_id])).rows[0]
    assert.equal(reclaimed.notification_to, claim.notification_to)
    assert.equal(reclaimed.notification_from, claim.notification_from)
    assert.equal(String(reclaimed.notification_first_attempt_at), String(claim.notification_first_attempt_at))
    assert.notEqual(reclaimed.notification_claim_token, claim.notification_claim_token)
    assert.equal((await db.query('select finish_support_notification($1,$2,true,$3,null) finished', [first.request_id, claim.notification_claim_token, 'stale-attempt'])).rows[0].finished, false)
    assert.equal((await db.query('select finish_support_notification($1,$2,true,$3,null) finished', [first.request_id, reclaimed.notification_claim_token, 'provider-accepted'])).rows[0].finished, true)
    assert.equal((await db.query(claimSql, [first.request_id])).rows.length, 0)
    assert.equal((await db.query(submitSql, [key, ...message])).rows[0].notification_status, 'accepted')

    const retry = (await db.query(submitSql, ['22222222-2222-4222-8222-222222222222', ...message])).rows[0]
    for (let attempt = 1; attempt <= 5; attempt++) {
      const work = (await db.query(claimSql, [retry.request_id])).rows[0]
      assert.equal(work.notification_attempts, attempt)
      await db.query('select finish_support_notification($1,$2,false,null,$3)', [retry.request_id, work.notification_claim_token, 'raw provider message with private content'])
      const row = (await db.query('select * from support_requests where id=$1', [retry.request_id])).rows[0]
      assert.equal(row.notification_error_code, 'provider_unavailable')
      assert.equal(row.notification_status, attempt === 5 ? 'failed' : 'pending')
      assert.equal((await db.query(claimSql, [retry.request_id])).rows.length, 0)
      await db.query("update support_requests set notification_available_at=now()-interval '1 second' where id=$1", [retry.request_id])
    }

    const expired = (await db.query(submitSql, ['33333333-3333-4333-8333-333333333333', ...message])).rows[0]
    // A message saved before provider configuration still gets a first attempt days later.
    await db.query("update support_requests set created_at=now()-interval '7 days' where id=$1", [expired.request_id])
    const delayedFirst = (await db.query(claimSql, [expired.request_id])).rows[0]
    assert.equal(delayedFirst.notification_attempts, 1)
    assert.ok(new Date(delayedFirst.notification_first_attempt_at).getTime() > Date.now() - 60_000)
    await db.query("update support_requests set notification_first_attempt_at=now()-interval '24 hours', notification_claim_until=now()-interval '1 second' where id=$1", [expired.request_id])
    assert.equal((await db.query(claimSql, [expired.request_id])).rows.length, 0)
    assert.equal((await db.query('select notification_status from support_requests where id=$1', [expired.request_id])).rows[0].notification_status, 'failed')

    const unconfigured = (await db.query(submitSql, ['44444444-4444-4444-8444-444444444444', ...message])).rows[0]
    await assert.rejects(db.query('select * from claim_support_notifications($1,1)', [unconfigured.request_id]), /not configured/)
    const untouched = (await db.query('select notification_attempts, notification_first_attempt_at from support_requests where id=$1', [unconfigured.request_id])).rows[0]
    assert.equal(untouched.notification_attempts, 0)
    assert.equal(untouched.notification_first_attempt_at, null)

    for (const role of ['anon', 'authenticated']) {
      await db.exec(`reset role; set role ${role}`)
      await assert.rejects(db.query(submitSql, [key, ...message]), /permission denied/)
      await assert.rejects(db.exec('select * from claim_support_notifications()'), /permission denied/)
      await assert.rejects(db.query('select finish_support_notification($1,$2,true,null,null)', [first.request_id, claim.notification_claim_token]), /permission denied/)
      await assert.rejects(db.exec('select * from support_requests'), /permission denied/)
    }
  } finally { await db.close() }
})
