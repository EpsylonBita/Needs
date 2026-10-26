-- Inbox state is membership history: leaving never removes a participant or message.
-- Requires the existing direct-chat repair and recipient-only notifications policies.
alter table public.chat_participants add column if not exists left_at timestamptz;
alter table public.chat_participants add column if not exists last_read_sequence bigint not null default 0;
alter table public.chat_participants add column if not exists last_read_message_id uuid;
alter table public.messages add column if not exists sequence bigint;
alter table public.messages add column if not exists client_message_id uuid;

-- Existing history receives deterministic ordering, without generating notifications.
with numbered as (
  select id, row_number() over (partition by chat_id order by created_at nulls first, id) as position
  from public.messages
)
update public.messages m set sequence = n.position from numbered n where m.id = n.id and m.sequence is null;
alter table public.messages alter column sequence set not null;
create unique index if not exists messages_chat_sequence_unique on public.messages(chat_id, sequence);
create unique index if not exists messages_sender_client_message_unique
  on public.messages(sender_id, client_message_id) where client_message_id is not null;
create index if not exists chat_participants_user_chat on public.chat_participants(user_id, chat_id);

update public.chat_participants cp
set last_read_sequence = coalesce((select max(m.sequence) from public.messages m
  where m.chat_id = cp.chat_id and m.created_at <= cp.last_read_at), 0)
where cp.last_read_sequence = 0 and cp.last_read_at is not null;
update public.chat_participants cp set last_read_message_id = m.id
from public.messages m where m.chat_id = cp.chat_id and m.sequence = cp.last_read_sequence
  and cp.last_read_message_id is null;

