import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'

test('legacy grants are repaired without changing public reads or server access', async () => {
  const db = new PGlite()
  const migration = await readFile(new URL('../../../supabase/migrations/20261014001726_legacy_application_privileges.sql', import.meta.url), 'utf8')
  const privateTables = ['rate_limits', 'moderation_logs', 'payment_audit_logs']
  const maintenance = ['upsert_user_location', 'log_audit_event', 'cleanup_expired_user_locations', 'cleanup_security_tables']
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      grant usage on schema auth to anon, authenticated, service_role;
      create function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
      $$;
      create table public.listings(id integer primary key);
      create table public.profiles(id integer primary key, is_admin boolean, role text);
      insert into public.profiles values (1, true, 'admin');
      create table public.audit_logs(id integer primary key);
      insert into public.audit_logs values (1);
      alter table public.audit_logs enable row level security;
      create policy audit_logs_select_admin on public.audit_logs for select to authenticated using (true);
      create function public.is_admin() returns boolean language sql security definer as $$ select true $$;
      create table public.feature_flags(key text primary key, enabled boolean);
      insert into public.feature_flags values ('payments_enabled', false);
      create table public.extension_owned(id integer);
      alter extension plpgsql add table public.extension_owned;
      create view public.monthly_payments_agg as select * from public.listings;
      create view public.stripe_ready_sellers as select * from public.profiles;
    `)
    for (const table of privateTables) await db.exec(`create table public.${table}(id integer primary key)`)
    for (const fn of maintenance) await db.exec(`create function public.${fn}() returns integer language sql security definer as $$ select 1 $$`)
    await db.exec('grant all on all tables in schema public to anon, authenticated, service_role; grant execute on all functions in schema public to anon, authenticated, service_role;')

    // Demonstrate the old grant lets an anonymous role bypass row policies.
    await db.exec('insert into listings values (1); set role anon; truncate public.listings; reset role; insert into public.listings values (2);')
    await db.exec(migration)
    await db.exec(migration) // Safe to retry after a migration transaction rollback.

    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      assert.equal((await db.query('select * from listings')).rows.length, 1)
      await assert.rejects(db.exec('truncate public.listings'), /permission denied/)
      for (const privilege of ['TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        assert.equal((await db.query('select has_table_privilege(current_user, $1, $2) allowed', ['public.listings', privilege])).rows[0].allowed, false)
        assert.equal((await db.query('select has_table_privilege(current_user, $1, $2) allowed', ['public.extension_owned', privilege])).rows[0].allowed, true)
      }
      for (const table of privateTables) {
        await assert.rejects(db.exec(`select * from public.${table}`), /permission denied/)
        await assert.rejects(db.exec(`insert into public.${table} values (1)`), /permission denied/)
        await assert.rejects(db.exec(`delete from public.${table}`), /permission denied/)
      }
      assert.deepEqual((await db.query('select * from public.feature_flags')).rows, [{ key: 'payments_enabled', enabled: false }])
      await assert.rejects(db.exec("update public.feature_flags set enabled=true"), /permission denied/)
      for (const view of ['monthly_payments_agg', 'stripe_ready_sellers']) await assert.rejects(db.exec(`select * from public.${view}`), /permission denied/)
      for (const fn of maintenance) await assert.rejects(db.exec(`select public.${fn}()`), /permission denied/)
      await db.exec('reset role')
    }

    await db.exec('set role authenticated')
    for (const claims of [{}, { user_metadata: { role: 'admin' } }, { app_metadata: { role: 'user' } }]) {
      await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)])
      assert.equal((await db.query('select public.is_admin() allowed')).rows[0].allowed, false)
      assert.equal((await db.query('select * from audit_logs')).rows.length, 0)
    }
    for (const role of ['admin', 'super_admin']) {
      await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ app_metadata: { role } })])
      assert.equal((await db.query('select public.is_admin() allowed')).rows[0].allowed, true)
      assert.equal((await db.query('select * from audit_logs')).rows.length, 1)
    }

    await db.exec('reset role; set role service_role')
    for (const table of privateTables) {
      await db.exec(`insert into public.${table} values (1)`)
      assert.equal((await db.query(`select * from public.${table}`)).rows.length, 1)
    }
    await db.exec("update feature_flags set enabled=true")
    for (const view of ['monthly_payments_agg', 'stripe_ready_sellers']) assert.equal((await db.query(`select * from public.${view}`)).rows.length, 1)
    for (const fn of maintenance) assert.equal((await db.query(`select public.${fn}() value`)).rows[0].value, 1)
    await db.exec('reset role')
    for (const table of [...privateTables, 'feature_flags']) assert.equal((await db.query('select relrowsecurity from pg_class where relname=$1', [table])).rows[0].relrowsecurity, true)
    const views = await db.query("select reloptions from pg_class where relname in ('monthly_payments_agg','stripe_ready_sellers')")
    assert.equal(views.rows.every((row) => row.reloptions.includes('security_invoker=true')), true)
  } finally { await db.close() }
})
