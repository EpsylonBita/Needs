alter table if exists payments add column if not exists completed_at timestamptz;
alter table if exists payments add column if not exists failed_at timestamptz;
alter table if exists payments add column if not exists refunded_at timestamptz;
alter table if exists payments add column if not exists disputed_at timestamptz;

alter table if exists transactions add column if not exists fee numeric(12,2);
alter table if exists transactions add column if not exists metadata jsonb;

alter table if exists disputes add column if not exists stripe_dispute_id text;
alter table if exists disputes add column if not exists amount numeric(12,2);

alter table if exists milestones add column if not exists completed_at timestamptz;
