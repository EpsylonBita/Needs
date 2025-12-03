create table if not exists webhook_events (
  id text primary key,
  created_at timestamptz default now()
);