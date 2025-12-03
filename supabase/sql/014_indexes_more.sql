-- Critical hot-path indexes
create index if not exists payments_intent_idx on payments(stripe_payment_intent);
create index if not exists messages_chat_idx on messages(chat_id, created_at);
create index if not exists notifications_user_idx on notifications(user_id, created_at);