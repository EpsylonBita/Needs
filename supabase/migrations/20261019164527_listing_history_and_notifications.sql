-- Retain transaction and review history when an owner removes an advertisement.
-- Historical audit/order FKs incidentally protected some listings, but not all:
-- unpaid milestones, legacy reviews and payments without audit rows could cascade.
begin;

-- Use explicit referential protection as well as the friendly trigger below.
-- RESTRICT also protects concurrent inserts/deletes and trusted server callers.
alter table public.payments drop constraint if exists payments_listing_id_fkey;
alter table public.payments add constraint payments_listing_id_fkey
  foreign key (listing_id) references public.listings(id) on delete restrict;
alter table public.milestones drop constraint if exists milestones_listing_id_fkey;
alter table public.milestones add constraint milestones_listing_id_fkey
  foreign key (listing_id) references public.listings(id) on delete restrict;
alter table public.reviews drop constraint if exists reviews_listing_id_fkey;
alter table public.reviews add constraint reviews_listing_id_fkey
  foreign key (listing_id) references public.listings(id) on delete restrict;

create or replace function public.protect_listing_history()
returns trigger language plpgsql security definer set search_path = '' as $$
declare has_history boolean;
begin
  -- Definer access is deliberate: RLS-hidden counterparty/history rows must also
  -- prevent deletion. The error exposes no record identifiers or private data.
  select exists(select 1 from public.payments where listing_id = old.id)
    or exists(select 1 from public.milestones where listing_id = old.id)
    or exists(select 1 from public.reviews where listing_id = old.id)
    or exists(select 1 from public.payment_audit_logs where listing_id = old.id)
    into has_history;
  -- Older deployments can also have a separate orders table. Do not require
  -- that optional table in fresh installations or remove its retained records.
  if not has_history and to_regclass('public.orders') is not null then
    execute 'select exists(select 1 from public.orders where listing_id = $1)'
      into has_history using old.id;
  end if;
  if has_history then
    raise exception 'This listing has activity history and cannot be deleted. Pause it instead.'
      using errcode = '23503';
  end if;
  return old;
end;
$$;
revoke all on function public.protect_listing_history() from public, anon, authenticated;
drop trigger if exists protect_listing_history on public.listings;
create trigger protect_listing_history before delete on public.listings
  for each row execute function public.protect_listing_history();

-- Live notifications already have recipient-only SELECT/UPDATE policies.
-- Keep those policies and require recipient identity even if a future permissive
-- SELECT policy is added. Anonymous readers have no matching profile identity.
alter table public.notifications enable row level security;
drop policy if exists notifications_recipient_read_guard on public.notifications;
create policy notifications_recipient_read_guard on public.notifications
  as restrictive for select to public
  using (user_id in (select id from public.profiles where user_id = (select auth.uid())));

do $$ begin
  if not exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'The supabase_realtime publication must exist before enabling notifications';
  end if;
  if not exists(select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

commit;
