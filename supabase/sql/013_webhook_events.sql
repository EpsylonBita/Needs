create table if not exists webhook_events (
  id text primary key,
  received_at timestamptz default now()
);