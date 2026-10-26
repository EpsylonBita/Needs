-- Support messages contain private contact details. Public clients cannot read
-- or write this table; the validated, rate-limited API writes with service_role.
create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (char_length(first_name) between 1 and 100),
  last_name text not null check (char_length(last_name) between 1 and 100),
  email text not null check (char_length(email) between 3 and 254),
  subject text not null check (char_length(subject) between 1 and 200),
  message text not null check (char_length(message) between 10 and 5000),
  created_at timestamptz not null default now()
);

alter table public.support_requests enable row level security;
revoke all on public.support_requests from public, anon, authenticated;
grant select, insert, update, delete on public.support_requests to service_role;
create index if not exists support_requests_created_at_idx on public.support_requests (created_at desc);
