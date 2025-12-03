-- Add mutual confirmation flags to payments
alter table payments
  add column if not exists buyer_confirmed boolean default false,
  add column if not exists seller_confirmed boolean default false;

-- Allow each party to update only their own confirmation flag
create policy payments_update_buyer_confirm on payments
  for update to authenticated
  using (buyer_id = (select auth.uid()))
  with check (buyer_id = (select auth.uid()));

create policy payments_update_seller_confirm on payments
  for update to authenticated
  using (seller_id = (select auth.uid()))
  with check (seller_id = (select auth.uid()));

-- Optional check constraint to prevent capture state without confirmations (enforced in app as well)
alter table payments
  add constraint payments_completed_requires_confirmations
  check (
    (status <> 'completed') or (buyer_confirmed = true and seller_confirmed = true)
  );