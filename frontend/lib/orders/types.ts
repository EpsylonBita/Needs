export type OrderCursor = { created_at: string; id: string }
export type OrderParty = { id: string; display_name: string | null; avatar_url: string | null }
export type OrderDTO = {
  id: string
  created_at: string
  status: string
  amount: number
  currency: string
  platform_fee: number
  payments_enabled: boolean
  listing: { id: string; title: string; thumbnail: string | null; available: boolean }
  buyer: OrderParty
  seller: OrderParty
  my_role: 'buyer' | 'seller'
  chat_id: string | null
  milestone: { id: string; title: string; status: string; amount: number } | null
  buyer_confirmed: boolean
  seller_confirmed: boolean
  role_review_required: boolean
  authorization_state: 'authorized' | 'unverified' | 'settled'
  capture_pending: boolean
  authorization: { expires_at: string | null; last_checked_at: string | null; provider_status: string | null; attention_required: boolean }
  cancellation: { id: string; status: 'proposed' | 'accepted' | 'rejected' | 'withdrawn' | 'canceled'; requested_by: string; reason: string; requested_at: string } | null
  cancel_pending: boolean
  stripe_canceled_at: string | null
  complaint: { id: string; status: string } | null
  disputes: { id: string; status: string; is_bank_dispute: boolean; created_at: string; resolved_at: string | null }[]
  refund: { succeeded_amount: number; pending_amount: number; failed: boolean }
  review: { id: string; rating: number } | null
  actions: { can_confirm: boolean; can_capture: boolean; can_complain: boolean; can_review: boolean; can_request_cancel: boolean; can_accept_cancel: boolean; can_reject_cancel: boolean; can_withdraw_cancel: boolean; can_reconcile: boolean }
}
export type OrderPage = { profile_id: string; payments_enabled: boolean; rows: OrderDTO[]; next_cursor: OrderCursor | null }
export type OrderCaptureResult = { captured: boolean; pending: boolean; status: string }
