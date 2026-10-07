-- T10 read-back resolver: what the wallet learned about a money operation whose PayPal outcome
-- was unknown. The operations row keeps its request id and decided_by; this row only schedules
-- the next read and says whether the question is still open. Every change is also in audit_log
-- (money.resent, money.parked, money.resolved).
CREATE TABLE operation_checks (
  deal_id TEXT NOT NULL, attempt INTEGER NOT NULL, operation TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('parked','closed')),
  reason TEXT NOT NULL CHECK(reason IN ('unreadable','ambiguous','needs_owner','refused','window','confirmed','not_done','lapsed')),
  tries INTEGER NOT NULL DEFAULT 0, resends INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY(deal_id,attempt,operation),
  FOREIGN KEY(deal_id,attempt,operation) REFERENCES operations(deal_id,attempt,operation)
);
