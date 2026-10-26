-- Deploy before the application code that calls consume_rate_limit.
-- One database statement serializes concurrent requests for the same fixed window.
begin;

create or replace function public.consume_rate_limit(p_key text, p_limit integer, p_window_ms integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_time timestamptz := clock_timestamp();
  window_start_at timestamptz;
  window_end_at timestamptz;
  consumed_count integer;
begin
  if p_key is null or length(btrim(p_key)) = 0 or length(p_key) > 512
    or p_limit is null or p_limit < 1 or p_window_ms is null or p_window_ms < 1 then
    raise exception 'Invalid rate limit configuration' using errcode = '22023';
  end if;

  window_start_at := to_timestamp(floor(extract(epoch from request_time) * 1000 / p_window_ms) * p_window_ms / 1000);
  window_end_at := window_start_at + p_window_ms * interval '1 millisecond';

  insert into public.rate_limits as limits (key, window_start, count)
  values (p_key, window_start_at, 1)
  on conflict (key, window_start) do update
    set count = limits.count + 1
    where limits.count < p_limit
  returning count into consumed_count;

  return jsonb_build_object(
    'allowed', consumed_count is not null,
    'remaining', greatest(0, p_limit - coalesce(consumed_count, p_limit)),
    'reset_at', window_end_at,
    'retry_after', case when consumed_count is null
      then greatest(1, ceil(extract(epoch from (window_end_at - clock_timestamp())))::integer)
      else 0 end
  );
end;
$$;

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.rate_limits to service_role;
revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

commit;
