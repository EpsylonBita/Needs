begin;

-- Authoritative Stripe late wins may correct a prior lost decision.
-- https://docs.stripe.com/disputes/how-disputes-work#after-the-decision

create or replace function public.reconcile_order_disputes(p_payment_id uuid,p_intent_id text,p_read_started_at timestamptz,p_disputes jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payment public.payments%rowtype; prior public.disputes%rowtype; dispute jsonb; target_status text;
  dispute_id uuid; recipient uuid; changed boolean; successful_refunds numeric; late_win boolean := false; correction boolean;
begin
  select * into payment from public.payments where id=p_payment_id for update;
  if not found or p_intent_id is distinct from payment.stripe_payment_intent or p_read_started_at is null
    or p_read_started_at>clock_timestamp()+interval '1 minute' or coalesce(jsonb_typeof(p_disputes),'')<>'array'
    or jsonb_array_length(p_disputes)>100 then raise exception 'Invalid bank dispute snapshot' using errcode='23514'; end if;
  if payment.disputes_read_started_at is not null and p_read_started_at<=payment.disputes_read_started_at then return jsonb_build_object('applied',false); end if;
  if payment.status not in('completed','refunded','disputed') or payment.stripe_canceled_at is not null then raise exception 'Only a settled payment can have bank disputes' using errcode='23514'; end if;
  if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_disputes)) then raise exception 'Duplicate bank dispute in snapshot' using errcode='23514'; end if;
  for dispute in select value from jsonb_array_elements(p_disputes) loop
    if coalesce(dispute->>'id','')!~'^[A-Za-z0-9_]{1,255}$'
      or coalesce(dispute->>'status','') not in('needs_response','under_review','warning_needs_response','warning_under_review','warning_closed','prevented','won','lost')
      or coalesce((dispute->>'amount')::numeric,0)<=0 or (dispute->>'amount')::numeric<>trunc((dispute->>'amount')::numeric)
      or (dispute->>'amount')::numeric>999999999999 or coalesce(dispute->>'currency','')!~'^[a-z]{3}$' then raise exception 'Invalid canonical bank dispute' using errcode='23514'; end if;
    if exists(select 1 from public.disputes where stripe_dispute_id=dispute->>'id' and payment_id<>payment.id) then raise exception 'Bank dispute belongs to another payment' using errcode='23514'; end if;
    target_status:=case dispute->>'status' when 'won' then 'won' when 'lost' then 'lost' when 'warning_closed' then 'resolved' when 'prevented' then 'resolved' else 'open' end;
    select * into prior from public.disputes where payment_id=payment.id and stripe_dispute_id=dispute->>'id' order by created_at,id limit 1 for update;
    changed:=false; correction:=prior.id is not null and prior.status='lost' and target_status='won';
    if prior.id is null then
      insert into public.disputes(payment_id,stripe_dispute_id,reason,status,amount,currency,resolved_at)
        values(payment.id,dispute->>'id',coalesce(dispute->>'reason','unknown'),target_status,(dispute->>'amount')::numeric/100,dispute->>'currency',
          case when target_status<>'open' then clock_timestamp() else null end) returning id into dispute_id;
      changed:=true;
    elsif (prior.status not in('won','lost','resolved','refunded','rejected') and prior.status<>target_status) or correction then
      update public.disputes set status=target_status,resolved_at=case when target_status<>'open' then clock_timestamp() else null end where id=prior.id;
      dispute_id:=prior.id; changed:=true;
    end if;
    if correction then
      late_win:=true;
      -- Stripe can credit a lost dispute after its original decision. This is
      -- provider truth, not permission to transfer seller funds automatically.
      update public.payments set attention_required=true where id=payment.id;
      foreach recipient in array array[payment.buyer_id,payment.seller_id] loop
        perform needs_private.notify_order(payment.id,recipient,'payment_attention_required','bank_dispute_late_win:'||(dispute->>'id'),
          jsonb_build_object('reason_code','bank_dispute_late_win_settlement_review','dispute_id',dispute_id));
      end loop;
    end if;
    -- Historical webhook versions assumed the complete purchase amount. The
    -- bound provider record supplies the actual amount and its own currency.
    update public.disputes set amount=(dispute->>'amount')::numeric/100,currency=dispute->>'currency'
      where payment_id=payment.id and stripe_dispute_id=dispute->>'id';
    if changed then
      insert into public.payment_audit_logs(payment_id,action,actor_type,metadata) values(payment.id,
        case when target_status='open' then 'dispute_opened' else 'dispute_resolved' end,'system',
        jsonb_build_object('source','stripe_api','read_started_at',p_read_started_at,'stripe_dispute_id',dispute->>'id','dispute_id',dispute_id,'provider_status',dispute->>'status','prior_status',prior.status,'late_win',correction));
      foreach recipient in array array[payment.buyer_id,payment.seller_id] loop
        perform needs_private.notify_order(payment.id,recipient,case when target_status='open' then 'dispute_opened' else 'dispute_resolved' end,
          'bank_dispute:'||(dispute->>'id')||':'||target_status,jsonb_build_object('dispute_id',dispute_id));
      end loop;
    end if;
  end loop;
  select coalesce(sum(amount),0) into successful_refunds from public.transactions where payment_id=payment.id and type='refund' and status='succeeded';
  if exists(select 1 from public.disputes where payment_id=payment.id and stripe_dispute_id is not null and status='open') then
    update public.payments set status='disputed',disputed_at=coalesce(disputed_at,clock_timestamp()) where id=payment.id;
  elsif exists(select 1 from public.disputes where payment_id=payment.id and stripe_dispute_id is not null and status='lost') or successful_refunds>=payment.amount then
    update public.payments set status='refunded',refunded_at=coalesce(refunded_at,clock_timestamp()) where id=payment.id;
  elsif payment.status='disputed' or (payment.status='refunded' and late_win) then
    update public.payments set status='completed',refunded_at=null where id=payment.id;
  end if;
  if late_win and successful_refunds<payment.amount
    and not exists(select 1 from public.disputes where payment_id=payment.id and stripe_dispute_id is not null and status='lost') then
    update public.payments set refunded_at=null where id=payment.id;
  end if;
  update public.payments set disputes_read_started_at=p_read_started_at where id=payment.id;
  return jsonb_build_object('applied',true);
