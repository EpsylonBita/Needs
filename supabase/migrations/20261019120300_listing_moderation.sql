-- Keep owner visibility separate from an administrator's moderation hold.
-- status remains the effective visibility used by public search and payments.
begin;

alter table public.listings
  add column owner_status text not null default 'active'
    check (owner_status in ('active', 'sold', 'suspended')),
  add column moderation_suspended boolean not null default false;

-- Historical suspended rows do not record who suspended them. Treat them as
-- held and paused: neither migration nor release may silently republish them.
update public.listings set owner_status = status,
  moderation_suspended = (status = 'suspended');
alter table public.listings add constraint listings_moderation_visibility
  check (status = case when moderation_suspended then 'suspended' else owner_status end);

create or replace function public.enforce_listing_moderation()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare browser_caller boolean := current_user in ('anon', 'authenticated');
begin
  if tg_op = 'DELETE' then
    if browser_caller and old.moderation_suspended then
      raise exception 'This listing is held for moderation and cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if browser_caller and new.moderation_suspended then
      raise exception 'Only an administrator may set moderation state' using errcode = '42501';
    end if;
    new.owner_status := new.status;
  else
    if browser_caller then
      if new.id is distinct from old.id or new.seller_id is distinct from old.seller_id
        or new.moderation_suspended is distinct from old.moderation_suspended
        or new.owner_status is distinct from old.owner_status then
        raise exception 'Listing identity and moderation state are protected' using errcode = '42501';
      end if;
      if old.moderation_suspended and new.status is distinct from old.status then
        raise exception 'An administrator must release this listing before its status can change' using errcode = '42501';
      end if;
    end if;
    if new.status is distinct from old.status then
      new.owner_status := new.status;
    end if;
  end if;
  new.status := case when new.moderation_suspended then 'suspended' else new.owner_status end;
  return new;
end;
$$;
revoke all on function public.enforce_listing_moderation() from public, anon, authenticated;
create trigger enforce_listing_moderation before insert or update or delete
  on public.listings for each row execute function public.enforce_listing_moderation();

-- Remove both table and any legacy column grants before allowing owner fields.
revoke insert, update, truncate, references, trigger on public.listings from public, anon, authenticated;
do $$ declare columns text; begin
  select string_agg(quote_ident(attname), ', ') into columns
    from pg_attribute where attrelid = 'public.listings'::regclass and attnum > 0 and not attisdropped;
  execute format('revoke insert (%s), update (%s) on public.listings from public, anon, authenticated', columns, columns);
end $$;
grant insert (id, seller_id, title, description, price, main_category, sub_category, status, location, address, contact_number)
  on public.listings to authenticated;
grant update (title, description, price, main_category, sub_category, status, location, address, contact_number)
  on public.listings to authenticated;
grant select, insert, update, delete on public.listings to service_role;
-- The invoker RPC must be able to append its audit record without relying on
-- project default privileges or the earlier legacy-grants repair.
grant select, insert on public.moderation_logs to service_role;

drop policy if exists listings_select_active on public.listings;
create policy listings_select_active on public.listings for select to anon, authenticated
  using (status = 'active' and not moderation_suspended);

-- Only the validated administrative API may call this transaction. A failed
-- audit insert rolls the hold/release back as well.
create or replace function public.moderate_listing(
  p_listing_id uuid, p_suspended boolean, p_admin_email text, p_note text default ''
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare target public.listings;
begin
  if p_suspended is null or nullif(btrim(p_admin_email), '') is null then
    raise exception 'A moderation action and administrator are required' using errcode = '22023';
  end if;
  update public.listings set moderation_suspended = p_suspended
    where id = p_listing_id returning * into target;
  if not found then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;
  insert into public.moderation_logs (admin_email, listing_id, action, admin_notes)
    values (p_admin_email, p_listing_id, case when p_suspended then 'suspend' else 'unsuspend' end, p_note);
  return jsonb_build_object('id', target.id, 'status', target.status,
    'owner_status', target.owner_status, 'moderation_suspended', target.moderation_suspended);
end;
$$;
revoke all on function public.moderate_listing(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.moderate_listing(uuid, boolean, text, text) to service_role;
commit;
