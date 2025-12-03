begin;
create temp table dup_map as
select r.id as id, c.id as canonical_id
from (
  select id, user_id, created_at,
         row_number() over (partition by user_id order by created_at asc, id asc) as rn
  from profiles
) r
join (
  select id, user_id, created_at,
         row_number() over (partition by user_id order by created_at asc, id asc) as rn
  from profiles
) c
on r.user_id = c.user_id and c.rn = 1
where r.rn > 1;
update listings set seller_id = d.canonical_id from dup_map d where listings.seller_id = d.id;
update chat_participants set user_id = d.canonical_id from dup_map d where chat_participants.user_id = d.id;
update messages set sender_id = d.canonical_id from dup_map d where messages.sender_id = d.id;
update payments set buyer_id = d.canonical_id from dup_map d where payments.buyer_id = d.id;
update payments set seller_id = d.canonical_id from dup_map d where payments.seller_id = d.id;
update reviews set seller_id = d.canonical_id from dup_map d where reviews.seller_id = d.id;
update reviews set reviewer_id = d.canonical_id from dup_map d where reviews.reviewer_id = d.id;
update notifications set user_id = d.canonical_id from dup_map d where notifications.user_id = d.id;
delete from profiles using dup_map d where profiles.id = d.id;
alter table profiles add constraint profiles_user_id_unique unique (user_id);
commit;