# Database rate limiting

Deploy `supabase/migrations/20261026140000_atomic_rate_limits.sql` before rolling out the application version that calls `consume_rate_limit`. This migration is checked by isolated PGlite tests and was applied to the connected NEEDS project on 26 October 2026 as remote version `20261026130307`. A rollback-only live probe verified quota enforcement and left no test row. Other environments still need this migration before deploying the dependent code.

The RPC atomically inserts or increments the counter for a fixed window using the database clock. A conditional `ON CONFLICT DO UPDATE` admits no more than the configured quota for a key/window. Denied attempts leave the count unchanged. Different window sizes must use distinct keys, as the burst and sustained strategies do. Only the Supabase service role may execute the RPC or access its table.

Payment, administrative, login, registration and contact operations use `failClosed: true`: a missing migration, database error or invalid RPC response denies the operation. The legacy administrative wrapper follows the same policy. Public search retains its existing fail-open policy during storage outages. There is no non-atomic read/write fallback.

Burst limits consume the short window before checking the sustained window, so an attempt denied by the sustained limit still consumes a burst slot. Counters use fixed windows; this is not a sliding-window algorithm. The existing cleanup method removes counters older than 24 hours; schedule maintenance separately when deploying if no database cleanup job is configured.

`node --test tests/database/atomic-rate-limits.integration.mjs` verifies quota enforcement, old-window isolation, parameter validation, retry metadata, migration reapplication and role permissions. PGlite queues queries through one connection; this does not replace a multi-session staging load test.
