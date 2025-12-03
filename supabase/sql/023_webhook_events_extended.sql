alter table if exists webhook_events add column if not exists source text;
alter table if exists webhook_events add column if not exists event_type text;
alter table if exists webhook_events add column if not exists payload jsonb;
alter table if exists webhook_events add column if not exists processed_at timestamptz;
alter table if exists webhook_events add column if not exists processing_result jsonb;
alter table if exists webhook_events add column if not exists processing_error jsonb;
create index if not exists idx_webhook_events_processed_at on webhook_events(processed_at);
create index if not exists idx_webhook_events_event_type on webhook_events(event_type);
