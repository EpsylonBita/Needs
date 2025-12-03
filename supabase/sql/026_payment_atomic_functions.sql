create or replace function payment_complete_atomic(
  pi_id text,
  amount numeric,
  fee numeric,
  milestone uuid default null
) returns jsonb as $$
declare
  p payments%rowtype;
begin
  select * into p from payments where stripe_payment_intent = pi_id for update;
  if not found then
    return jsonb_build_object('status','ignored','reason','payment_not_found');
  end if;
  if p.status = 'completed' then
    return jsonb_build_object('status','ignored','reason','payment_already_completed','payment_id',p.id);
  end if;

  update payments set status = 'completed', completed_at = now() where id = p.id;

  insert into transactions(payment_id, type, amount, fee, status)
  values (p.id, 'charge', amount, fee, 'succeeded');

  if milestone is not null then
    update milestones set status = 'completed', completed_at = now() where id = milestone;
  end if;

  return jsonb_build_object('status','payment_completed','payment_id',p.id);
end;
$$ language plpgsql security definer;

create or replace function payment_refund_atomic(
  pi_id text,
  amount numeric
) returns jsonb as $$
declare
  pid uuid;
begin
  select id into pid from payments where stripe_payment_intent = pi_id for update;
  if pid is null then
    return jsonb_build_object('status','ignored','reason','payment_not_found');
  end if;

  update payments set status = 'refunded', refunded_at = now() where id = pid;

  insert into transactions(payment_id, type, amount, status)
  values (pid, 'refund', amount, 'succeeded');

  return jsonb_build_object('status','payment_refunded','payment_id',pid);
end;
$$ language plpgsql security definer;

create or replace function payment_fail_atomic(
  pi_id text,
  amount numeric
) returns jsonb as $$
declare
  pid uuid;
begin
  select id into pid from payments where stripe_payment_intent = pi_id for update;
  if pid is null then
    return jsonb_build_object('status','ignored','reason','payment_not_found');
  end if;

  update payments set status = 'failed', failed_at = now() where id = pid;

  insert into transactions(payment_id, type, amount, status)
  values (pid, 'charge', amount, 'failed');

  return jsonb_build_object('status','payment_failed','payment_id',pid);
end;
$$ language plpgsql security definer;
