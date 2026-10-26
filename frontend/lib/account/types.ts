export type DeletionState = 'pending' | 'reviewing' | 'needs_information' | 'cancelled'
export type AccountBlockers = { active_orders: number; open_disputes: number; pending_refunds: number; active_milestones: number; financial_history: boolean }
export type DeletionRequest = { id: string; status: DeletionState; created_at: string; updated_at: string; reviewed_at: string | null; response: string | null }
export type AccountPrivacyStatus = { request: DeletionRequest | null; blockers: AccountBlockers }
export type AccountQueueRow = Omit<DeletionRequest, 'reviewed_at'> & { user_id: string; email: string | null; blockers: AccountBlockers }
export type AccountQueuePage = { rows: AccountQueueRow[]; next_cursor: { created_at: string; id: string } | null }
export const hasAccountBlockers = (value: AccountBlockers) => value.active_orders + value.open_disputes + value.pending_refunds + value.active_milestones > 0
