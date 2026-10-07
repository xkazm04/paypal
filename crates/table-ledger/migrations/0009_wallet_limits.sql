-- Wallet-wide limits (T14): owner-signed versions, append-only like mandate versions. The newest
-- version is in force; it is verified against the owner key on every read.
CREATE TABLE wallet_envelopes (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  body_json TEXT NOT NULL,              -- canonical JSON (JCS) of the WalletEnvelope
  body_hash BLOB NOT NULL,              -- sha256(domain tag || body_json)
  owner_sig BLOB NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TRIGGER wallet_envelopes_no_update BEFORE UPDATE ON wallet_envelopes
BEGIN SELECT RAISE(ABORT,'wallet_envelopes is append-only'); END;
CREATE TRIGGER wallet_envelopes_no_delete BEFORE DELETE ON wallet_envelopes
BEGIN SELECT RAISE(ABORT,'wallet_envelopes is append-only'); END;
