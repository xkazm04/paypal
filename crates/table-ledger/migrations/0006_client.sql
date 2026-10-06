-- Stable local labels survive imported older ULIDs and process restarts.
-- created_at/updated_at already exist since 0001; expose those persisted values.
CREATE TABLE deal_labels (
  number INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id TEXT NOT NULL UNIQUE REFERENCES deals(id)
);
INSERT INTO deal_labels(deal_id) SELECT id FROM deals ORDER BY id;
CREATE INDEX deals_created_at ON deals(created_at);
