-- Repair the legacy API grants while preserving the existing application schema.
-- Extension-owned relations (including PostGIS) are deliberately excluded.
do $$
declare target record;
begin
  for target in
    select n.nspname, c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass
        and d.objid = c.oid and d.deptype = 'e')
  loop
    execute format('revoke truncate, references, trigger on table %I.%I from public, anon, authenticated', target.nspname, target.relname);
  end loop;
end $$;

-- These records are consumed by validated server routes, never public clients.
alter table public.rate_limits enable row level security;
alter table public.moderation_logs enable row level security;
alter table public.payment_audit_logs enable row level security;
revoke all on public.rate_limits, public.moderation_logs, public.payment_audit_logs
  from public, anon, authenticated;
grant select, insert, update, delete on public.rate_limits, public.moderation_logs,
  public.payment_audit_logs to service_role;

-- UI capability checks remain public. Administrative changes go through the API.
alter table public.feature_flags enable row level security;
revoke all on public.feature_flags from public, anon, authenticated;
grant select on public.feature_flags to anon, authenticated;
grant select, insert, update, delete on public.feature_flags to service_role;
drop policy if exists feature_flags_public_read on public.feature_flags;
create policy feature_flags_public_read on public.feature_flags
  for select to anon, authenticated using (true);

-- The payment dashboard now uses an authorized server endpoint. Seller Stripe
-- account details also stay server-side; neither view has a browser consumer.
do $$
declare target text;
begin
  foreach target in array array['monthly_payments_agg', 'stripe_ready_sellers'] loop
    if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = target and c.relkind = 'v') then
      execute format('alter view public.%I set (security_invoker = true)', target);
      execute format('revoke all on public.%I from public, anon, authenticated', target);
      execute format('grant select on public.%I to service_role', target);
    end if;
  end loop;
end $$;

-- Legacy maintenance/write RPCs bypass RLS and have no browser callers. Restrict
-- every existing overload without depending on optional remote-only functions.
do $$
declare target record;
begin
  for target in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'upsert_user_location', 'log_audit_event', 'cleanup_expired_user_locations', 'cleanup_security_tables')
  loop
    execute format('revoke all on function %I.%I(%s) from public, anon, authenticated', target.nspname, target.proname, target.arguments);
    execute format('grant execute on function %I.%I(%s) to service_role', target.nspname, target.proname, target.arguments);
  end loop;
end $$;

-- Only trusted app metadata can establish an administrator. Legacy profiles
-- include user-editable role/is_admin values, which must not confer privileges.
create or replace function public.is_admin()
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'super_admin'), false);
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

do $$ begin
  if to_regclass('public.audit_logs') is not null then
    drop policy if exists audit_logs_select_admin on public.audit_logs;
    create policy audit_logs_select_admin on public.audit_logs for select
      to authenticated using ((select public.is_admin()));
  end if;
end $$;
