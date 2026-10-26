-- Legacy reviews remain intact and readable, without being retroactively
-- labelled as verified. Every new review belongs to one completed payment.
alter table public.reviews add column if not exists payment_id uuid
  references public.payments(id) on delete restrict;
create unique index if not exists reviews_payment_reviewer_unique
  on public.reviews(payment_id, reviewer_id) where payment_id is not null;

-- Browser writes previously bypassed the API's payment eligibility check.
-- Submit through the authenticated server route and its service-only RPC.
revoke all on public.reviews from public, anon, authenticated;
grant select on public.reviews to anon, authenticated;
grant select, insert, update on public.reviews to service_role;

create or replace function public.guard_review_eligibility()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare payment public.payments%rowtype;
begin
  if tg_op = 'UPDATE' and (
    old.payment_id is null or
    (to_jsonb(new) - 'rating' - 'comment') is distinct from (to_jsonb(old) - 'rating' - 'comment')
  ) then
    raise exception 'A review cannot be reassigned or a legacy review marked verified' using errcode = '23514';
  end if;
  if new.payment_id is null then
    raise exception 'A completed payment is required for a new review' using errcode = '23514';
  end if;
  -- Serialize with settlement/refund updates: eligibility is checked at the
  -- same transaction boundary as the insert, not only by an earlier HTTP read.
  select * into payment from public.payments where id = new.payment_id for share;
  if not found or payment.status <> 'completed'
    or new.reviewer_id is distinct from payment.buyer_id
    or new.seller_id is distinct from payment.seller_id
    or new.listing_id is distinct from payment.listing_id
    or payment.buyer_id = payment.seller_id then
    raise exception 'Only the payer may review the provider of a completed payment' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_review_eligibility() from public, anon, authenticated;
drop trigger if exists reviews_eligibility_guard on public.reviews;
create trigger reviews_eligibility_guard before insert or update on public.reviews
  for each row execute function public.guard_review_eligibility();

create or replace function public.submit_payment_review(
  p_payment_id uuid, p_reviewer_id uuid, p_rating numeric, p_comment text default ''
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare payment public.payments%rowtype; review_id uuid;
begin
  -- Numeric input is validated before conversion to the table's integer type,
  -- because PostgreSQL would otherwise round a fractional rating on assignment.
  if p_rating is null or p_rating < 1 or p_rating > 5 or p_rating <> trunc(p_rating)
    or length(coalesce(p_comment, '')) > 4000 then
    raise exception 'Use an integer rating from 1 to 5 and a comment of at most 4000 characters' using errcode = '22023';
  end if;
  select * into payment from public.payments where id = p_payment_id for share;
  if not found or payment.status <> 'completed' or payment.buyer_id is distinct from p_reviewer_id then
    raise exception 'This completed payment is not eligible for your review' using errcode = '42501';
  end if;
  -- Actual payment parties are authoritative, including request listings where
  -- the listing publisher is the payer and the responder is the provider.
  insert into public.reviews(payment_id, listing_id, seller_id, reviewer_id, rating, comment)
    values(payment.id, payment.listing_id, payment.seller_id, p_reviewer_id, p_rating::int, coalesce(p_comment, ''))
    returning id into review_id;
  return review_id;
end $$;
revoke all on function public.submit_payment_review(uuid,uuid,numeric,text) from public, anon, authenticated;
grant execute on function public.submit_payment_review(uuid,uuid,numeric,text) to service_role;
