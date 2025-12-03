create index if not exists listings_location_gix on listings using gist (location);

alter table profiles enable row level security;
alter table listings enable row level security;
alter table listing_images enable row level security;
alter table listing_tags enable row level security;
alter table chats enable row level security;
alter table chat_participants enable row level security;
alter table messages enable row level security;
alter table payments enable row level security;
alter table transactions enable row level security;
alter table disputes enable row level security;
alter table reviews enable row level security;
alter table notifications enable row level security;

create policy profiles_select on profiles for select using (true);
create policy profiles_modify on profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy profiles_update on profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy listings_select_active on listings for select using (status = 'active');
create policy listings_modify on listings for insert to authenticated with check ((select auth.uid()) = seller_id);
create policy listings_update on listings for update to authenticated using ((select auth.uid()) = seller_id) with check ((select auth.uid()) = seller_id);
create policy listings_delete on listings for delete to authenticated using ((select auth.uid()) = seller_id);

create policy listing_images_select on listing_images for select using (exists (select 1 from listings l where l.id = listing_id and (l.seller_id = (select auth.uid()) or l.status = 'active')));
create policy listing_images_modify on listing_images for insert to authenticated with check (exists (select 1 from listings l where l.id = listing_id and l.seller_id = (select auth.uid())));
create policy listing_images_update on listing_images for update to authenticated using (exists (select 1 from listings l where l.id = listing_id and l.seller_id = (select auth.uid()))) with check (exists (select 1 from listings l where l.id = listing_id and l.seller_id = (select auth.uid())));
create policy listing_images_delete on listing_images for delete to authenticated using (exists (select 1 from listings l where l.id = listing_id and l.seller_id = (select auth.uid())));

create policy chat_participants_select on chat_participants for select using (user_id = (select auth.uid()));
create policy chat_participants_insert on chat_participants for insert to authenticated with check (user_id = (select auth.uid()));

create policy messages_select on messages for select using (exists (select 1 from chat_participants cp where cp.chat_id = messages.chat_id and cp.user_id = (select auth.uid())));
create policy messages_insert on messages for insert to authenticated with check (sender_id = (select auth.uid()) and exists (select 1 from chat_participants cp where cp.chat_id = messages.chat_id and cp.user_id = (select auth.uid())));
create policy messages_delete on messages for delete to authenticated using (sender_id = (select auth.uid()));

revoke all on payments from authenticated;
revoke all on transactions from authenticated;
revoke all on disputes from authenticated;
create policy payments_select_own on payments for select to authenticated using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()));
create policy transactions_select_own on transactions for select to authenticated using (exists (select 1 from payments p where p.id = payment_id and (p.buyer_id = (select auth.uid()) or p.seller_id = (select auth.uid()))));
create policy disputes_select_own on disputes for select to authenticated using (exists (select 1 from payments p where p.id = payment_id and (p.buyer_id = (select auth.uid()) or p.seller_id = (select auth.uid()))));

create policy reviews_select on reviews for select using (true);
create policy reviews_insert on reviews for insert to authenticated with check (reviewer_id = (select auth.uid()));
create policy reviews_update on reviews for update to authenticated using (reviewer_id = (select auth.uid())) with check (reviewer_id = (select auth.uid()));
create policy reviews_delete on reviews for delete to authenticated using (reviewer_id = (select auth.uid()));

create policy notifications_select on notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update on notifications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));