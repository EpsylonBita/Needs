import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'

test('support messages are private and only the service role can persist or read them', async () => {
  const db = new PGlite()
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261013233747_support_requests.sql', import.meta.url), 'utf8'))
    await db.exec('set role service_role')
    await db.query('insert into support_requests(first_name,last_name,email,subject,message) values ($1,$2,$3,$4,$5)', ['Maria', 'Test', 'maria@example.com', 'Listing question', 'Please help with my listing.'])
    assert.equal((await db.query('select count(*)::int as count from support_requests')).rows[0].count, 1)
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`reset role; set role ${role}`)
      await assert.rejects(db.exec('select * from support_requests'), /permission denied/)
      await assert.rejects(db.exec("insert into support_requests(first_name,last_name,email,subject,message) values ('Other','Person','other@example.com','Bypass','A bypassed message.')"), /permission denied/)
    }
    await db.exec('reset role')
    assert.equal((await db.query("select relrowsecurity from pg_class where relname='support_requests'")).rows[0].relrowsecurity, true)
  } finally { await db.close() }
})
