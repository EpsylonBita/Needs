CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status);
CREATE INDEX IF NOT EXISTS disputes_status_idx ON disputes (status);
CREATE INDEX IF NOT EXISTS transactions_type_status_idx ON transactions (type, status);

