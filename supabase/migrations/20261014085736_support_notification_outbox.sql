-- Contact records remain private. Legacy messages are not emailed retroactively.
alter table public.support_requests
  add column submission_key uuid,
  add column payload_hash text,
  add column notification_status text not null default 'not_requested'
    check (notification_status in ('not_requested', 'pending', 'processing', 'accepted', 'failed')),
  add column notification_attempts integer not null default 0 check (notification_attempts between 0 and 5),
  add column notification_first_attempt_at timestamptz,
  add column notification_to text,
  add column notification_from text,
  add column notification_available_at timestamptz,
  add column notification_claim_token uuid,
  add column notification_claim_until timestamptz,
  add column notification_accepted_at timestamptz,
  add column notification_provider_id text,
  add column notification_error_code text;

create unique index support_requests_submission_key_uidx on public.support_requests(submission_key);
create index support_requests_notification_due_idx
  on public.support_requests(notification_available_at, created_at)
  where notification_status in ('pending', 'processing');

create function public.submit_support_request(
  p_submission_key uuid, p_payload_hash text,
  p_first_name text, p_last_name text, p_email text, p_subject text, p_message text
) returns table(request_id uuid, notification_status text)
language plpgsql security invoker set search_path = '' as $$
declare saved public.support_requests%rowtype;
begin
  if p_submission_key is null or p_payload_hash is null or p_payload_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid submission identity' using errcode = '22023';
  end if;
  insert into public.support_requests(submission_key, payload_hash, first_name, last_name,
    email, subject, message, notification_status, notification_available_at)
  values (p_submission_key, p_payload_hash, p_first_name, p_last_name,
    p_email, p_subject, p_message, 'pending', now())
  on conflict (submission_key) do nothing;
  select * into saved from public.support_requests where submission_key = p_submission_key;
  if saved.payload_hash is distinct from p_payload_hash then
    raise exception 'Submission key already belongs to another message' using errcode = '22023';
  end if;
  return query select saved.id, saved.notification_status;
end;
$$;

-- A five-minute lease prevents simultaneous handlers from sending the same row.
-- Retries stop after five attempts or 23 hours from the first claim, within
-- a 24-hour provider idempotency window. Waiting for configuration does not
-- expire never-attempted messages. The first envelope is reused on every retry.
create function public.claim_support_notifications(
  p_request_id uuid default null, p_limit integer default 5,
  p_to text default null, p_from text default null
)
returns setof public.support_requests
language plpgsql security invoker set search_path = '' as $$
begin
  if p_to is null or p_from is null or length(p_to) not between 3 and 320
    or length(p_from) not between 3 and 320 or p_to ~ E'[\\r\\n]' or p_from ~ E'[\\r\\n]' then
    raise exception 'Notification envelope is not configured' using errcode = '22023';
  end if;
  update public.support_requests set notification_status = 'failed',
    notification_error_code = 'retry_window_expired', notification_claim_token = null,
    notification_claim_until = null
  where (p_request_id is null or id = p_request_id)
    and notification_status in ('pending', 'processing')
    and (notification_status <> 'processing' or notification_claim_until <= now())
    and (notification_first_attempt_at <= now() - interval '23 hours' or notification_attempts >= 5);

  return query
  with candidates as (
    select id from public.support_requests
    where (p_request_id is null or id = p_request_id)
      and (notification_first_attempt_at is null or notification_first_attempt_at > now() - interval '23 hours')
      and notification_attempts < 5
      and ((notification_status = 'pending' and notification_available_at <= now())
        or (notification_status = 'processing' and notification_claim_until <= now()))
    order by notification_available_at, created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 5), 10))
  )
  update public.support_requests r set notification_status = 'processing',
    notification_attempts = r.notification_attempts + 1,
    notification_first_attempt_at = coalesce(r.notification_first_attempt_at, now()),
    notification_to = coalesce(r.notification_to, p_to),
    notification_from = coalesce(r.notification_from, p_from),
    notification_claim_token = gen_random_uuid(),
    notification_claim_until = now() + interval '5 minutes'
  from candidates c where r.id = c.id returning r.*;
end;
$$;

create function public.finish_support_notification(
  p_request_id uuid, p_claim_token uuid, p_accepted boolean,
  p_provider_id text default null, p_error_code text default null
) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  update public.support_requests set
    notification_status = case when p_accepted then 'accepted'
      when notification_attempts >= 5 or notification_first_attempt_at <= now() - interval '23 hours' then 'failed'
      else 'pending' end,
    notification_available_at = case when p_accepted then null
      else now() + (least(3600, 60 * power(2, notification_attempts - 1)) * interval '1 second') end,
    notification_accepted_at = case when p_accepted then now() else null end,
    notification_provider_id = case when p_accepted then left(p_provider_id, 200) else notification_provider_id end,
    notification_error_code = case when p_accepted then null
      when p_error_code in ('provider_rejected', 'provider_timeout', 'provider_unavailable') then p_error_code
      else 'provider_unavailable' end,
    notification_claim_token = null, notification_claim_until = null
  where id = p_request_id and notification_status = 'processing'
    and notification_claim_token = p_claim_token;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.submit_support_request(uuid,text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.claim_support_notifications(uuid,integer,text,text) from public, anon, authenticated;
revoke all on function public.finish_support_notification(uuid,uuid,boolean,text,text) from public, anon, authenticated;
grant execute on function public.submit_support_request(uuid,text,text,text,text,text,text) to service_role;
grant execute on function public.claim_support_notifications(uuid,integer,text,text) to service_role;
grant execute on function public.finish_support_notification(uuid,uuid,boolean,text,text) to service_role;
