create table if not exists milestones (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  buyer_id uuid not null references profiles(id) on delete cascade,
  seller_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  amount numeric(12,2) not null,
  status text not null check (status in ('pending','requires_capture','completed','failed')) default 'pending',
  stripe_payment_intent text,
  buyer_confirmed boolean default false,
  seller_confirmed boolean default false,
  created_at timestamptz default now()
);

alter table milestones enable row level security;
create policy milestones_select_own on milestones for select to authenticated using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()));
create policy milestones_update_buyer on milestones for update to authenticated using (buyer_id = (select auth.uid())) with check (buyer_id = (select auth.uid()));
create policy milestones_update_seller on milestones for update to authenticated using (seller_id = (select auth.uid())) with check (seller_id = (select auth.uid()));

alter table milestones add constraint milestones_completed_requires_confirmations check ((status <> 'completed') or (buyer_confirmed = true and seller_confirmed = true));