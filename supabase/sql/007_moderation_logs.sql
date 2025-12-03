create table if not exists moderation_logs (
  id uuid primary key default gen_random_uuid(),
  admin_email text not null,
  listing_id uuid not null references listings(id) on delete cascade,
  action text not null,
  created_at timestamptz default now()
);