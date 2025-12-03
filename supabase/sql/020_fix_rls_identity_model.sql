-- Fix broken RLS identity model
-- The current policies compare auth.uid() (user_id) against profiles.id (profile_id)
-- This is incorrect - we need to compare against profiles.user_id

-- Drop existing policies that have incorrect identity checks
drop policy if exists listings_modify on listings;
drop policy if exists listings_update on listings;
drop policy if exists listings_delete on listings;
drop policy if exists listing_images_select on listing_images;
drop policy if exists listing_images_modify on listing_images;
drop policy if exists listing_images_update on listing_images;
drop policy if exists listing_images_delete on listing_images;
drop policy if exists chat_participants_select on chat_participants;
drop policy if exists chat_participants_insert on chat_participants;
drop policy if exists messages_select on messages;
drop policy if exists messages_insert on messages;
drop policy if exists messages_delete on messages;
drop policy if exists payments_select_own on payments;
drop policy if exists transactions_select_own on transactions;
drop policy if exists disputes_select_own on disputes;
drop policy if exists reviews_insert on reviews;
drop policy if exists reviews_update on reviews;
drop policy if exists reviews_delete on reviews;
drop policy if exists notifications_select on notifications;
drop policy if exists notifications_update on notifications;

-- Create corrected policies that properly map auth.uid() to profiles.user_id
-- Listings policies
create policy listings_modify on listings for insert to authenticated 
with check (
  seller_id = (select id from profiles where user_id = auth.uid())
);

create policy listings_update on listings for update to authenticated 
using (
  seller_id = (select id from profiles where user_id = auth.uid())
)
with check (
  seller_id = (select id from profiles where user_id = auth.uid())
);

create policy listings_delete on listings for delete to authenticated 
using (
  seller_id = (select id from profiles where user_id = auth.uid())
);

-- Listing images policies
create policy listing_images_select on listing_images for select 
using (
  exists (
    select 1 from listings l 
    where l.id = listing_id and (
      l.seller_id = (select id from profiles where user_id = auth.uid()) 
      or l.status = 'active'
    )
  )
);

create policy listing_images_modify on listing_images for insert to authenticated 
with check (
  exists (
    select 1 from listings l 
    where l.id = listing_id and l.seller_id = (select id from profiles where user_id = auth.uid())
  )
);

create policy listing_images_update on listing_images for update to authenticated 
using (
  exists (
    select 1 from listings l 
    where l.id = listing_id and l.seller_id = (select id from profiles where user_id = auth.uid())
  )
)
with check (
  exists (
    select 1 from listings l 
    where l.id = listing_id and l.seller_id = (select id from profiles where user_id = auth.uid())
  )
);

create policy listing_images_delete on listing_images for delete to authenticated 
using (
  exists (
    select 1 from listings l 
    where l.id = listing_id and l.seller_id = (select id from profiles where user_id = auth.uid())
  )
);

-- Chat participants policies
create policy chat_participants_select on chat_participants for select 
using (
  user_id = (select id from profiles where user_id = auth.uid())
);

create policy chat_participants_insert on chat_participants for insert to authenticated 
with check (
  user_id = (select id from profiles where user_id = auth.uid())
);

-- Messages policies
create policy messages_select on messages for select 
using (
  exists (
    select 1 from chat_participants cp 
    where cp.chat_id = messages.chat_id and cp.user_id = (select id from profiles where user_id = auth.uid())
  )
);

create policy messages_insert on messages for insert to authenticated 
with check (
  sender_id = (select id from profiles where user_id = auth.uid()) 
  and exists (
    select 1 from chat_participants cp 
    where cp.chat_id = messages.chat_id and cp.user_id = (select id from profiles where user_id = auth.uid())
  )
);

create policy messages_delete on messages for delete to authenticated 
using (
  sender_id = (select id from profiles where user_id = auth.uid())
);

-- Payment policies
create policy payments_select_own on payments for select to authenticated 
using (
  buyer_id = (select id from profiles where user_id = auth.uid()) 
  or seller_id = (select id from profiles where user_id = auth.uid())
);

create policy transactions_select_own on transactions for select to authenticated 
using (
  exists (
    select 1 from payments p 
    where p.id = payment_id and (
      p.buyer_id = (select id from profiles where user_id = auth.uid()) 
      or p.seller_id = (select id from profiles where user_id = auth.uid())
    )
  )
);

create policy disputes_select_own on disputes for select to authenticated 
using (
  exists (
    select 1 from payments p 
    where p.id = payment_id and (
      p.buyer_id = (select id from profiles where user_id = auth.uid()) 
      or p.seller_id = (select id from profiles where user_id = auth.uid())
    )
  )
);

-- Reviews policies
create policy reviews_insert on reviews for insert to authenticated 
with check (
  reviewer_id = (select id from profiles where user_id = auth.uid())
);

create policy reviews_update on reviews for update to authenticated 
using (
  reviewer_id = (select id from profiles where user_id = auth.uid())
)
with check (
  reviewer_id = (select id from profiles where user_id = auth.uid())
);

create policy reviews_delete on reviews for delete to authenticated 
using (
  reviewer_id = (select id from profiles where user_id = auth.uid())
);

-- Notifications policies
create policy notifications_select on notifications for select to authenticated 
using (
  user_id = (select id from profiles where user_id = auth.uid())
);

create policy notifications_update on notifications for update to authenticated 
using (
  user_id = (select id from profiles where user_id = auth.uid())
)
with check (
  user_id = (select id from profiles where user_id = auth.uid())
);

-- Grant necessary permissions to anon and authenticated roles
grant select on listings to anon;
grant select on listing_images to anon;
grant select on listing_tags to anon;
grant select on reviews to anon;

grant all on listings to authenticated;
grant all on listing_images to authenticated;
grant all on listing_tags to authenticated;
grant all on profiles to authenticated;
grant all on chats to authenticated;
grant all on chat_participants to authenticated;
grant all on messages to authenticated;
grant all on payments to authenticated;
grant all on transactions to authenticated;
grant all on disputes to authenticated;
grant all on reviews to authenticated;
grant all on notifications to authenticated;