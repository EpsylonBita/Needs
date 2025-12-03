-- Fix critical RLS identity mapping issues for payments and milestones
-- This addresses the security vulnerability where policies compared auth.uid() against profiles.id incorrectly

-- Drop the broken payment confirmation policies
DROP POLICY IF EXISTS payments_update_buyer_confirm ON payments;
DROP POLICY IF EXISTS payments_update_seller_confirm ON payments;

-- Drop the broken milestone policies  
DROP POLICY IF EXISTS milestones_select_own ON milestones;
DROP POLICY IF EXISTS milestones_update_buyer ON milestones;
DROP POLICY IF EXISTS milestones_update_seller ON milestones;

-- Create corrected payment confirmation policies
-- These properly map auth.uid() -> profiles.user_id -> profiles.id
CREATE POLICY payments_update_buyer_confirm ON payments
  FOR UPDATE TO authenticated
  USING (
    buyer_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
  )
  WITH CHECK (
    buyer_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY payments_update_seller_confirm ON payments
  FOR UPDATE TO authenticated
  USING (
    seller_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
  )
  WITH CHECK (
    seller_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

-- Create corrected milestone policies
CREATE POLICY milestones_select_own ON milestones
  FOR SELECT TO authenticated
  USING (
    buyer_id = (SELECT id FROM profiles WHERE user_id = auth.uid()) OR
    seller_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY milestones_update_buyer ON milestones
  FOR UPDATE TO authenticated
  USING (
    buyer_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
  )
  WITH CHECK (
    buyer_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY milestones_update_seller ON milestones
  FOR UPDATE TO authenticated
  USING (
    seller_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
  )
  WITH CHECK (
    seller_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

-- Add payment audit log table for security tracking
CREATE TABLE IF NOT EXISTS payment_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  buyer_id UUID REFERENCES profiles(id),
  seller_id UUID REFERENCES profiles(id),
  listing_id UUID REFERENCES listings(id),
  payment_id UUID REFERENCES payments(id),
  amount NUMERIC(12,2),
  platform_fee NUMERIC(12,2),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT
);

-- Add security-focused indexes
CREATE INDEX IF NOT EXISTS idx_payment_audit_buyer ON payment_audit_logs(buyer_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_seller ON payment_audit_logs(seller_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_listing ON payment_audit_logs(listing_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_created ON payment_audit_logs(created_at);

-- Grant permissions for audit logs
GRANT SELECT ON payment_audit_logs TO authenticated;
GRANT INSERT ON payment_audit_logs TO authenticated;

-- Add security check constraint to prevent invalid states
ALTER TABLE payments 
ADD CONSTRAINT IF NOT EXISTS payments_buyer_seller_different 
CHECK (buyer_id != seller_id);

-- Add similar constraint for milestones
ALTER TABLE milestones 
ADD CONSTRAINT IF NOT EXISTS milestones_buyer_seller_different 
CHECK (buyer_id != seller_id);