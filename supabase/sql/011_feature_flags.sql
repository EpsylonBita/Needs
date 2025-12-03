create table if not exists feature_flags (
  key text primary key,
  enabled boolean default false,
  updated_at timestamptz default now()
);