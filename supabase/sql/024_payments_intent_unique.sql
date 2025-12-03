create unique index if not exists payments_intent_uidx on payments(stripe_payment_intent) where stripe_payment_intent is not null;
