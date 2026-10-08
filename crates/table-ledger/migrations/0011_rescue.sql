-- 0011 (user_version 11). Subscription rescue, one lever (DECISIONS 13): a failed renewal and its one fix, and the rescue
-- invoice's two PayPal steps as reserved money operations with one request id each, exactly like
-- the order steps. SQLite cannot widen a CHECK in place, so `operations` is rebuilt with its rows,
-- and `operation_resolutions` (which references it) with it. Columns and keys are unchanged.
CREATE TABLE operations_v8 AS SELECT rowid AS old_rowid, * FROM operations;
CREATE TABLE operation_resolutions_v8 AS SELECT * FROM operation_resolutions;
DROP TABLE operation_resolutions;
DROP TABLE operations;
CREATE TABLE operations (
  deal_id TEXT NOT NULL REFERENCES deals(id), attempt INTEGER NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('create','authorize','capture','void','invoice-create','invoice-send')),
  request_id TEXT NOT NULL UNIQUE, decided_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','confirmed','unknown')),
  started_at INTEGER NOT NULL, PRIMARY KEY(deal_id,attempt,operation)
);
INSERT INTO operations(deal_id,attempt,operation,request_id,decided_by,status,started_at)
  SELECT deal_id,attempt,operation,request_id,decided_by,status,started_at FROM operations_v8 ORDER BY old_rowid;
CREATE TABLE operation_resolutions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES operations(request_id),
  observed TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('confirmed','absent','resent','needs_owner','deferred')),
  at INTEGER NOT NULL
);
CREATE INDEX operation_resolutions_by_request ON operation_resolutions(request_id, seq);
CREATE TRIGGER resolution_no_update BEFORE UPDATE ON operation_resolutions
BEGIN SELECT RAISE(ABORT,'operation_resolutions is append-only'); END;
CREATE TRIGGER resolution_no_delete BEFORE DELETE ON operation_resolutions
BEGIN SELECT RAISE(ABORT,'operation_resolutions is append-only'); END;
INSERT INTO operation_resolutions(seq,request_id,observed,outcome,at)
  SELECT seq,request_id,observed,outcome,at FROM operation_resolutions_v8 ORDER BY seq;
DROP TABLE operation_resolutions_v8;
DROP TABLE operations_v8;
-- One row per rescue deal, written once with the deal. `recipient` is the subscriber's email the
-- invoice is addressed to: it stays in this table, never in an audit row, a log, a PayPal call
-- record or the Tumbler. `offer_json` is the canonical RescueOffer the owner approves; the deal's
-- terms invoice exactly its amount. `failed_on` is the UTC day of the failed renewal: one fix per
-- subscriber per cycle.
CREATE TABLE rescue_cases (
  deal_id TEXT PRIMARY KEY NOT NULL REFERENCES deals(id),
  source TEXT NOT NULL CHECK(source IN ('replay','paypal')),
  subscription_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  offer_json TEXT NOT NULL CHECK(json_valid(offer_json)),
  failed_payments INTEGER NOT NULL CHECK(failed_payments >= 1),
  failed_on INTEGER NOT NULL,
  next_retry_at INTEGER,
  UNIQUE(subscription_id, failed_on)
);
CREATE TRIGGER rescue_cases_no_update BEFORE UPDATE ON rescue_cases
BEGIN SELECT RAISE(ABORT,'rescue cases are written once'); END;
CREATE TRIGGER rescue_cases_no_delete BEFORE DELETE ON rescue_cases
BEGIN SELECT RAISE(ABORT,'rescue cases are written once'); END;
