-- Additive extensions; 0001 is verbatim report §8 DDL.
CREATE INDEX deals_by_state ON deals(state, updated_at);
CREATE INDEX deals_by_mandate ON deals(mandate_id, mandate_version);
CREATE INDEX envelopes_by_head ON envelopes(deal_id, received_at);
CREATE INDEX paypal_calls_by_deal ON paypal_calls(deal_id, at);
CREATE INDEX audit_by_deal ON audit_log(deal_id, seq);
CREATE INDEX nonce_expiry ON nonces_seen(exp);
ALTER TABLE deals ADD COLUMN mode TEXT NOT NULL DEFAULT 'sandbox'
    CHECK (mode IN ('sandbox','replay','scripted_engine'));
CREATE TABLE closed_mandates (
    deal_id TEXT NOT NULL REFERENCES deals(id), attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 3),
    body_json TEXT NOT NULL, body_hash BLOB NOT NULL, agent_sig BLOB NOT NULL,
    created_at TEXT NOT NULL, PRIMARY KEY(deal_id, attempt)
);
CREATE TRIGGER closed_no_update BEFORE UPDATE ON closed_mandates
BEGIN SELECT RAISE(ABORT,'closed_mandates is append-only'); END;
CREATE TRIGGER closed_no_delete BEFORE DELETE ON closed_mandates
BEGIN SELECT RAISE(ABORT,'closed_mandates is append-only'); END;
CREATE TRIGGER audit_no_replace BEFORE INSERT ON audit_log
WHEN EXISTS (SELECT 1 FROM audit_log WHERE seq = NEW.seq)
BEGIN SELECT RAISE(ABORT,'audit_log is append-only'); END;
CREATE TRIGGER mandate_body_immutable
BEFORE UPDATE OF id, version, kind, body_json, body_hash, owner_sig, agent_pubkey, created_at ON mandates
BEGIN SELECT RAISE(ABORT,'mandate versions are immutable'); END;
CREATE TRIGGER no_calls_for_refused_deal BEFORE INSERT ON paypal_calls
WHEN EXISTS (SELECT 1 FROM deals WHERE id = NEW.deal_id AND state = 'REFUSED')
BEGIN SELECT RAISE(ABORT,'refused deal cannot reach PayPal'); END;
