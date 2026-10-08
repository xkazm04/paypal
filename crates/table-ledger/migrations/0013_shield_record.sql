-- 0013 (user_version 13). Shield slice 2: the scam shield's recorded verdict says why, and the
-- owner's release of a hold is bound to the terms it was given for.
--   shield_rule          the rule that decided shield_verdict: a closed snake_case name
--                        (table_core::ShieldRule), never counterparty text.
--   shield_terms         the terms hash a verdict the rules computed was computed for. NULL for a
--                        raised verdict (a second opinion, the order check's payee BLOCK, a
--                        settlement mismatch), which holds whatever the terms. A computed verdict
--                        for older terms is not projected: a terms change makes the shield judge
--                        again.
--   shield_release_json  the owner's release of a HOLD: {"at","rules","terms_hash"}, honoured only
--                        while the deal's terms hash is the released one.
ALTER TABLE deals ADD COLUMN shield_rule TEXT;
ALTER TABLE deals ADD COLUMN shield_terms BLOB;
ALTER TABLE deals ADD COLUMN shield_release_json TEXT;
-- Before 0013 only a raise (or a settlement mismatch) wrote shield_verdict, and a release lowered
-- a HOLD to ASK. Those raises came from outside the rules, so they read as the second opinion's;
-- a mismatch hold keeps no rule (it is never released).
UPDATE deals SET shield_rule = 'model_caution'
WHERE shield_verdict IN ('ASK', 'HOLD', 'BLOCK') AND state <> 'MISMATCH';
-- A BLOCK is final: nothing lowers it and nothing releases it.
CREATE TRIGGER deals_block_stays BEFORE UPDATE OF shield_verdict ON deals
WHEN OLD.shield_verdict = 'BLOCK' AND NEW.shield_verdict IS NOT 'BLOCK'
BEGIN SELECT RAISE(ABORT,'a shield block is never lowered'); END;
CREATE TRIGGER deals_block_never_released BEFORE UPDATE OF shield_release_json ON deals
WHEN NEW.shield_release_json IS NOT NULL AND NEW.shield_verdict IS NOT 'HOLD'
BEGIN SELECT RAISE(ABORT,'only a shield hold can be released'); END;
