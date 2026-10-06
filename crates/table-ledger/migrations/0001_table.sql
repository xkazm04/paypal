CREATE TABLE mandates (
  id TEXT NOT NULL, version INTEGER NOT NULL, kind TEXT CHECK (kind IN ('open','rescue','shop')),
  body_json TEXT NOT NULL,              -- canonical JSON (JCS) of clauses
  body_hash BLOB NOT NULL,              -- sha256(body_json) = the public commitment
  owner_sig BLOB NOT NULL, agent_pubkey BLOB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','superseded','revoked','expired')),
  created_at TEXT NOT NULL, PRIMARY KEY (id, version));

CREATE TABLE counterparties (
  key_id TEXT PRIMARY KEY, owner_pubkey BLOB NOT NULL, agent_pubkey BLOB NOT NULL,
  display_name TEXT, paired_via TEXT CHECK (paired_via IN ('code','house','local')),
  words_confirmed_at TEXT, declared_payee TEXT,     -- PayPal email/merchant id they settle from
  first_seen TEXT NOT NULL, deals_closed INTEGER NOT NULL DEFAULT 0);

CREATE TABLE deals (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('purchase','haggle','shop_order','rescue','invoice')),
  side TEXT NOT NULL CHECK (side IN ('buyer','seller')), counterparty TEXT REFERENCES counterparties(key_id),
  mandate_id TEXT NOT NULL, mandate_version INTEGER NOT NULL,
  item_ref TEXT, qty INTEGER, unit_price_minor INTEGER, currency TEXT, delivery TEXT,
  state TEXT NOT NULL,                  -- see §6.3
  terms_hash BLOB, transcript_head BLOB, attempt INTEGER NOT NULL DEFAULT 0,
  market_json TEXT,                     -- Channel3 snapshot: retrieved_at, response sha256, match
  shield_verdict TEXT, decided_by TEXT, -- 'policy:clause6' | 'human:2026-..'
  pp_order_id TEXT, pp_authorization_id TEXT, pp_capture_id TEXT, pp_subscription_id TEXT,
  reconciliation TEXT CHECK (reconciliation IN ('n/a','pending_reporting','matched','mismatch')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE envelopes (
  deal_id TEXT NOT NULL REFERENCES deals(id), seq INTEGER NOT NULL, dir TEXT CHECK (dir IN ('in','out')),
  typ TEXT NOT NULL, raw_jws TEXT NOT NULL, hash BLOB NOT NULL, prev BLOB NOT NULL,
  verified INTEGER NOT NULL, received_at TEXT NOT NULL, PRIMARY KEY (deal_id, dir, seq));
CREATE TABLE nonces_seen (key_id TEXT, nonce BLOB, exp TEXT, PRIMARY KEY (key_id, nonce));

CREATE TABLE receipts (
  deal_id TEXT PRIMARY KEY REFERENCES deals(id), capture_id TEXT, amount_minor INTEGER,
  issuer_key TEXT, raw_jws TEXT NOT NULL, transcript_head BLOB NOT NULL, verified_at TEXT);

CREATE TABLE paypal_calls (
  id INTEGER PRIMARY KEY, deal_id TEXT, method TEXT, path TEXT, request_id TEXT,
  status INTEGER, debug_id TEXT, body_redacted TEXT, at TEXT NOT NULL);   -- test: 0 rows for refused deals

CREATE TABLE audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
  actor TEXT NOT NULL,                  -- 'agent:buyer-1' | 'owner' | 'policy:clause6' | 'peer:47be..'
  action TEXT NOT NULL, deal_id TEXT, detail_json TEXT NOT NULL,
  prev_hash BLOB NOT NULL, hash BLOB NOT NULL);  -- hash = sha256(prev_hash ‖ JCS(row))
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT,'audit_log is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT,'audit_log is append-only'); END;
