-- Application complaints do not change financial payment status. Stripe
-- webhooks remain authoritative for settlement, refunds and bank chargebacks.
create or replace function public.open_payment_complaint(p_payment_id uuid, p_buyer_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare payment public.payments%rowtype; complaint_id uuid;
begin
  select * into payment from public.payments where id = p_payment_id for update;
  if not found or payment.buyer_id <> p_buyer_id then raise exception 'Payment not owned by buyer'; end if;
  if payment.status not in ('requires_capture', 'completed') then raise exception 'Payment cannot accept a complaint'; end if;
  select id into complaint_id from public.disputes
    where payment_id = p_payment_id and stripe_dispute_id is null and status = 'open'
    order by created_at, id limit 1;
  if complaint_id is not null then return jsonb_build_object('dispute_id', complaint_id, 'duplicate', true); end if;
  insert into public.disputes(payment_id, status) values(p_payment_id, 'open') returning id into complaint_id;
  insert into public.notifications(user_id, type, payload) values
    (payment.buyer_id, 'dispute_opened', jsonb_build_object('payment_id', p_payment_id)),
    (payment.seller_id, 'dispute_opened', jsonb_build_object('payment_id', p_payment_id));
  insert into public.payment_audit_logs(payment_id, action, actor_type, metadata)
    values(p_payment_id, 'complaint_opened', 'user', jsonb_build_object('dispute_id', complaint_id, 'buyer_id', p_buyer_id));
  return jsonb_build_object('dispute_id', complaint_id, 'duplicate', false);
end $$;

create or replace function public.resolve_payment_complaint(p_dispute_id uuid, p_admin_email text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare complaint public.disputes%rowtype;
begin
  select * into complaint from public.disputes where id = p_dispute_id for update;
  if not found then raise exception 'Complaint not found'; end if;
  if complaint.stripe_dispute_id is not null then raise exception 'Bank disputes must be resolved through Stripe'; end if;
  if complaint.status <> 'open' then return; end if;
  update public.disputes set status = 'resolved', resolved_at = now() where id = p_dispute_id;
  insert into public.payment_audit_logs(payment_id, action, actor_type, metadata)
    values(complaint.payment_id, 'admin_resolve', 'admin', jsonb_build_object('dispute_id', p_dispute_id, 'admin_email', p_admin_email));
end $$;

-- The financial webhook inserts the successful refund transaction before it
-- updates payment status. Close only app complaints after a full real refund,
-- not after a lost chargeback (which has no refund transaction).
create or replace function public.close_refunded_payment_complaints()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'refunded' and old.status is distinct from new.status
    and (select coalesce(sum(amount), 0) from public.transactions
      where payment_id = new.id and type = 'refund' and status = 'succeeded') >= new.amount then
    update public.disputes set status = 'refunded', resolved_at = now()
      where payment_id = new.id and stripe_dispute_id is null and status = 'open';
  end if;
  return new;
end $$;
drop trigger if exists close_refunded_payment_complaints on public.payments;
create trigger close_refunded_payment_complaints after update of status on public.payments
  for each row execute function public.close_refunded_payment_complaints();

revoke all on function public.open_payment_complaint(uuid,uuid) from public, anon, authenticated;
revoke all on function public.resolve_payment_complaint(uuid,text) from public, anon, authenticated;
revoke all on function public.close_refunded_payment_complaints() from public, anon, authenticated;
grant execute on function public.open_payment_complaint(uuid,uuid) to service_role;
grant execute on function public.resolve_payment_complaint(uuid,text) to service_role;

-- Store each Stripe refund identity/status rather than assuming charge.refunded
-- means the customer's bank ultimately accepted the refund.
alter table public.transactions add column if not exists stripe_refund_id text;
create unique index if not exists transactions_stripe_refund_uidx on public.transactions(stripe_refund_id)
  where stripe_refund_id is not null;

create or replace function public.process_stripe_refund_event(
  p_event jsonb, p_payment_intent text, p_refunds jsonb, p_request_id text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  event_id text := p_event->>'id'; event_created bigint := coalesce((p_event->>'created')::bigint, 0);
  prior public.webhook_events%rowtype; payment public.payments%rowtype;
  prior_refund public.transactions%rowtype; refund jsonb; result jsonb;
  succeeded_total numeric; changed boolean := false; has_failure boolean := false;
begin
  if coalesce(event_id,'') = '' or p_event->>'type' not in ('charge.refunded','refund.created','refund.updated','refund.failed')
    or coalesce(jsonb_typeof(p_refunds),'') <> 'array' then raise exception 'Invalid refund event'; end if;
  insert into public.webhook_events(id,source,event_type,payload) values(event_id,'stripe',p_event->>'type',p_event)
    on conflict(id) do nothing;
  select * into prior from public.webhook_events where id = event_id for update;
  if prior.processed_at is not null and prior.processing_error is null and prior.processing_result->>'action' = 'refund_reconciled' then
    return jsonb_build_object('duplicate',true,'action','already_processed');
  end if;
  select * into payment from public.payments where stripe_payment_intent = p_payment_intent for update;
  if not found then raise exception 'Payment not found for Stripe intent %',p_payment_intent; end if;

  if jsonb_array_length(p_refunds) > 0 then
    -- Preserve legacy ledger entries for audit, excluding them from the totals
    -- now represented by complete canonical records with real refund IDs.
    update public.transactions set status = 'superseded'
      where payment_id = payment.id and type = 'refund' and stripe_refund_id is null and status = 'succeeded';
  end if;
  for refund in select value from jsonb_array_elements(p_refunds) loop
    if coalesce(refund->>'id','') = '' or coalesce(refund->>'status','') not in ('pending','requires_action','succeeded','failed','canceled')
      or coalesce((refund->>'amount')::numeric,0) <= 0 or coalesce(refund->>'currency','') <> payment.currency then
      raise exception 'Invalid canonical refund record';
    end if;
    select * into prior_refund from public.transactions where stripe_refund_id = refund->>'id' for update;
    if found then
      if prior_refund.payment_id <> payment.id then raise exception 'Refund belongs to another payment'; end if;
      -- Failed/canceled refunds are terminal. An earlier HTTP request carrying
      -- a successful snapshot must not overwrite a later failure transaction.
      if prior_refund.status in ('failed','canceled') then continue; end if;
      if coalesce((prior_refund.metadata->>'stripe_event_created')::bigint,0) > event_created then continue; end if;
      if prior_refund.status = 'succeeded' and refund->>'status' = 'pending'
        and coalesce((prior_refund.metadata->>'stripe_event_created')::bigint,0) >= event_created then continue; end if;
      if prior_refund.status = refund->>'status' then
        update public.transactions set metadata = coalesce(metadata,'{}') || jsonb_build_object('stripe_event_created',event_created)
          where id=prior_refund.id;
        continue;
      end if;
      update public.transactions set status = refund->>'status', amount = (refund->>'amount')::numeric / 100,
        metadata = coalesce(metadata,'{}') || jsonb_build_object('stripe_event_id',event_id,'stripe_event_created',event_created,'failure_reason',refund->>'failure_reason')
        where id = prior_refund.id;
    else
      insert into public.transactions(payment_id,type,amount,status,stripe_refund_id,metadata)
        values(payment.id,'refund',(refund->>'amount')::numeric/100,refund->>'status',refund->>'id',
          jsonb_build_object('stripe_event_id',event_id,'stripe_event_created',event_created,'failure_reason',refund->>'failure_reason'));
    end if;
    changed := true;
    if refund->>'status' in ('failed','canceled','requires_action') then has_failure := true; end if;
  end loop;
  select coalesce(sum(amount),0) into succeeded_total from public.transactions
    where payment_id = payment.id and type = 'refund' and status = 'succeeded';
  if succeeded_total >= payment.amount then
    update public.payments set status = 'refunded',refunded_at = coalesce(refunded_at,now()) where id = payment.id;
  elsif payment.status = 'refunded' and not exists(select 1 from public.disputes where payment_id = payment.id and stripe_dispute_id is not null and status = 'lost') then
    update public.payments set status = case when exists(select 1 from public.disputes where payment_id = payment.id and stripe_dispute_id is not null and status = 'open') then 'disputed' else 'completed' end,
      refunded_at = null where id = payment.id;
    update public.disputes set status = 'open',resolved_at = null where payment_id = payment.id and stripe_dispute_id is null and status = 'refunded';
  end if;
  if changed then
    insert into public.payment_audit_logs(payment_id,action,actor_type,metadata)
      values(payment.id,'refund_reconciled','system',jsonb_build_object('stripe_event_id',event_id,'successful_refund_total',succeeded_total,'requires_attention',has_failure,'request_id',p_request_id));
    if has_failure then
      insert into public.notifications(user_id,type,payload) values
        (payment.buyer_id,'payment_refund_failed',jsonb_build_object('payment_id',payment.id)),
        (payment.seller_id,'payment_refund_failed',jsonb_build_object('payment_id',payment.id));
    end if;
  end if;
  result := jsonb_build_object('duplicate',false,'action','refund_reconciled','paymentId',payment.id,'successfulRefundTotal',succeeded_total);
  update public.webhook_events set processed_at=now(),processing_error=null,processing_result=result,payload=p_event,event_type=p_event->>'type' where id=event_id;
  return result;
end $$;
revoke all on function public.process_stripe_refund_event(jsonb,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.process_stripe_refund_event(jsonb,text,jsonb,text) to service_role;
