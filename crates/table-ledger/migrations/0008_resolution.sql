-- Evidence that settles a money operation whose PayPal outcome was unknown. The operations row
-- is never rewritten: resolution appends one row per finding, keyed by the request id.
--   confirmed   PayPal's truth shows the operation committed; its deal event was applied.
--   absent      PayPal's truth shows it did not commit, and it will not be sent again.
--   resent      the original request (same request id, same authority) was sent once more.
--   needs_owner the resolver cannot settle it; the owner decides. Never retried in a loop.
--   deferred    the read-back itself failed; the next tick tries again.
-- IF NOT EXISTS: a ledger reopened from an older user_version re-runs later migrations.
CREATE TABLE IF NOT EXISTS operation_resolutions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES operations(request_id),
  observed TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('confirmed','absent','resent','needs_owner','deferred')),
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS operation_resolutions_by_request ON operation_resolutions(request_id, seq);
CREATE TRIGGER IF NOT EXISTS resolution_no_update BEFORE UPDATE ON operation_resolutions
BEGIN SELECT RAISE(ABORT,'operation_resolutions is append-only'); END;
CREATE TRIGGER IF NOT EXISTS resolution_no_delete BEFORE DELETE ON operation_resolutions
BEGIN SELECT RAISE(ABORT,'operation_resolutions is append-only'); END;