end $$;

-- Read Stripe before entering the transaction; the read-start timestamp orders
-- concurrent full snapshots. Processing and the event marker commit together.
create function public.process_stripe_dispute_event(
  p_event jsonb,p_payment_intent text,p_read_started_at timestamptz,p_disputes jsonb,p_request_id text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare event_id text:=p_event->>'id'; prior public.webhook_events%rowtype; payment public.payments%rowtype;
  observation jsonb; result jsonb;
begin
  if coalesce(event_id,'')='' or coalesce(p_event->>'type','') not in
      ('charge.dispute.created','charge.dispute.updated','charge.dispute.closed','charge.dispute.funds_reinstated')
    or coalesce(p_event#>>'{data,object,id}','')='' or coalesce(jsonb_typeof(p_disputes),'')<>'array' then
    raise exception 'Invalid canonical bank dispute event' using errcode='23514';
  end if;
  if not exists(select 1 from jsonb_array_elements(p_disputes) value where value->>'id'=p_event#>>'{data,object,id}') then
    raise exception 'Event dispute missing from canonical snapshot' using errcode='23514';
  end if;
  insert into public.webhook_events(id,source,event_type,payload) values(event_id,'stripe',p_event->>'type',p_event)
    on conflict(id) do nothing;
  select * into prior from public.webhook_events where id=event_id for update;
  if prior.event_type is distinct from p_event->>'type' then raise exception 'Stripe event identity mismatch' using errcode='23514'; end if;
  if prior.processed_at is not null and prior.processing_error is null and prior.processing_result->>'action'='dispute_reconciled' then
    return jsonb_build_object('duplicate',true,'action','already_processed');
  end if;
  select * into payment from public.payments where stripe_payment_intent=p_payment_intent for update;
  if not found then raise exception 'Payment not found for Stripe intent %',p_payment_intent; end if;
  observation:=public.reconcile_order_disputes(payment.id,p_payment_intent,p_read_started_at,p_disputes);
  result:=jsonb_build_object('duplicate',false,'action','dispute_reconciled','paymentId',payment.id,
    'applied',observation->'applied','requestId',p_request_id);
  update public.webhook_events set processed_at=clock_timestamp(),processing_error=null,processing_result=result,
    payload=p_event,event_type=p_event->>'type' where id=event_id;
  return result;
end $$;

revoke all on function public.reconcile_order_disputes(uuid,text,timestamptz,jsonb),
  public.process_stripe_dispute_event(jsonb,text,timestamptz,jsonb,text) from public,anon,authenticated;
grant execute on function public.reconcile_order_disputes(uuid,text,timestamptz,jsonb),
  public.process_stripe_dispute_event(jsonb,text,timestamptz,jsonb,text) to service_role;

commit;
