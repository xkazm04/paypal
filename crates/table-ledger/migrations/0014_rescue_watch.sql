-- 0014 (user_version 14). Rescue detection: the owner's own subscriptions the wallet watches for a
-- failed renewal. The owner adds each one in the approval window; the scheduler reads it from
-- PayPal at a modest cadence (a read only, never a write) and opens at most one rescue per run of
-- failures. `recipient` is the subscriber's email as the owner entered it (the research names no
-- subscriber email field on the subscription read): it stays in this table, never in an audit row,
-- a log, a PayPal call record or the Tumbler. `failing_since` is when the current run of failed
-- payments was first seen (NULL while renewals are paid); a rescue opened on or after its UTC day
-- for this subscription is the one fix for that run. A watch is stopped, never deleted, so a
-- stopped and re-added watch keeps its run and never opens a second fix for the same failure.
CREATE TABLE rescue_watches (
  subscription_id TEXT PRIMARY KEY NOT NULL,
  recipient TEXT NOT NULL,
  plan TEXT NOT NULL,
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  added_at INTEGER NOT NULL,
  next_read_at INTEGER NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0 CHECK(tries >= 0),
  last_read_at INTEGER,
  last_failed INTEGER CHECK(last_failed IS NULL OR last_failed >= 0),
  failing_since INTEGER
);
CREATE TRIGGER rescue_watches_no_delete BEFORE DELETE ON rescue_watches
BEGIN SELECT RAISE(ABORT,'a watch is stopped, never deleted'); END;
