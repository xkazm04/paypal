# UAT backlog

Source: `docs/product/uat-insights/2026-11-06.md`. Status: `open` until recertified live (`resolved-verified`). `standard:` is "not yet consulted" until the builder reads the registry subject for the context.

| id | item | findings | status |
| --- | --- | --- | --- |
| B1 | Reconcile README / STATUS / design extract; threshold $200 vs $250 explained; ordered evaluator path; honest "no install" wording; film pointer | CHEN-01..04,-07; JUDGE-01..06 | resolved-verified (L2 recertify 2026-11-06; ceiling: STATUS.md/design extract not re-read line by line) |
| B2 | Arena + proof honesty copy, sample-data chip, director to proof link, verdict wording | SAM-01..03; CHEN-05,-06; JUDGE-07; L2B-04,-05 | resolved-verified (ceiling: word list still judges typed notes; arena logs optional-sandbox probe errors, declined) |
| B3 | Sign sheet shows amounts; setup counts and agent status agree; practice button reason; Hello dead-end next step; machinery names out of user text | L2A-06,-03,-04,-05; OMAR-04,-09; MAYA-01,-13 | done: `engine_brief` (Read, open, all windows, `{id, available}` only; fingerprint 6f9a2ffa..27dd -> 8d6b860c..d42f) + one shared `agentAppState`; footer, Set up, approval row, Charter agree live. Ceiling: header chip shows the board assistant engine (a different fact); Tumbler welcome confirmed in code only |
| B4 | Book CSV columns (decider, record hash, authorization id, deal ULID, statement); Board Book row; Stopped tile wording | PRIYA-02,-03,-05,-06; L2A-08,-09 | resolved-verified (ceiling: decided_by unknown on 8 rows; no fee column; Stopped $13,564 still includes a refused request) |
| B5 | Rescue: one "if you do nothing" answer, lever cost, monthly saved figure, refusal visible | L2A-02; LENA; MAYA-04,-05 | done (rescue refusal now a closed `RescueRefusal` enum shown as one quiet line; refused case hand-off is no longer gold). Ceiling: engine has no "too many cycles" refusal at the offer check; not independently recertified |
| B6 | Tumbler a11y: ticker persistence/pause, focus after snooze, non-colour hold vs gate, unique names, meter names | GRACE-01,-02,-04,-05; L2B-01,-02 | done (unique rule-set and Replace names, main-window Connections Replace named); not independently recertified |
| B7 | What-if: honest count, dollar total, plurals | L2A-01,-10; MAYA-02; TOM-04 | resolved-verified (ceiling: wallet cap still not shown while editing, see C1) |
| C1 | concept-doc: wallet cap visible in rule editor, full Counter hand-off, bulk rule change, named agents | TOM-01,-02,-03,-05 | concept |
| C2 | concept-doc: wallet seller counters; physical-goods capture; shop for other agents | DAN-01,-06,-07 | concept |
| M1 | method-commitment (trigger: before every submission/release): re-run `evaluate-in-20-minutes` and `first-run-onboarding` | CHEN, JUDGE voices | standing |
| H1 | hypothesis: Spend "on hold at PayPal" unconditional; verify with a `money_check` fixture | MAYA-09 | verify first |

Declined: PayPal fee column (no fee data before live sandbox runs); native zoom / screen-reader claims (unmeasurable on the mock).

## Added by recertify (docs/../uat/runs/2026-11-06-l2/recertify.md)
- R-N1 arena matched-note label: fixed (round 2). R-N2 approval/deal retry sentence: fixed (round 2). R-N4 Book CSV BOM: fixed (round 2). R-N5 unique names: fixed (round 2).
- R-N3 agent-app status differs on five surfaces: open, needs the engine_status capability decision (see B3).
- R-N6 arena ERR_CONNECTION_REFUSED probe logging: declined (cannot be silenced without changing live mode).
- Follow-ups: wallet refusal visible in Rescue needs RescueView/RescueBook to carry a refusal field; month proof bundle (PRIYA-L1-04); payee prefill on a new wallet needs backend data.

## Declined or blocked (drain 2026-11-06, client builder)
- Declined: month proof bundle (PRIYA-L1-04, "Export proofs for this month" in the Book). The only export is the `deal_export_proof` shell command, which re-verifies the audit chain and then opens one native save dialog per deal (`apps/desktop/src-tauri/src/native/commands.rs`, `Action::ExportProof`); calling it for a month's deals from the Book would stack N save dialogs and N chain verifications. The client has no zip writer and no dependency may be added, and a single bundle file would be a new signed format. Would unblock: a Rust command (a row in `authority_table.rs`) that takes a month or a list of deal ids, verifies the chain once (`Ledger::export_proofs` already does this for a limit), and writes the existing per-deal `.tableproof` files into one folder the owner picks once (or a zip, with the dependency justified in STATUS.md); the proof format stays as is.
- Blocked: payee prefill on a brand-new wallet (D3 hypothesis). The only client-readable source of a payee code is `CounterpartyDisplay.declared_payee`, which exists only after a seller has paired; a new wallet has no counterparties, no deals and no wallet-wide payee list. Blocked: needs backend data, namely the house seller's payee ref (or a `payees_known` read) exposed before the first pairing. No client change made.
- Done (client, awaiting live recertify): "Windows Hello" and `claude-code` / `codex-cli` replaced by plain words ("your fingerprint, face or PIN", "your agent app") everywhere the client words files and approval/main components say them, except the owner-agent-app picker and Details; the deal page's first-paint "4 days" now equals Rescue's "3 days 23 h" (one time-left formatter, live clock on first read); Connections Save/Replace buttons name their key. Still on screen and owned by the other builder: `windows/main/setup/circuit.ts`, `setup/common.tsx` ("Windows Hello"), `OwnerConfig.tsx` ENGINE_NAME map, `lib/firstRun.ts`.

## Round 3 (engine_brief and smaller items)
- Done: R-N3 agent-app status (B3), R-N5 Connections Replace names, Windows Hello / engine names moved to Details and the picker (UX-GUIDE line 101 updated), deal-page time-left first paint, wallet refusal visible in Rescue (+ quiet hand-off on refused cases).
- Declined: month proof bundle (only per-deal `deal_export_proof`, one save dialog each, no zip writer in the repo; needs a new bundle format or a zip dependency).
- Blocked: payee prefill on a brand-new wallet (needs backend data; `declared_payee` exists only after a seller has paired).
- Method note: `scripts/check.ps1` sets TEMP inside the repo, which fails `assistantBridge.test.ts` ("child runs outside the repo"); passes with a normal TEMP. The repo's own check cannot pass on a clean tree until check.ps1 or that test is adjusted (not touched here).
- Follow-up: the proof samples were re-recorded because the permissions fingerprint they embed changed; commit separately.
