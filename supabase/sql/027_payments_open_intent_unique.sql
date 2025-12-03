CREATE UNIQUE INDEX IF NOT EXISTS payments_unique_open_intent
ON payments (buyer_id, listing_id)
WHERE status IN ('requires_capture', 'requires_payment_method');

