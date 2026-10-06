CREATE TABLE negotiation (
  deal_id TEXT PRIMARY KEY REFERENCES deals(id), offer_seq INTEGER NOT NULL,
  terms_hash BLOB NOT NULL, own_accept INTEGER NOT NULL DEFAULT 0, peer_accept INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE operations (
  deal_id TEXT NOT NULL REFERENCES deals(id), attempt INTEGER NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('create','authorize','capture','void')),
  request_id TEXT NOT NULL UNIQUE, decided_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','confirmed','unknown')),
  started_at INTEGER NOT NULL, PRIMARY KEY(deal_id,attempt,operation)
);
CREATE TABLE deadlines (
  deal_id TEXT PRIMARY KEY REFERENCES deals(id), due_at INTEGER NOT NULL, authorization_at INTEGER
);
