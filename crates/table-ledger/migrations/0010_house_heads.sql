-- T9 glass-box HOUSE: signed heads of the house's audit chain that a buyer wallet kept. A 'receipt'
-- row is kept beside a HOUSE deal's receipt; a 'check' row is a later look at the house's record.
-- Evidence only: nothing here moves or holds money. Append-only, like the audit log; each row is
-- also in audit_log (house.head_kept, house.head_checked).
CREATE TABLE house_heads (
  id INTEGER PRIMARY KEY,
  deal_id TEXT REFERENCES deals(id),
  kind TEXT NOT NULL CHECK (kind IN ('receipt','check')),
  head_json TEXT NOT NULL,              -- canonical JSON of the SignedHouseHead (verified on keep)
  prefix_json TEXT,                     -- canonical JSON of a SignedHousePrefix fetched with it
  kept_at INTEGER NOT NULL,
  CHECK ((kind = 'receipt') = (deal_id IS NOT NULL))
);
CREATE UNIQUE INDEX house_heads_receipt ON house_heads(deal_id) WHERE kind = 'receipt';
CREATE TRIGGER house_heads_no_update BEFORE UPDATE ON house_heads
BEGIN SELECT RAISE(ABORT,'house_heads is append-only'); END;
CREATE TRIGGER house_heads_no_delete BEFORE DELETE ON house_heads
BEGIN SELECT RAISE(ABORT,'house_heads is append-only'); END;