create or replace function needs_private.chat_profile(p_expected_user_id uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare caller uuid;
begin
  if p_expected_user_id is null or auth.uid() is distinct from p_expected_user_id then
    raise exception 'Your account changed. Reload chat and try again.' using errcode = '42501';
  end if;
  select p.id into caller from public.profiles p where p.user_id = auth.uid();
  if caller is null then raise exception 'Complete your profile before using chat' using errcode = '42501'; end if;
  return caller;
end;
$$;

-- This definer helper avoids recursive participant RLS, while retaining history access.
create or replace function needs_private.is_chat_member(p_chat_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.chat_participants cp join public.profiles p on p.id = cp.user_id
    where cp.chat_id = p_chat_id and p.user_id = auth.uid());
$$;
revoke all on function needs_private.chat_profile(uuid), needs_private.is_chat_member(uuid) from public, anon;
grant execute on function needs_private.chat_profile(uuid), needs_private.is_chat_member(uuid) to authenticated;

alter table public.messages enable row level security;
alter table public.chat_participants enable row level security;
drop policy if exists chat_participants_select on public.chat_participants;
create policy chat_participants_select on public.chat_participants for select to authenticated
  using (needs_private.is_chat_member(chat_id));
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (needs_private.is_chat_member(chat_id));
-- Restrictive guards also constrain any older permissive SELECT policies.
drop policy if exists chat_participants_member_guard on public.chat_participants;
create policy chat_participants_member_guard on public.chat_participants as restrictive for select to public
  using (needs_private.is_chat_member(chat_id));
drop policy if exists messages_member_guard on public.messages;
create policy messages_member_guard on public.messages as restrictive for select to public
  using (needs_private.is_chat_member(chat_id));
revoke all on public.messages, public.chat_participants from public, anon, authenticated;
grant select on public.messages, public.chat_participants to authenticated;

-- Browser writes must not forge notification recipients, payloads, timestamps or messages.
revoke all on public.notifications from public, anon, authenticated;
grant select on public.notifications to authenticated;
grant update(read) on public.notifications to authenticated;

create or replace function needs_private.prepare_chat_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- All send/leave/rejoin/read operations serialize on the same chat. Assigning sequence
  -- after this lock ensures a later commit cannot appear behind an already-read watermark.
  perform 1 from public.chats c where c.id = new.chat_id for update;
  if not found then raise exception 'Chat not found' using errcode = '42501'; end if;
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
drop trigger if exists prepare_chat_message on public.messages;
create trigger prepare_chat_message before insert on public.messages
  for each row execute function needs_private.prepare_chat_message();

create or replace function needs_private.notify_chat_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications(user_id, type, payload, read)
  select cp.user_id, 'chat_message', jsonb_build_object('chat_id', new.chat_id, 'message_id', new.id, 'sender_id', new.sender_id), false
  from public.chat_participants cp
  where cp.chat_id = new.chat_id and cp.user_id <> new.sender_id and cp.left_at is null;
  return new;
end;
$$;
drop trigger if exists notify_chat_message on public.messages;
create trigger notify_chat_message after insert on public.messages
  for each row execute function needs_private.notify_chat_message();
revoke all on function needs_private.prepare_chat_message(), needs_private.notify_chat_message() from public, anon, authenticated;

create or replace function public.get_my_chats(p_expected_user_id uuid)
returns table(chat_id uuid, title text, listing_id uuid, type text, created_at timestamptz,
  participants jsonb, last_message jsonb, unread_count bigint, last_read_at timestamptz,
  last_read_message_id uuid, last_read_sequence bigint, left_at timestamptz, can_send boolean, other_left boolean)
language plpgsql stable security definer set search_path = '' as $$
declare caller uuid := needs_private.chat_profile(p_expected_user_id);
begin
  return query
  select c.id, c.title, c.listing_id, c.type, c.created_at,
    coalesce((select jsonb_agg(jsonb_build_object('profile_id', p.id, 'display_name', p.display_name,
      'avatar_url', p.avatar_url, 'left_at', cp.left_at) order by p.id)
      from public.chat_participants cp join public.profiles p on p.id = cp.user_id
      where cp.chat_id = c.id and cp.user_id <> caller), '[]'::jsonb),
    (select to_jsonb(m) from public.messages m where m.chat_id = c.id order by m.sequence desc limit 1),
    (select count(*) from public.messages m where m.chat_id = c.id and m.sender_id <> caller and m.sequence > own.last_read_sequence),
    own.last_read_at, own.last_read_message_id, own.last_read_sequence, own.left_at,
    own.left_at is null and exists (select 1 from public.chat_participants cp where cp.chat_id = c.id and cp.user_id <> caller and cp.left_at is null)
      and not exists (select 1 from public.chat_participants cp where cp.chat_id = c.id and cp.left_at is not null),
    not exists (select 1 from public.chat_participants cp where cp.chat_id = c.id and cp.user_id <> caller)
      or exists (select 1 from public.chat_participants cp where cp.chat_id = c.id and cp.user_id <> caller and cp.left_at is not null)
  from public.chats c join public.chat_participants own on own.chat_id = c.id and own.user_id = caller
  order by coalesce((select m.created_at from public.messages m where m.chat_id = c.id order by m.sequence desc limit 1), c.created_at) desc nulls last, c.id;
end;
$$;

create or replace function public.get_chat_messages(p_expected_user_id uuid, p_chat_id uuid,
  p_before_sequence bigint default null, p_limit integer default 51)
returns setof public.messages language plpgsql stable security definer set search_path = '' as $$
declare caller uuid := needs_private.chat_profile(p_expected_user_id);
begin
  if not exists (select 1 from public.chat_participants cp where cp.chat_id = p_chat_id and cp.user_id = caller)
  then raise exception 'You are not a participant in this conversation' using errcode = '42501'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_before_sequence <= 0 then
    raise exception 'Invalid message page' using errcode = '22023';
  end if;
  return query select m.* from public.messages m where m.chat_id = p_chat_id
    and (p_before_sequence is null or m.sequence < p_before_sequence) order by m.sequence desc limit p_limit;
end;
$$;

create or replace function public.send_chat_message(p_expected_user_id uuid, p_chat_id uuid, p_content text, p_client_message_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := needs_private.chat_profile(p_expected_user_id); message public.messages;
begin
  if p_client_message_id is null then raise exception 'A message retry identifier is required' using errcode = '22023'; end if;
  perform 1 from public.chats c join public.chat_participants cp on cp.chat_id = c.id
    where c.id = p_chat_id and cp.user_id = caller for update of c;
  if not found then raise exception 'You are not a participant in this conversation' using errcode = '42501'; end if;
  select m.* into message from public.messages m where m.sender_id = caller and m.client_message_id = p_client_message_id;
  if found then
    if message.chat_id <> p_chat_id or message.content is distinct from btrim(p_content) then
      raise exception 'Message retry identifier was already used for different content or conversation' using errcode = '22023';
    end if;
    return to_jsonb(message);
  end if;
  insert into public.messages(chat_id, sender_id, content, client_message_id)
    values (p_chat_id, caller, p_content, p_client_message_id) returning * into message;
  return to_jsonb(message);
end;
$$;

create or replace function public.mark_chat_read(p_expected_user_id uuid, p_chat_id uuid, p_message_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := needs_private.chat_profile(p_expected_user_id); seen public.messages; member public.chat_participants; unread bigint;
begin
  perform 1 from public.chats c join public.chat_participants cp on cp.chat_id = c.id
    where c.id = p_chat_id and cp.user_id = caller for update of c;
  if not found then raise exception 'You are not a participant in this conversation' using errcode = '42501'; end if;
  select m.* into seen from public.messages m where m.id = p_message_id and m.chat_id = p_chat_id;
  if not found then raise exception 'Read marker does not belong to this conversation' using errcode = '22023'; end if;
  update public.chat_participants cp set last_read_sequence = seen.sequence, last_read_message_id = seen.id, last_read_at = seen.created_at
    where cp.chat_id = p_chat_id and cp.user_id = caller and cp.last_read_sequence < seen.sequence;
  -- Only genuine message references in this chat, through the explicitly seen message.
  update public.notifications n set read = true
    where n.user_id = caller and n.type = 'chat_message' and n.read is distinct from true
      and n.payload->>'chat_id' = p_chat_id::text and exists (
        select 1 from public.messages m where m.chat_id = p_chat_id and m.id::text = n.payload->>'message_id' and m.sequence <= seen.sequence);
  select cp.* into member from public.chat_participants cp where cp.chat_id = p_chat_id and cp.user_id = caller;
  select count(*) into unread from public.messages m where m.chat_id = p_chat_id and m.sender_id <> caller and m.sequence > member.last_read_sequence;
  return jsonb_build_object('chat_id', p_chat_id, 'last_read_at', member.last_read_at, 'last_read_message_id', member.last_read_message_id,
    'last_read_sequence', member.last_read_sequence, 'unread_count', unread);
end;
$$;

create or replace function public.leave_chat(p_expected_user_id uuid, p_chat_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := needs_private.chat_profile(p_expected_user_id); departed timestamptz;
begin
  perform 1 from public.chats c join public.chat_participants cp on cp.chat_id = c.id
    where c.id = p_chat_id and cp.user_id = caller for update of c;
  if not found then raise exception 'You are not a participant in this conversation' using errcode = '42501'; end if;
  update public.chat_participants cp set left_at = coalesce(cp.left_at, clock_timestamp())
    where cp.chat_id = p_chat_id and cp.user_id = caller returning cp.left_at into departed;
  return jsonb_build_object('chat_id', p_chat_id, 'left_at', departed);
end;
$$;

create or replace function public.rejoin_chat(p_expected_user_id uuid, p_chat_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := needs_private.chat_profile(p_expected_user_id);
begin
  perform 1 from public.chats c join public.chat_participants cp on cp.chat_id = c.id
    where c.id = p_chat_id and cp.user_id = caller for update of c;
  if not found then raise exception 'You are not a participant in this conversation' using errcode = '42501'; end if;
  update public.chat_participants cp set left_at = null where cp.chat_id = p_chat_id and cp.user_id = caller;
  return jsonb_build_object('chat_id', p_chat_id, 'left_at', null);
end;
$$;

-- Preserve direct/listing identity and the old public two-argument API.
create or replace function needs_private.get_or_create_direct_chat(p_other_profile_id uuid default null, p_listing_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare caller_profile uuid; other_profile uuid; chat_key text; chat_title text; found_chat uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to use chat' using errcode = '42501'; end if;
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

-- Required arguments avoid ambiguous resolution with the existing defaulted overload.
create or replace function public.get_or_create_direct_chat(p_other_profile_id uuid, p_listing_id uuid, p_expected_user_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
begin
  perform needs_private.chat_profile(p_expected_user_id);
  return needs_private.get_or_create_direct_chat(p_other_profile_id, p_listing_id);
end;
$$;

revoke all on function public.get_my_chats(uuid), public.get_chat_messages(uuid, uuid, bigint, integer),
  public.send_chat_message(uuid, uuid, text, uuid), public.mark_chat_read(uuid, uuid, uuid),
  public.leave_chat(uuid, uuid), public.rejoin_chat(uuid, uuid), public.get_or_create_direct_chat(uuid, uuid, uuid) from public, anon;
grant execute on function public.get_my_chats(uuid), public.get_chat_messages(uuid, uuid, bigint, integer),
  public.send_chat_message(uuid, uuid, text, uuid), public.mark_chat_read(uuid, uuid, uuid),
  public.leave_chat(uuid, uuid), public.rejoin_chat(uuid, uuid), public.get_or_create_direct_chat(uuid, uuid, uuid) to authenticated;

-- Existing notifications publication is retained. Participant updates expose leave/read
-- changes only to members under SELECT RLS; outsiders cannot subscribe to their history.
do $$
declare target text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'supabase_realtime publication is required for inbox updates';
  end if;
  foreach target in array array['messages', 'chat_participants'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = target) then
      execute format('alter publication supabase_realtime add table public.%I', target);
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
