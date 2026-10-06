-- Verified envelopes are the durable outbox. Acknowledgements never remove evidence.
CREATE TABLE relay_routes (
  deal_id TEXT PRIMARY KEY REFERENCES deals(id), mailbox BLOB NOT NULL UNIQUE,
  generation TEXT NOT NULL DEFAULT '', cursor INTEGER NOT NULL DEFAULT 0 CHECK(cursor BETWEEN 0 AND 256)
);
CREATE TABLE relay_delivered (
  deal_id TEXT NOT NULL REFERENCES relay_routes(deal_id), hash BLOB NOT NULL,
  generation TEXT NOT NULL, PRIMARY KEY(deal_id, hash)
);
CREATE TABLE relay_inbox (
  deal_id TEXT NOT NULL REFERENCES relay_routes(deal_id), generation TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 256), raw_jws TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','rejected')),
  PRIMARY KEY(deal_id,generation,position)
);
CREATE TABLE pairing_mailboxes (
  counterparty TEXT PRIMARY KEY REFERENCES counterparties(key_id), code_hash BLOB NOT NULL
);
ALTER TABLE deals ADD COLUMN receipt_evidence TEXT NOT NULL DEFAULT 'none'
  CHECK(receipt_evidence IN ('none','seller_attested','paypal_verified'));
