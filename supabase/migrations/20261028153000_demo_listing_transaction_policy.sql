-- Local-only until deployment approval: enforce the existing seed's no-transaction policy.
-- Source: needs-runtime-backups/demo-athens-20261014-manifest.json and
-- create-demo-profile-20261014.mjs, project qczrqxmewjsydrrvjdil.
-- Exact listing IDs plus the original seller/user IDs and trusted auth app metadata
-- bind the seed identity. Neither titles, prices nor same-owner records imply demo status.
-- Redefines only existing functions, preserving signatures, security-definer,
-- empty search_path and existing grants. No schema/data/financial-value changes.
-- The message trigger covers both send_chat_message and any permitted direct insert;
-- historical messages remain readable and no notification is emitted on rejection.
begin;
create or replace function needs_private.get_or_create_direct_chat(p_other_profile_id uuid default null, p_listing_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare caller_profile uuid; other_profile uuid; chat_key text; chat_title text; found_chat uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to use chat' using errcode = '42501'; end if;
  if p_listing_id is not null and exists (
    select 1 from public.listings l
    join public.profiles p on p.id = l.seller_id
    join auth.users u on u.id = p.user_id
    where l.id = p_listing_id and l.id = any(array[
      '84cb699f-6bcd-46d1-8a48-b011ccb69bb9'::uuid,
      'b471ea17-951b-4b69-b1b7-4adca7a9f834'::uuid,
      '16c556c6-4413-48be-bc03-cd4de48b46df'::uuid,
      '9747633d-79e7-404f-a2e5-b64e365d33bb'::uuid,
      '8588184d-d6e1-4b66-aa11-5eb3128de7d2'::uuid,
      '3de235ad-2a89-4ae0-a101-14495078ce04'::uuid,
      'a03c17b8-51f5-47ab-ad11-d86427c89e87'::uuid,
      '6f193a95-70ca-4cea-9d45-7e4d790fe1d4'::uuid
    ])
      and p.id = 'cddec67e-80b7-41dc-a927-2c901c9cdbb8'::uuid
      and u.id = '354c6850-3c10-43bf-ac0d-3af21df78094'::uuid
      and u.raw_app_meta_data->>'demo_batch' = 'needs-demo-athens-20261014'
  ) then raise exception 'This demo listing is not available for transactions.' using errcode = '42501'; end if;
  select p.id into caller_profile from public.profiles p where p.user_id = auth.uid();
  if caller_profile is null then raise exception 'Complete your profile before using chat'; end if;
  if p_listing_id is not null then
    select l.seller_id, l.title into other_profile, chat_title from public.listings l where l.id = p_listing_id and l.status = 'active';
    if other_profile is null then raise exception 'Listing not found or unavailable'; end if;
    if p_other_profile_id is not null and p_other_profile_id <> other_profile then
      raise exception 'The recipient does not own this listing' using errcode = '42501';
    end if;
    chat_key := 'listing:' || p_listing_id::text || ':' || caller_profile::text;
  else
    select p.id into other_profile from public.profiles p where p.id = p_other_profile_id;
    if other_profile is null then raise exception 'Recipient profile not found'; end if;
    chat_key := 'direct:' || least(caller_profile, other_profile)::text || ':' || greatest(caller_profile, other_profile)::text;
  end if;
  if caller_profile = other_profile then raise exception 'You cannot contact yourself'; end if;
  insert into public.chats(type, title, listing_id, direct_key) values ('direct', chat_title, p_listing_id, chat_key)
    on conflict (direct_key) where direct_key is not null do update set direct_key = excluded.direct_key returning id into found_chat;
  insert into public.chat_participants(chat_id, user_id) values (found_chat, caller_profile), (found_chat, other_profile) on conflict do nothing;
  update public.chat_participants cp set left_at = null where cp.chat_id = found_chat and cp.user_id = caller_profile;
  return found_chat;
end;
$$;

create or replace function needs_private.prepare_chat_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- All send/leave/rejoin/read operations serialize on the same chat. Assigning sequence
  -- after this lock ensures a later commit cannot appear behind an already-read watermark.
  perform 1 from public.chats c where c.id = new.chat_id for update;
  if not found then raise exception 'Chat not found' using errcode = '42501'; end if;
  if exists (
    select 1 from public.listings l
    join public.profiles p on p.id = l.seller_id
    join auth.users u on u.id = p.user_id
    where l.id = (select c.listing_id from public.chats c where c.id = new.chat_id) and l.id = any(array[
      '84cb699f-6bcd-46d1-8a48-b011ccb69bb9'::uuid,
      'b471ea17-951b-4b69-b1b7-4adca7a9f834'::uuid,
      '16c556c6-4413-48be-bc03-cd4de48b46df'::uuid,
      '9747633d-79e7-404f-a2e5-b64e365d33bb'::uuid,
      '8588184d-d6e1-4b66-aa11-5eb3128de7d2'::uuid,
      '3de235ad-2a89-4ae0-a101-14495078ce04'::uuid,
      'a03c17b8-51f5-47ab-ad11-d86427c89e87'::uuid,
      '6f193a95-70ca-4cea-9d45-7e4d790fe1d4'::uuid
    ])
      and p.id = 'cddec67e-80b7-41dc-a927-2c901c9cdbb8'::uuid
      and u.id = '354c6850-3c10-43bf-ac0d-3af21df78094'::uuid
      and u.raw_app_meta_data->>'demo_batch' = 'needs-demo-athens-20261014'
  ) then raise exception 'This demo listing is not available for transactions.' using errcode = '42501'; end if;
  if auth.uid() is not null and not exists (
    select 1 from public.profiles p where p.id = new.sender_id and p.user_id = auth.uid()
  ) then raise exception 'Message sender does not match your account' using errcode = '42501'; end if;
  if not exists (select 1 from public.chat_participants cp
    where cp.chat_id = new.chat_id and cp.user_id = new.sender_id and cp.left_at is null)
  then raise exception 'Rejoin this conversation before sending a message' using errcode = '42501'; end if;
  if not exists (select 1 from public.chat_participants cp
    where cp.chat_id = new.chat_id and cp.user_id <> new.sender_id and cp.left_at is null)
    or exists (select 1 from public.chat_participants cp where cp.chat_id = new.chat_id and cp.left_at is not null)
  then raise exception 'The other participant has left this conversation' using errcode = '42501'; end if;
  new.content := btrim(new.content);
  if new.content is null or char_length(new.content) < 1 or char_length(new.content) > 4000 then
    raise exception 'Messages must contain between 1 and 4000 characters' using errcode = '22023';
  end if;
  if new.reply_to is not null and not exists (select 1 from public.messages m where m.id = new.reply_to and m.chat_id = new.chat_id)
  then raise exception 'Reply does not belong to this conversation' using errcode = '22023'; end if;
  select coalesce(max(m.sequence), 0) + 1 into new.sequence from public.messages m where m.chat_id = new.chat_id;
  new.created_at := clock_timestamp();
  return new;
end;
$$;

commit;
