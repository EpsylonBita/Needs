CREATE OR REPLACE FUNCTION create_payment_with_audit(
  p_listing_id uuid,
  p_buyer_id uuid,
  p_seller_id uuid,
  p_amount numeric,
  p_platform_fee numeric,
  p_intent_id text
) RETURNS void AS $$
BEGIN
  PERFORM pg_try_advisory_xact_lock(hashtext(p_buyer_id::text || p_listing_id::text));

  INSERT INTO payments (
    listing_id,
    buyer_id,
    seller_id,
    amount,
    platform_fee,
    stripe_payment_intent,
    status,
    buyer_confirmed,
    seller_confirmed
  ) VALUES (
    p_listing_id,
    p_buyer_id,
    p_seller_id,
    p_amount,
    p_platform_fee,
    p_intent_id,
    'requires_capture',
    false,
    false
  );

  INSERT INTO payment_audit_logs (
    action,
    buyer_id,
    seller_id,
    listing_id,
    amount,
    platform_fee,
    metadata
  ) VALUES (
    'payment_record_created',
    p_buyer_id,
    p_seller_id,
    p_listing_id,
    p_amount,
    p_platform_fee,
    jsonb_build_object('intent_id', p_intent_id)
  );
END;
$$ LANGUAGE plpgsql;

