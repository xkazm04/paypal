# Backend status

Updated 2026-10-06: **wave 0 port gaps** are built end to end (see "Wave 0 port gaps" below; seven
new read/restrict commands, one event, four contract fields, no migration, no dependency).
Earlier (2026-10-03): **all seven client backend requests are implemented and offline-tested.**
Owner ACCEPT, pairing handoff, safe display reads, browser handoff events, timestamp/
currency projections, native snooze and mandate slots are registered end to end.
Bindings and client lib/mock use the real contract; window folders are unchanged.
The co-hosted deterministic seller uses the durable Pipeline, signed relay transport,
release-owned public build pin and env-only server configuration. HOUSE pairing and
`/v1/house/tables` work with that release configuration. H6 starts with a fresh wallet
and closes through an in-process HTTP relay with mocked PayPal. Real release identity/
credential provisioning, Linux container/mount behavior, Render deployment/cold-start
measurement and native client UAT remain unverified; no production pin or secret was
invented or written. Rescue, catalog and financial crash-gap repair remain deferred,
in that order. Native engines remain unavailable until their pre-input isolation
contract is proven. P1, P2, P5 and relay pairing/delivery were already complete.
The client-request session adds no new dependency. No real model run,
live PayPal call, deployment, GUI launch, native keyring write or git state change occurred.

| Phase | Status |
| --- | --- |
| B0 Scaffold | Complete: workspace, Apache-2.0, pinned toolchain, CI and lints. |
| B1 Core + attention | Complete: exact money, signed clauses, state machine, rescue guards, attention ladder/forms/placement. |
| B2 Protocol | Complete: closed signed envelopes, pairing, replay/binding checks, transcript commitments and safe projections. |
| B3 Ledger | Complete: report DDL, repositories, migrations, append-only hash chain, redacted evidence and offline verification. |
| B4 PayPal + market | Core complete; P3 adds offline-tested secondary clients and native market refresh. Rescue execution/live API conformance remain deferred. |
| B5 Engines | P2 adds native process lifecycle, version probes and actor integration. Native availability still requires live isolation conformance. |
| B6 MCP | Seven implemented tools with role/session/run/mandate checks; catalog tools deferred. |
| B7 App + services | Core, relay pairing/delivery, buyer evidence and hosted HOUSE implemented. Financial crash-gap recovery remains deferred. |
| B8 Desktop + bindings | Complete committed shell baseline: Windows Tauri compile, three windows/capabilities, read/routing commands, targeted events, tray/hotkey/single-instance, generated TypeScript and handoff. P1 supersedes its guarded unavailable payment handlers; native behavior still needs interactive verification. |
| P1 Native activation | Core, relay/receipt and hosted HOUSE implemented and offline-tested; P3 rescue and native UAT remain. |
| P2 Native engines | Process/actor/MCP lifecycle implemented; 134 offline tests pass. Native availability remains gated by unproven pre-input inventory ordering. |
| P3 Tools/endpoints/rescue | Partial: cached market/Book tools, privileged native market refresh and typed secondary endpoint clients. Catalog tools and durable rescue execution remain deferred. |
| P4 Two machines | Implemented offline: code-only pairing/delivery, buyer evidence/reporting and hosted HOUSE. H6 closes from a fresh wallet. Release provisioning, real connectivity and native UAT remain unverified. |
| P5 Spike runbook | Complete: eight one-command ignored/env-gated tests, safe structured result recording and documented limitations. Version-only spike 6 passes; live spikes unrun. |

## Wave 0 port gaps (2026-10-06)

Brief: `docs/build/PORT-GAPS-BRIEF.md`. The six steps were built in order, each end to end (Rust
field or command, label gate and capability, regenerated `bindings/`, mock parity in
`src/mock/backend.ts` + `fixtures.ts`, and the client page that showed the gap). `scripts/check.ps1`
was green after every step. Nothing here moves money: no new command reaches PayPal, no new
privileged command exists, refused intents still write zero `paypal_calls` rows, and `audit_log`
gained no UPDATE/DELETE path. No migration and no new dependency (the `decided_by` column was
already in 0001; credential dates are `local_preferences` rows). Items owned by moonshot themes
(T1, T5, T6, T12, T14) were not built.

| Step | Contract added | Gate | Client now shows the real fact |
| --- | --- | --- | --- |
| 1 Deal facts | `Deal.decided_by?: DecidedBy` (owner / policy clause N / seller or HOUSE mandate / safe default) | existing Deal reads | Spend lane outcome + inspector, Book "Policy vs me" lens and row detail, Deal Mirror decision row |
| 2 Counterparty | `CounterpartyDisplay.pairing` (`words_confirmed` / `house_pinned` / `unpaired`) and `.declared_payee`; `counterparty_note(DealArgs) -> CounterpartyNote \| null` | note: **main only** (never Tumbler, never approval) | Deal Mirror who/payee rows and note, Tables / Spend / Shield "note ›" chips, Shield words inspector, Counter "Their words" and buyer pairing/payee |
| 3 Pairing lifecycle | `pairing_abort(PairingAbortArgs {pairing_id? \| code?})`, `PendingPairing.expires`, event `pairing:pinned` → main, `house_wake() -> HouseState` | abort: main + approval (no token, no unlock; approval only for its own pairing, by id); house_wake: main | Pairing desk "Stop waiting" / "They differ: end it" end the pairing in Rust, Pin step turns done on `pairing:pinned`, "Wake it now"; approval "They differ: abort" calls Rust and shows "confirm before" |
| 4 Approval hand-off | `ApprovalOpenArgs.target?` (`deal` / `pairing` / `credentials` / `mandate` / `unlock`) and `.draft?` (`band` / `floor` / `lever`); `approval_handoff() -> ApprovalHandoff` | draft only from main; read approval only | Tables band hand-off pre-fills approval BandAdjust; Counter floor hand-off opens the mandate editor with the band floor pre-filled; Rescue lever choice shows in approval; Setup buttons open on credentials / mandate / unlock |
| 5 Owner facts | `audit_page(AuditPageArgs) -> AuditPage` (newest first, `before` exclusive, 1-200); `owner_facts() -> OwnerFacts` (lock_in, last Transaction Search poll, engine probe time/detail, credential stored dates, agent roster) | audit: main; facts: main + approval | Book "Audit trail" sheet and "polled HH:MM" statement header; Setup lock "locks in N min", "probed HH:MM", credential "stored <date>", agent roster |
| 6 Book query | `book_query(BookQueryArgs {query: raw JSON}) -> BookAnswer` over the existing closed `BookQuery` | main | Book lenses run in Rust; the slip shows Rust's aggregate rows; a rejection is INVALID with "BookQuery rejected: <reason>" verbatim |

How each fact is grounded:

- **decided_by** is the authority recorded with the decision, the same value the hash chain carries:
  money operations already wrote `deals.decided_by` (finish_operation); now an outbound ACCEPT
  writes `human` (owner proof) or `policy clause 6` (agent ACCEPT refuses an ASK), a mandate refusal
  writes `policy clause N` (`Ledger::refuse`), and a pre-capture deadline lapse writes
  `safe_default {deadline}` (`Ledger::apply_deadline_default`, used by the pipeline tick, the
  runtime scheduler and the hosted HOUSE). The refusal and lapse transitions put `decided_by` in
  the same audit row. Text that is not canonical `DecidedBy` JSON projects as absent, never guessed.
  A signed WITHDRAW does not set it (owner or agent cannot be told apart at the ledger).
- **Notes**: inbound `NOTE` envelopes are now committed to the signed transcript by
  `receive_haggle` (previously refused as INVALID). A note is no intent: no mandate check, no state
  or terms change, never in the agent projection, the attention snapshot or the transcript steps.
  `Ledger::latest_note` re-verifies the chain and returns the latest inbound note, capped at 280
  characters (the protocol bound), never parsed. **Deviation:** a behaviour change in protocol
  intake, within the design's "human-only quarantined content".
- **Counterparty list** now lists every counterparty row; a key the owner never confirmed reads
  "Unpaired counterparty" (its stored name is never shown) with `pairing: unpaired`.
- **pairing_abort** forgets the pending pair and the creator's offer for that code (memory only, as
  pending pairings always were); it is idempotent and never pins. `pairing:pinned` is produced by
  the actor after `pairing_confirm` succeeds (new `Runtime.emitted` buffer drained by the actor loop).
- **house_wake** reuses the HOUSE state machine (idle → waking → ready; a failed wake drops back to
  idle through the existing guard) and sends one bodiless `GET /healthz` to the deployment's
  rendezvous origin (`RelayApi::wake`, our own service route; no PayPal call, no pairing).
- **Drafts** are checked in Rust for binding only (target matches selection; band: deal before
  settlement with a band naming the item, one currency, floor ≤ ceiling; floor: an active mandate
  whose band names the item, its currency, not above the ceiling; lever: a rescue deal). They are
  kept for the approval window and never signed, rebound or sent; `band_set` / `mandate_sign`
  re-check everything when the owner signs there.
- **Audit rows** cross as closed facts only: seq, at, actor, action, deal id, typed `decided_by`,
  `from` / `to` states. Row detail (hashes, request ids, payloads) never crosses. The whole chain
  is verified before each page.
- **book_query** is the assistant's closed BookQuery, now also an owner read. Rejections name the
  rule in fixed words (`BookQuery::rejection`, `table_ledger::book_query_rejection`) or carry the
  serde schema error verbatim; they never echo a filter value. The read-only connection is unchanged.
  The assistant's MCP `book_query` still maps an invalid query to LEDGER_TRUST (unchanged), now with
  the specific reason text.

Tests added: ledger `decided_by_records_refusal_clause_and_safe_default_in_row_and_audit`,
`counterparty_projection_names_pairing_status_and_declared_payee_only`, owner-accept and
latest-note assertions in `owner_accept_is_pinned_atomic_audited_and_transcript_excludes_peer_prose`,
`rejections_name_the_rule_in_fixed_words_and_never_echo_a_value`; app pipeline assertions for agent
ACCEPT (policy 6), seller mandate, safe default and last reporting poll; runtime
`counterparty_projection_and_quarantined_note_read_are_main_only_and_inert`,
`pairing_abort_is_unprivileged_and_scoped_and_confirm_tells_main_it_pinned`,
`house_wake_is_main_only_moves_no_money_and_a_failed_wake_returns_to_idle`,
`approval_open_targets_and_drafts_are_checked_prefill_only_and_never_signed`,
`owner_facts_and_audit_pages_are_read_only_closed_and_label_scoped`,
`owner_book_query_is_closed_main_only_and_rejections_are_verbatim_invalid`; desktop precise label
grants for all seven new commands. Client: `src/lib/portGaps.test.ts` (one test per step, mock gates
and fixtures), book lens grouping, Spend recorded-refusal lane, Deal Mirror decided line, pairing
Pin step. Mock store key bumped to `the-table-mock-state-v5`.

Gates at the end of wave 0: client typecheck clean, **312 vitest tests**, CSP-clean build; Rust fmt
and clippy `-D warnings` clean, **206 passed / 0 failed / 9 ignored** (baseline before the wave: 197 / 9; client 305). During step 2 the existing
`table-engine` test `native_stdin_stderr_terminal_and_temp_cleanup` timed out once under machine
load and passed on rerun (unrelated to this wave; noted as a flaky timing test).

UNVERIFIED (wave 0): that a `GET /healthz` shortens a hosted cold start (Render cold-start timing
was already unverified; `RelayApi::wake` in `crates/table-relay`). No PayPal endpoint, field or
limit was added; the last-poll fact reads the already-used `/v1/reporting/transactions` call rows.

Deferred within wave 0, and why: the approval window's owner configuration does not yet show
credential dates or the lock countdown (Settings in Main does; `owner_facts` is granted to approval
for it); a Counter hand-off carries one floor (one seller mandate holds one band, so further floors
go one hand-off at a time); the rescue lever draft is shown, not approvable (`rescue_approve` stays
UNAVAILABLE until the rescue executor, out of scope); typed Book questions stay preset-only (no
engine turns text into a BookQuery). No step needed the shop catalog or the rescue executor.

## UX pass for non-technical owners (2026-10-06)

Every client surface was rewritten for a PayPal merchant who is not a developer. Rules live in
`docs/ux/UX-GUIDE.md` (read it before any UI work), findings and results in `docs/ux/UX-AUDIT.md`,
and the shared vocabulary in `apps/desktop/client/src/lib/words.ts`. What changed:

- Display and copy only. No contract, command, mock-shape or gating change.
- Status pills are sentence case, money uses the tabular sans font (`--num`), and "If you do
  nothing" lines carry an hourglass.
- The deal page shows five milestones instead of ten states.
- `?` opens a keyboard-shortcuts sheet in Main.

Round 1 (structure) followed the same day: every screen answers first, then shows one decision card, with the
expert view behind Simple / Detailed (`docs/ux/ROUND-1.md`, kit `shared/ui/story.tsx`); 370 client tests green.
Round 2 (approved screens only, each behind a switch in the `?` sheet; `docs/ux/ROUND-2.md`) followed: hold to approve,
"what happens next" and Why? in the approval window, plus bolder Shield / Rescue / Book / Connections / Tumbler views;
452 client tests green. UNVERIFIED: the subscriber-facing invoice and email wording in `modules/rescue/preview.ts` is
illustrative; the fixed rescue template text is not in the research yet.
Round-2 verdict: seven experiments promoted to permanent code (approval window hold / next / Why?, Shield,
Rescue, Connections, Tumbler). "Accept an offer" needs work but is kept as is (no rework). Book is not reviewed and
stays behind its `r2-book` switch. The frozen screens are unchanged. 453 client tests green.

One behaviour fix: Spend "Asks you" now matches the attention clause by clause type number
(regression test in `spend/gate.test.ts`). Client 317 tests green, typecheck clean.

Requests for the core:

- `table-attention`: plain headline verbs and `on_silence` text. The client rewrites them for now
  via `headlineWords` / `silenceWords`.
- `ApprovalSummary.unavailable_reason`: plain text (`reasonWords` for now).
- A user-facing `WalletError` message per code.

## Page prototypes awaiting verdict (2026-10-06)

`prototype/index.html` (regenerate with `node prototype/build-index.mjs`) gathers three UX variants for
each of the 13 pages: Home (the three UI-contest entries; The Dial was decided on 2 Oct), Tables,
Spend, Shield, Counter, Rescue, Book, Deal, Setup, Tumbler (v1 = `prototype/tumbler`), Approval,
Mandate, Pairing. The 35 new variants are under `prototype/pages/<page>/variant-N/` and follow
`prototype/pages/BRIEF.md`; they share the `prototype/shared/` theme and bar and the
`prototype/main/fixtures.js` data. All pass a headless smoke test (no JS errors, no horizontal
scroll at 1024/1280/1920). The owner picks per page; the client is not changed until then.

**v2 rework (same day, owner notes: "space inefficient", "text overhaul", light PayPal theme).**
All 39 variants and the landing page now share the v2 baseline: `prototype/shared/tokens.css`
(dark Dial palette plus a light PayPal palette via `data-theme="light"` (palette hues UNVERIFIED
against PayPal's brand guide), a macOS type scale 13/12/15/17/20/26 with a 12px floor, a 4 pt grid,
28px rows, 26px controls), `shared/ui.css` (`ui-*` components) and `shared/ui.js` (layer 2:
`UI.sheet/popover/inspector/toast`). The reference page is `shared/baseline.html`. Every page is
two-layer: indicative rows carry the key metadata and the default on silence, and all detail opens
in a sheet, popover or inspector. Pages hold no colour literals. Only the landing page
(`prototype/main`) shows the Dark / Light switch (`localStorage` key `table-theme`). The body type
is now 13px; the old "body >= 14px" note is superseded, and acceptance U4 (nothing under 12px)
still holds. The client (`apps/desktop/client`) still uses the v1 tokens until the verdict.

**Verdict (owner, 2026-10-06).** The baseline v2 is accepted. Chosen variants: Home the Dial (v3,
decided 2 Oct) · Tables v3 Price Ladder · Spend v2 The Gate · Shield v2 Evidence matrix · Counter v1
Counter board · Rescue v3 Lever Matrix · Book v1 Ledger Lens · Setup v2 The Circuit · Tumbler v1 the
puck (`prototype/tumbler`) · Approval v3 The Diff, with the window and its sheets 20% wider
(620 → 744 px, applied) · Mandate v3 What-if replay · Pairing v1 Two desks · Deal v1 Mirror. The
report stars the picks, and the prototype bar links to them. **Ported into `apps/desktop/client` the
same day** per `docs/build/CLIENT-V2-PORT.md`: 305 client tests, `scripts/check.ps1` green, approval
window 744 × 660 in Rust. The consolidated backend requests are in CLIENT-STATUS.md "v2 port".

**Owner decisions, 2026-10-06 (after the port).**
- **Tumbler sizes:** card 440×152, stack 440×336, handoff 440×160, welcome 440×228. Applied in
  `table-attention` placement, client `FORM_SIZE` + test, and the window-duality spec table.
- **Demo data follows Rust** (not `mandate.rs`): one mandate per role. M-12 purchases (no band),
  M-14 haggle (v2 history + v3 band over the three monitors), S-2 / S-3 seller floor groups, R-3
  rescue. Rust allows one band per mandate, so **per-SKU floors need one seller mandate per floor
  group** (a design gap against §10.5 "per-SKU floors"; the Counter page reads one band today).
  Also: D-0193 names clause 6, D-0199 carries the $339 SETTLE, Q-0207 is a live quote, rescue
  D-0182 (offer open) and D-0178 (recovered), and the mock has a `?locked=1` switch.
- **Shield follows Rust's rule order** (`table-shield::rules`): payee mismatch or F&F → BLOCK; no
  market reference → ASK; over 1.4 × the median → HOLD; a new counterparty (< 24 h) over the
  threshold → ASK. The §10.5 wireframe line "HOLD · new counterparty · $140" is superseded. D-0198
  is now a HOLD because $70/unit is 59 % over a $44 median. The client Shield matrix and the
  prototype data say so; "no reference" reads "asks you", never "skipped".

Open design questions the builders raised (still unanswered):

- Shield (settled 2026-10-07, H5 slice 1): a new counterparty over 100.00 is ASK. The code
  (`table_shield::rules`) and the §7 rule table agree; the fixtures/§10.5 HOLD is drift that shield
  slice 2 fixes. The 100.00 threshold holds in every currency for the submission.
- Mandate: Revoke is let through the idle lock (restricting is free) although §9 lists it as privileged.
- Mandate/Counter: a newly signed version governs only next actions; signing a higher floor withdraws
  live quotes below it (no money moves). Both are builder readings, not design text.
- Approval: $329 is p65 by interpolation from the fixtures' p25/median/p75; the §10.3 wireframe says p78.
## T1 proof bundle (2026-10-06, branch t1-proof-bundle)

Owner-chosen first slice of theme T1 (docs/concepts/moonshot-backlog.md §1a). A deal's evidence exports as
one signed file (`table.proof.v1`, `table_proto::ProofBundle`) and `crates/table-verify` checks it offline:
`cargo run -p table-verify -- <file>.tableproof` prints nine checks and exits 0 only when all hold.
- Export: `Ledger::export_proof` re-verifies the transcript and audit chain before copying anything;
  `Action::ExportProof` signs the evidence head with the agent key the deal's mandate names;
  `deal_export_proof` (main + approval, not Tumbler) saves through a native save dialog. The mock
  answers UNAVAILABLE; the deal record has a 'Save signed proof' button.
- Proof: the two-wallet settlement test exports both sides, requires all nine checks, and forged five
  bundles at first (PayPal amount, capture authority, transcript byte, audit row, payee) that each
  failed; it forges fifteen since the council-lite r1 rework in the bullet below.
- What the verifier cannot prove from the file: an owner decision (`DecidedBy::Human`) is the wallet's
  record, not an owner signature (owner ACCEPT proofs are signatures and are checked); the HOUSE release
  pin is not in the bundle; truncation of the wallet's own audit tail needs an external head (T9).
- Since Wave 0 commits inbound NOTE envelopes to the transcript, a bundle can carry counterparty
  Note text inside a signed JWS. It is never printed or parsed by the verifier; share bundles knowing that.
- Not yet run: the native save dialog (compile/clippy only, no GUI harness). The verifier logic mirrors
  the ledger's transcript/audit checks rather than sharing code; the export-then-verify test guards
  that parity.
- Council-lite r1 rework (council run 536d1a41; rework merged as a95b80a, 2026-10-07): the PayPal-order check fails any 2xx order create,
  authorize or order read with no stored binding, and names the call. Bundles from before bindings
  were stored (pre-0007) now fail by design; a deal with no order call passes. Check 4 ('closed
  mandate binds terms and amount') compares each countersigned payee with the owner-signed
  approved-payees clause and claims only what it compared. Every check has a stable id. The
  two-wallet settlement test forges fifteen bundles, at least one for each of the nine checks,
  including a payee outside the list re-signed with the seller's own agent key; each asserts its
  own named check fails. assert_proof_verifies exports and verifies four more shapes in
  forecast_tests.rs: no money operation, a clause 6 countersign, a safe-default void, and a mandate
  revoked after close. The deal record's 'Save signed proof' button warns once before saving: the
  file carries the deal's rules, including price limits, payees and caps, and the other side's
  notes. The Book has 'Check a proof file': a main-only proof_check command that reads the file in
  Rust through a native open dialog, caps it at 8 MiB, and runs the same verifier through
  table_client::check_proof_file. The sheet and the table-verify CLI both state the owner-key anchor
  and the T9 limit (removed newer records cannot be seen). Not yet run: the native open dialog (no
  GUI harness); client tsc/vitest in a worktree.
- Council-lite r2 (2026-10-07, council run 2026-10-07-audit-trail-export-lite-r2, at 3e9bcae): ready,
  overall 0.63. Scores: value 0.56, craft 0.66, robustness 0.72; coverage 0.70. Rivalry and economics
  were not judged. Uncalibrated; one session judged all rows. All six r1 lines are closed, each with
  a test.
  - Open must-address: the owner-key anchor cannot be acted on. No screen shows an owner their own
    key, and the Check a proof file sheet shows only 40 of the key id's 64 hex characters.
  - Open, not must-address:
    - A reader without the desktop wallet cannot check a bundle. That includes an accountant and the
      no-install judge path (T7, not built).
    - On a pre-0007 bundle, the PayPal-order line reads as failed rather than not checked.
    - The Audit sheet is a dead end when the chain fails.
    - No test exports from a corrupt chain or with a missing key.
    - The rework's client TypeScript has never been typechecked: a worktree has no node_modules.
  - Gates were cited, not run: 39e07aad's merge gate at 3e9bcae passed `cargo test --workspace`.
- UNVERIFIED: the PayPal-order check (feb5cc6) needs, from each 2xx order create, authorize and order
  read, the stored binding of every purchase unit: custom_id, invoice_id, payee.merchant_id and
  amount (kept by `binding_projection`, crates/table-ledger/src/redaction.rs:94; compared in
  `bindings`, crates/table-verify/src/lib.rs:323). The client asks for the full body with
  `Prefer: return=representation` (crates/table-paypal/src/client.rs:161), but no live authorize
  body has been observed, so that the authorize answer carries all four is assumed. If it lacks
  them, the wallet's own Order::verify (crates/table-paypal/src/types.rs:168) refuses the order,
  and in any bundle that does record the call the person checking sees the PayPal-order line fail
  ("no order binding was recorded", or "the order record lacks custom_id, invoice id or payee"), not
  "not checked". Sandbox spike 3 collects the evidence (docs/build/SPIKES.md section 3).

## Incidental sweep (2026-10-06)

The 2026-10-05 moonshot scan (`/scan-sweep`, ideas-only) logged 47 distinct small defects
(48 rows: HOUSE capacity was found twice). This sweep worked them down: **36 fixed** in
32 commits (`a48b3c4`..`0c98a1c`), **4 rejected** on re-check, **3 left for an owner
decision** and **4 folded into backlog cards**. Full gate after the last commit: client 131 tests,
Rust 196 passed / 0 failed / 9 ignored (env-gated live spikes), fmt and clippy clean. No new
dependency.

Behaviour changes worth knowing:
- HOUSE capacity (64) now counts only reservations whose deal is still pre-capture, and a request
  writes its reservation and counterparty row only after the binding and mandate checks.
- **Deviation from design §8:** the rendezvous no longer serves `DELETE /v1/mailbox/{h}`. No wallet
  called it, and unauthenticated it let anyone who learned a mailbox hash force a generation reset.
  Long-polls now wake per mailbox.
- Mandate signing rejects mixed clause currencies and haggle/shop-order mandates without a band.
- Mandate signing also refuses roles that cannot act on the per-deal kind (clause 1) and a price range missing the side the allowed roles use (clause 4); the approval editor mirrors both.
- Mandate authoring rework (council run 0a0c3888): (1) `list_mandates` returns
  `ListedMandate { mandate, refusal }`; a signed set today's `validate()` refuses is listed with
  that refusal (after its commitment and owner signature are checked) instead of failing the
  whole list, `active_mandate` still refuses it, and Withdraw works on it. IPC: one optional
  field `MandateListEntry.refusal` (new binding `Refusal`); Mandates page and approval list and
  editor show it with one plain sentence and keep Withdraw. Test: table-ledger
  `a_signed_mandate_todays_rules_refuse_is_listed_flagged_never_active_and_revocable`.
  (2) `sign_mandate` and `band()` run `validate()` first and return `REFUSED` with the reason,
  not a ledger-trust fault. Tests: table-runtime `signing_refuses_a_mandate_no_role_can_act_under`
  (now asserts REFUSED), `a_band_change_that_clears_the_only_bound_is_refused_and_nothing_moves`,
  `signing_a_mandate_needs_the_approval_label_and_its_token`. (3) Client: Review & sign and the
  sign sheet are disabled while the draft has problems; a REFUSED shows in the editor's words
  (`refusalWords`); BandAdjust warns when a change clears the deal side's bound; the sign sheet
  says open haggles need starting again. Tests: `mandateDraft.test.ts`, `limits.test.ts` (pure
  TS; tsc/vitest not run in the builder's worktree).
- The owner key is minted only for a fresh ledger (`Ledger::is_fresh`); every later read path
  uses `existing_signing_key` and fails closed when the entry is missing.
- `set_deadline` takes the write time and appends a `deadline.set` audit row in the same transaction.
- Relay routes of terminal deals stop being polled once nothing is owed (a Receipted route stays
  polled so a relay restart is noticed), and only pre-capture routes count toward the 64-route cap
  (Captured and Receipted routes release theirs).
  `create_deal` writes the silence deadline before relay binding. HOUSE `Seller::table` order:
  create the deal, set the silence deadline, bind the relay, list, and reserve the request slot
  last (scan C-3). A request that fails midway leaves a Pairing deal that lapses on its deadline and
  holds no request slot; its retry makes a fresh deal.
- Daily budget (scan C-4): a deal's place in the day's `max_deals_day`/`max_total_day` is fixed when it first agrees (audit order); only deals that agreed earlier that UTC day count against it, open tables never do, and a deal past agreement with no readable agreement row counts against all others.
- Deals under a retired (revoked/superseded) mandate are left to their deadline default; the inbox
  rejects their messages once (`envelope.rejected`) instead of faulting every tick.
- `Pipeline::tick` attempts every due deal and returns the first error afterwards.
- MCP-layer refusals (session not enabled, tool outside the role catalog, malformed call) append
  `intent.refused` via the new `AgentService::record_refusal`. `send_offer` advertises the closed
  Delivery enum. The engine tool allowlist equals the MCP catalogs (`table_mcp::catalog`); codex
  items yield one event each.
- `ErrorCode::Refused` (`REFUSED`) separates mandate refusals from `INVALID`; binding regenerated.
- `ShortText` refuses bidi embeddings/overrides/isolates/marks and zero-width spaces (joiners stay).
- Timestamps are bounded by `MAX_SAFE_INTEGER` (same value as `MAX_MINOR`).
- Attention: actions offered only when the state machine accepts them; gates name the counterparty
  label and clause 6; the in-memory notification set is pruned. Tumbler surface writes are debounced
  (400 ms) - **compile/clippy-verified only, needs the native check**.
- Attention, walk-away forecast (T4 slices 1-2): `table_attention::forecast` mirrors
  `scheduler.rs` `tick_deal` at b260727 and, since slice 2, the gates inside the pipeline calls it
  makes. Shield rule: a create (`Authority::Policy`) or an authorize/capture
  (`Authority::SellerMandate`) line appears only if the pipeline's own gate passes at the step's
  time; the shield refuses both on ASK (market reference absent or older than 900 s, new
  counterparty above 100.00) and on HOLD, and nothing refreshes the market while the owner is away.
  `Pipeline::step_allowed` is a read-only twin of the checks create/authorize/capture run before any
  write or PayPal call (same `authority()` and `shield()`); the runtime finds the seller-mandate
  window by binary search over it. A buyer-approval line carries `before`, the latest time the
  approval still counts. A capture line ends in `Receipted` (capture records the receipt in the
  same call). `AttentionSnapshot.forecast` (optional; 72 h horizon over every open deal, lapse-chosen
  and snoozed included; `None` on a read error) is filled by `Runtime::attention()`; bindings
  regenerated. Tests: the property test
  `forecast::tests::forecast_never_moves_money_out_over_every_input` (now also over the
  seller-mandate window, and checks no refused step is forecast), the unit tests
  `seller_agreed_without_a_market_reference_forecasts_only_its_lapse`,
  `seller_agreed_with_a_fresh_market_forecasts_the_create` and
  `a_market_stale_by_the_steps_time_forecasts_no_money_step`, and the differential test
  `crates/table-runtime/src/forecast_tests.rs` (TestClock + OfflineHttp, ticks at every line's time
  and checks state, `decided_by` and audit; buyer approval is simulated by the offline poll). Slice 3
  remains: the Tumbler "If you walk away" block and the quit confirm.
- Attention fixes (council attention-escalation): a failed attention read is one visible Fault per
  streak and clears the cache (a83458f); a notification claim is released when no toast was shown
  (3ac0b38); Let it lapse needs a Gate whose card offers it (c734558).
- **attention-escalation council-lite r2 rework (2026-10-07; d7d74cf, a3d4908, 83f70dc).**
  - Each Tumbler card's silence line is now worded from the same snapshot's forecast, by `table_attention::word_silence`. A seller card says the payment the buyer approved is collected, or put on hold, instead of 'no money moves'. With no forecast, it promises nothing.
  - The forecast shows authorize and capture only when the payment executor is configured; without it, they fail the tick.
  - The shell shows each failure streak once, to main and the tumbler (`fault_previous` is cleared on a good attention read). The tumbler shows a notice that the cards may be out of date.
  - UX-GUIDE question 3 is updated.
  Tests: `silence::tests` (a card per forecast ending, `card_and_forecast_agree_over_every_input`, `unreadable_forecast_promises_nothing_for_a_seller_that_may_move` and `without_a_payment_executor_the_card_does_not_claim_money_in`), `forecast::tests::without_a_payment_executor_no_authorize_or_capture_is_forecast` and `native::events::fault_tests::each_failure_streak_is_shown_once`. Client tsc and vitest were not run in the worktree.
- Client: honest checklist lines (amount/evidence are notes, not passes), Spend card shows the
  purchase mandate, DND toggle keeps live form/position, mock revoke/band_set mirror Rust.

Rejected on re-check (no change): the shield's payee/F&F inputs (SETTLE carries no payee and
`Order::verify` already enforces the PayPal payee binding); `reconcile`'s `owner` actor (matches the
main-window convention; authority is `decided_by`); a 2xx PayPal body that fails to decode stays
`unknown` (money may have moved; resolving it is the read-back resolver's job); `Quarantine` stays
unmounted (no window receives counterparty free text).

**Owner decisions (resolved 2026-10-06):**
- **cargo-deny runs in CI** (`2d6d15d`, new `deny` job). `cargo deny check` (0.20.2) passes all four
  checks with three scoped allowances: `Apache-2.0 WITH LLVM-exception` only for `target-lexicon`
  (Tauri's Linux tray stack), `allow-wildcard-paths` for the unpublished workspace members, and
  RUSTSEC-2024-0370 ignored (`proc-macro-error` unmaintained, compile-time, via GTK3; no upgrade).
  The workspace-resolution errors went away with the wildcard setting.
- **Audit append checks the tail, the whole chain at checkpoints** (`35c680c`). An append verifies
  the last row's hash, its link and a gap-free sequence; full verification runs on open, in
  `verify_audit` and on every append whose seq is a multiple of 500. A tampered last row fails the
  next append; an earlier one fails open/`verify_audit` at once and the next checkpoint append.
- **PayPal binding facts are kept** (`7d08e66`, migration 0007). `paypal_calls.binding_json` holds per
  purchase unit `custom_id`, `invoice_id`, `payee_merchant_id` and amount, identifier shapes only;
  `body_redacted` is unchanged and payer text, names, addresses and links never reach either.
  **Deviation from design §8 DDL:** one added column. Rows written before 0007 have NULL bindings.
  Note (2026-10-07): the live path filled this column from the already-redacted body until scan C-2 was fixed (see Security fixes); it now projects from the raw body.

Folded into backlog cards (`docs/concepts/moonshot-backlog.md`): unauthenticated mailbox creation
(relay-and-rendezvous-1), production use of `get_authorization` (money-pipeline-1), product id on
stored market evidence (market-data-2), per-role prompts and role-narrowed engine inventories
(agent-tool-surface-1, engine-adapters-1).

## Decisions and deviations

- **Client requests (2026-10-03):** `deal_owner_accept` requires approval label,
  IPC token, unlock and selected deal. Use DecisionArgs with `counter_hash` from
  ApprovalSummary; it is required for this command. The digest identifies the
  exact last inbound COUNTER, including a later round with identical terms.
  The owner signs a domain-separated consent over deal, sequence, terms hash,
  counter digest and owner public key. ACCEPT carries that proof inside the usual
  mandate-agent JWS. Both wallets check the owner's pinned key; the atomic commit
  records `actor=owner`, `decided_by=owner`, signature and bindings in the hash chain.
  Legacy ACCEPT envelopes retain their original canonical bytes when no proof exists.
  Agent ACCEPT now explicitly rejects clause-6 ASK. Owner authority preserves all
  mandate/velocity/round/deadline/shield checks and requires no buyer credentials.
  The two-wallet and HOUSE offline settlement tests use owner ACCEPT above threshold.
- `approval_open({deal_id:null,pairing:pairing_id})` from Main selects a pending
  pairing. `approval_pairing` is an approval-only read, available while locked;
  it returns id, four words, house flag and fixed Rust-composed context. Unknown or
  expired selections fail; confirmed/expired reads are null. Confirmation still
  requires approval/token/unlocked and all exact words. Nothing is paired by routing.
- Migration 0006 assigns persistent local deal numbers, backfills existing deals in
  id order and indexes creation times. Importing an older ULID never renumbers an
  existing label. `created_at`/`updated_at` were already in migration 0001, so no
  duplicate columns or invented timestamps were added; projections parse the stored
  Unix seconds, and market/shield/mandate/operation/reconciliation writes update them.
  DealDisplay titles use the owner's locally bound signed `item_ref`; descriptive
  catalog titles await the existing deferred catalog work. Historical signed mandate
  evidence supplies bands even after revocation, without granting authority.
  Transcript reads verify the full chain and return only the seven typed price/status
  steps; NOTE, HELLO, raw JWS, URLs, peer prose and signatures are omitted. Counterparty
  labels are owner-entered pairing labels, with URL-shaped labels replaced by fixed text.
  Closed-deal counts derive from receipted/reconciled ledger rows.
- `tumbler:handoff` is emitted only to Tumbler after a successful Rust system opener
  and checked actor handoff; its deadline comes from the recorded approval window.
  No client URL is accepted or emitted. `deal_snooze` is now Tumbler-only, persists
  30 minutes, and requires a GATE strictly more than 45 minutes from its deadline.
  HOLD bypasses snooze and a shortened deadline pierces it at the 15-minute rung.
  Snooze never changes deal/default/deadline and the independent scheduler still runs.
- `wallet_spend_today_currency` is the common recorded deal currency, or null for an
  empty/mixed-currency wallet. Accounting remains unavailable (`meters_available=false`);
  no exchange conversion or spend total was invented. Timestamp metadata defaults to
  unavailable (zero) for legacy serialized snapshots; zero timestamps are omitted.
  The new currency/counter metadata and false owner-accept capability are compatible
  with older snapshots in generated TypeScript. Treat absent `can_owner_accept` as
  false and absent timestamps/currency as unavailable. Native reads supply stored
  timestamps and the new metadata. This preserves the unchanged window test fixtures
  in approval/gating.test.ts and tumbler/logic.test.ts; there are no remaining type errors.
- `mandate_list` returns flattened MandateListEntry with the original signed payload/
  signature plus `agent`, resolved from the pinned public key against the three local
  slots. Agent metadata is outside the signed payload. Client pending.ts re-exports
  generated safe projection types; the browser mock implements the commands and targeted
  event with the same label/token/unlock/selection gates. Only lib/mock client sources
  were edited. The optional degraded preview now explicitly simulates an older shell.

- **Hosted HOUSE boundary (2026-10-03):** shipping builds require the public
  TABLE_HOUSE_RELEASE_JSON compile pin: owner/agent public keys, payee, mandate hash
  and owner signature over the hash. No response or IPC can supply a replacement pin.
  Server seeds, signed mandate and sandbox credentials are loaded only from named
  environment variables; startup checks matching keys/hash/signatures/validity before
  binding HTTP. No actual owner release configuration was available or provisioned
  in this session. Debug builds without a public pin honestly report HOUSE unavailable.
  [DEPLOY.md](DEPLOY.md) documents offline public-key/signing/release helpers and all
  environment names; private values are never emitted, put in build args or stored
  in files. These provisioning inputs remain the release owner's responsibility.
- HOUSE derives a separate stable pairing seed per buyer/release, sends a signed
  initiating identity to the co-hosted /v1/house/tables endpoint, and verifies the
  signed response against the compiled pin and mandate. The response binds buyer,
  seller identity, unique deal ULID, category, initial terms and negotiation deadline.
  Retries reuse the durable reservation and signed listing. Wallet owner word
  confirmation still requires approval/token/unlocked, records PairedVia::House and
  retains the signed table for checked deal_join. Arbitrary HOUSE peer bundles,
  changed tables/payees/keys/mandates and expired bindings fail closed.
- The seller drives its pure Policy through checked Wallet intents, never an engine
  or a second payment executor. Declined below-floor proposals advance only signed
  history with refusal evidence; they cannot become accepted deal terms. Lawful
  counters and two ACCEPTs use the existing transcript. Round accounting now counts
  negotiation offers/counters, rather than LISTING/ACCEPT/financial envelopes, and
  rechecks the accepted round for settlement. Private merchant/counterparty prose is
  never a Policy instruction or client motion string.
- **Explicit HouseMandate authority:** verified, release-pinned owner policy may handle
  ASK (including genuinely absent/stale market evidence) without inventing a market
  snapshot. It is restricted to sandbox seller Haggle, quantity one, DigitalNow and
  clause-6 Allow; every operation records the mandate hash in decided_by and the audit
  chain. HOLD/BLOCK, fresh-market price HOLD, revoke, thresholds, per-deal/daily limits,
  verified buyer APPROVED and deadlines remain enforced. Authorized holds void; silence
  never captures. No model or IPC command can install that authority.
- Seller delivery uses the same RelayApi and durable routes/inbox/outbox/acknowledgements;
  the co-hosted MemoryStore implementation avoids loopback networking. SQLite financial
  truth survives disk reopen; relay generation loss replays signed history without a new
  create/capture. Unknown operations remain reserved. Missing SETTLE/RECEIPT producers
  after confirmed financial operations are deliberately still deferred.
- Render now uses one paid single instance and persistent disk, with auto-deploy off.
  This replaces the former free relay-only configuration because house financial truth
  cannot be volatile. Root and compatibility deployment files are current. Wallet
  get_settings/settings:changed expose typed house idle/waking/ready/unavailable while
  the off-actor request waits; cancellation clears waking and wallet deadlines continue.
  Signed negotiations default after five minutes (or the earlier mandate deadline),
  then normal approval/authorization defaults apply. Sessions/routes are capped at 64.
  Existing dependencies are reused; zeroize was already in the workspace dependency
  graph. No new Rust dependency family or live IO test was added. The container uses
  Debian util-linux/setpriv to drop privileges after preparing fresh mount ownership;
  actual Linux mount behavior remains unverified.

- **P4 pairing boundary (2026-10-02):** pairing_create publishes a signed identity
  JWS to H(code) when the deployment relay is attached; pairing_join accepts an
  omitted/null peer and discovers the initiating bundle by code; pairing_poll on
  the creator fetches the signed reply (null until one arrives). The reply commits
  to the entire initiating identity, including payee and expiry. Owner and agent
  signatures, distinct pairing JWS type, canonical payload, code, opposite side,
  expiry and reply commitment are checked. Echoes and malformed packets cannot pin
  an identity; conflicting valid candidates fail closed. Repeated joins/polls reuse
  the same signed bundles and words. All four words still require each owner's
  approval/token/unlocked confirmation, which atomically pins the peer and seed.
  Codes are consumed on creator confirmation. Offers/pending peers remain transient,
  expire within 24 hours and share a 64-session limit; process restart before
  confirmation requires a fresh code. Four caller-owned pairing IO jobs maximum run
  outside the actor; dropping a caller releases its IO permit. Missing/failed relay
  operations report UNAVAILABLE. Before confirmation, repeated polling re-publishes
  the identical offer after relay loss, and repeated joining re-publishes the reply.
  Pairing does not call PayPal. The offline two-wallet settlement test now uses the
  actor's public pairing/create/join/configuration actions and passes only the code
  between installs. No files/bundles are copied by that path.
- **P4 transport/receipt boundary:** prioritised under the owner's demo instruction.
  Migration 0005 stores routes, generation/cursor, staged inbox and acknowledgements.
  Verified outbound envelopes are the outbox, so committing an envelope also makes it
  deliverable; no separate memory queue can lose it. Pairing confirmation atomically
  pins the shared code hash with the counterparty. Mailboxes derive from that hash
  and the common deal ULID. Routes are immutable and capped at 64. Four background
  relay jobs run at a time, with two-second long polls and exponential failure backoff
  capped at 32 seconds. Scheduler/defaults remain independent of these jobs.
- The relay's /sync endpoint carries a random generation. Volatile server loss resets
  the cursor and requeues previously acknowledged signed envelopes. Byte-identical
  sends are deduplicated by the relay; wallet duplicate/echo handling uses the verified
  envelope digest. Inbox staging and cursor advancement share a transaction; a crash
  after semantic commit is recovered by digest detection. Protocol rejections retain
  a digest and fixed reason in the audit log, without consuming a nonce or accepted
  transcript head. Financial truth mismatch raises a hold, as described below.
- Buyer SETTLE acceptance checks amount, invoice, AUTHORIZE intent and exact PayPal
  host. A signed truth mismatch atomically enters MISMATCH/HOLD. Buyer RECEIPT acceptance
  atomically commits the verified envelope, receipt, capture reference, RECEIPTED state
  and SELLER_ATTESTED/pending_reporting evidence. It accepts only sandbox buyer haggle/
  shop resources with a recorded SETTLE, matching amount and preceding transcript head.
  It never calls PayPal or invents buyer approval/authorization/capture observations.
  Order/capture ids follow the PayPal client's closed identifier policy, keeping peer
  prose out of Deal.paypal and the engine projection.
- deal_evidence supplies typed chips; deal_reconcile uses the configured own-account
  SecondaryApi and bounded reporting pages. Promotion requires one successful matching
  capture, amount, currency and debit/credit direction, plus durable redacted reporting
  evidence. Missing rows stay pending; changed amount/currency is a mismatch; duplicate,
  reversed or incomplete results cannot promote. Query filters are audited separately
  from the ledger's allowlisted resource path. The [PayPal reporting definition](https://developer.paypal.com/api/transaction-search/v1/definitions/transaction_detail_list/)
  confirms status S and signed decimal syntax. **UNVERIFIED:** buyer-account reporting
  uses a negative debit and the seller's capture id as transaction_id; different mappings
  fail closed. Live permissions, account ownership and lag remain unverified.
- Native deployment attaches the HTTPS relay client only when TABLE_RELAY_URL is set;
  no URL is accepted from IPC. Signed pairing bundles now exchange through that relay;
  an explicit peer bundle remains supported for offline/manual pairing.
  Seller deal_create publishes a checked LISTING when pairing has a relay binding; buyer
  deal_join creates the local mandate-bound haggle with that seller's ULID and terms.
  ApprovalSummary.can_open_paypal is separate from can_release: a buyer needs unlock
  and a verified SETTLE to open PayPal, but needs no local merchant credentials.
- **Remaining work is explicit:** no catalog or durable rescue executor was added;
  rescue_approve remains UNAVAILABLE. Hosted HOUSE supersedes the former unavailable
  boundary; rescue, catalog and confirmed-create/capture message repair remain deferred.
- P5 adds eight compiled ignored conformance tests behind explicit opt-in gates;
  scripts/spike.ps1 checks required environment names, restores its gate and records
  only structured non-secret evidence. Direct PayPal fixtures are diagnostic sandbox
  clients, not production authority or wallet receipts. Unknown outcomes require
  checking recorded resource/request ids before a new run. Loopback-vs-scheme API
  acceptance and OS delivery are separate; no custom-scheme handler is registered.
- Version-only spike 6 first exposed Node rejecting Rust's verbatim canonical script
  path (EISDIR). Resolution now retains canonical identity but passes Node the normal
  absolute spelling; direct and npm probes both pass. Versions remain claude-code
  2.1.287 / codex-cli 0.160.0. Both attempts are retained in SPIKE-RESULTS.md;
  no model was started. Other seven owner spikes remain unrun.
- **P3 cut line:** market_reference reads only a fresh, matching cached snapshot;
  book_query is Assistant-only and accepts a closed BookQuery, never SQL. It binds
  filter values and runs on SQLITE_OPEN_READ_ONLY for files or a query-only memory
  snapshot for injected tests. Aggregates group by currency AND mode. Market deltas
  are integer basis points; amounts are minor units. recovered_sum counts only
  sandbox rescue receipts with confirmed capture/verification, excluding REPLAY
  and scripted-only records. This is a query invariant, not a completed rescue service.
- Native market_refresh is approval/token/unlocked/selected-deal gated because
  choosing the product influences payment evidence. Channel3 fetch runs outside
  the actor, then Rust rechecks terms hash, mandate id/version and currency before
  storing/auditing the snapshot. MCP cannot choose a product or trigger the fetch.
- SecondaryApi supplies Invoicing create/send/get, subscription get/suspend/activate/
  revise/OUTSTANDING_BALANCE capture, bounded Transaction Search pagination (20 pages,
  500 per page, 31 days, three calendar years) and disputes list/get. Recording
  transports cover each method/path/body without test sockets. No plan-wide pricing
  method or arbitrary plan override exists. Secondary POSTs make one attempt; a
  local request id is not assumed to prove server idempotency. Clients are deliberately
  NOT wired to rescue_approve without durable operation reservations and authority.
  [Invoice spec](https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/invoicing_v2.json)
  and [subscription spec](https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/billing_subscriptions_v1.json)
  were read to confirm fields; no live API call was made. time 0.3 (already transitive)
  provides RFC3339/calendar bounds; rusqlite's backup feature supports memory read-only
  query snapshots. No new dependency family was introduced.
- Remaining P3 catalog/search/quote/checkout and rescue detection/levers/accounting
  orchestration require additional domain/durable state work. They are deferred at
  this tested boundary to reserve time for P4 review and the runnable P5 spikes.
  The server advertises only the seven implemented tools, never the deferred three.

- **P2 boundary (2026-10-02):** Windows direct executable and recognized npm package
  resolution bypass shell shim execution. Children start suspended, join a kill-on-close
  Windows Job Object before resuming, and use CREATE_NO_WINDOW. Tests spawn only our
  offline fixture and prove stdin ordering, stderr draining, bounded streams, watchdog,
  tree cancellation, future-drop cancellation, schema checks and temporary cleanup.
  Environment is cleared and a small OS/auth-location allowlist restored. API keys,
  parent-run controls, proxies and NODE_OPTIONS are excluded. Temporary MCP files hold
  environment placeholders, never tokens. Windows Job API is the new narrow unsafe
  boundary; dependencies reuse existing windows/zeroize/ulid/getrandom packages.
- P2 attaches an async actor-backed loopback MCP service. Sessions are capped at 64,
  expire at 120 seconds and cannot invoke tools before inventory validation. Runs are
  capped at four, one per deal, with bounded queues and 64 retained non-secret summaries.
  Run starts/ends are audited; interrupted jobs do not automatically resume. Pause
  cancels and revokes every job while payment polls/defaults continue. Main has explicit
  resume/start/list commands. The default scripted fixture only invokes a checked
  table-view read and is labelled SCRIPTED_ENGINE; it does not pretend to bargain.
  MCP binds the Rust run id into its session; queued intents recheck that exact run
  and its expiry, so pause/restart cannot lend a replacement run to an old request.
  Role follows the mandate-pinned signing key; an assistant key gets Book access.
- Help/version-only probes found **claude-code 2.1.287** and **codex-cli 0.160.0**.
  Codex exec help confirms --ignore-user-config, --ignore-rules, --ephemeral,
  --skip-git-repo-check, --sandbox, --json and --output-schema. Claude help confirms
  its tools/MCP/permission/settings/input-stream flags. Native probe returns the
  parsed version plus unavailable reason: neither installed CLI has yet established
  a usable inventory before stdin. No prompt is sent to a real CLI in this session.
  UNVERIFIED: codex env_http_headers/default_tools_approval_mode behavior; native
  NDJSON input shape/init ordering. Spikes 1/2 must provide evidence before enabling
  an installed version. There is no boolean IPC override for this safety condition.

- **Money authority clarification replaces the former approval-only conflict decision.**
  AGENTS.md (2026-10-02) permits Rust money calls on: an owner decision from the
  approval window with IPC token and unlocked session; a rule in an owner-signed
  mandate (clause-6 policy, seller authorize/capture after buyer PayPal approval,
  or the house's release-pinned mandate); or a safe default void/expiry. Defaults
  never capture. The pipeline records each operation's `decided_by` and audit
  authority. `SellerMandate` includes the mandate hash; `SafeDefault` includes
  the deadline. The house exception is resolved but is not activated without its
  release-owned key/mandate. No agent tool can call a payment client.
- AUTHORIZE remains the intent for every order, following the safety spine instead
  of the shop's illustrative CAPTURE example.
- Toolchain 1.97 is pinned. Build caches, compiler output and temporary files are
  confined to `.build/` and `target/` by the PowerShell wrappers. No git
  state-changing command was run; design, research and prototype were only read.
- Ordinary tests inject recording HTTP transports and exercise axum Routers in
  process instead of wiremock: no test socket or network activity. Ignored owner
  spikes explicitly opt in to live IO. No live API/model run or desktop launch ran.
- B6 introduced the minimal `table-app::Wallet/AgentService` before B7, resolving
  the brief's dependency order. AgentService owns no PayPal client. B7 extends it
  with the pipeline. Roles/categories/deal scopes originate in trusted Rust.
- Time is integer Unix seconds from a Clock boundary. Money is checked integer
  minor units in a supported ISO subset, capped at the exact JSON integer range;
  strings supply decimals. PayPal additionally rejects KWD/BHD and fractional HUF.
  A supported domain currency is not a promise of live API support.
- Unit bands apply to unit price; quantity totals govern deal/day velocity.
  Velocity reserves non-refused active deals in the UTC day and excludes the
  current deal. Settlement authority rechecks the signed mandate and pairing.
  Poll/authorize/capture/void require the recorded settlement attempt before any
  call; Replay mode cannot grant payment authority or run deadline mutations.
  Seller merchant identity comes from its own single-payee mandate.
- Shipping capture is bounded to the 72-hour honor window. Added AUTHORIZED,
  VOIDED, AUTO_VOIDED and FAILED states cover held funds/failure. Negotiation
  deadlines withdraw; approval deadlines expire; held funds require confirmed void.
- Protocol v1 uses standard compact Ed25519 JWS input, JCS payloads, SHA-256 of the
  entire JWS for the head, byte-array hashes/nonces and integer timestamps. Pairing
  has 128 random bits and four fixed-list SAS words ordered buyer then seller.
  A RECEIPT commits the preceding head, avoiding a circular hash.
- Migrations 0001 and 0002 preserve B3's DDL/integrity protections. Additive 0003
  records accepts, durable unique operation reservations and deadlines. Offer
  terms/head/state/envelope and each ACCEPT commit atomically. API outcome,
  references, state transition, redacted calls and observed authority commit
  atomically. An unknown operation remains reserved and cannot be recreated with
  a fresh attempt.
- Create reservation/BeginSettlement and the later deadline/SETTLE writes are
  separate transactions. A crash can require repair, but cannot repeat create.
  Recovery tooling is deferred. Invalid approval hosts/mode binding enter MISMATCH
  and retain response evidence; failed poll evidence is retained.
- PayPal response evidence is allowlisted and redacted against current OAuth
  credentials/token before it leaves the client; raw response text, merchant
  descriptions and OAuth payloads never enter IPC. Transport failures have
  status-0 evidence. Full typed responses are used locally for truth verification.
- Shield model output can only increase caution. HOLD/BLOCK void an existing
  authorization immediately. ASK requires a bound owner ticket at create,
  authorize and capture; missing/stale references cannot become CLEAR. The
  initial new-counterparty threshold is 100 major units in the deal currency
  and must become an owner-configured policy before deployment.
- Approval sessions begin locked. Successful privileged activity resets the
  15-minute idle clock; reads/background ticks do not. Owner tickets bind
  deal/hash/attempt, expire after 60 seconds and change generation after re-auth.
  NativeReauth is a trusted Rust trait; P1 attaches HWND-scoped Windows Hello.
  Neither unlock nor its verified completion can be supplied by a webview boolean.
- Deadline lapse is idempotent and writes one transition audit. Confirmed void
  writes authority, transition and observation audits (three), retaining financial
  evidence rather than matching W6's illustrative single-row count.
- The audit preimage remains `{seq,at,actor,action,deal_id,detail_json}`, canonical
  and excluding hash fields. Genesis is zero; hash chains previous bytes plus JCS.
  Full verification occurs on open, in verify_audit and every 500th append; other appends
  check the row they chain onto (2026-10-06). UPDATE/DELETE/REPLACE abort.
  Without a separately signed head, valid suffix removal cannot be detected.
  Export anchoring remains deferred.
- Channel3 wire paths were checked against primary documentation:
  [similar](https://docs.trychannel3.com/api-reference/v1/similar-products.md),
  [start tracking](https://docs.trychannel3.com/api-reference/price-tracking/start-tracking.md),
  [history](https://docs.trychannel3.com/api-reference/price-tracking/get-price-history.md).
  Actual API paths are /v1/similar and /v0/price-tracking/start and /history/{id}.
  Lowest offer per product avoids merchant-count weighting. Lexical JSON numbers
  are parsed as strings, never floats. Cache is memory-only with 15-minute
  freshness; explicit stale retrieval is informational. Tracking is opt-in.
- Native engine availability is deferred because the required pre-input isolation
  evidence is not established: codex-cli thread.started lacks the required
  tool/server inventory; claude-code init occurs after initial input according
  to the research. Synthetic fixtures are labelled and do not prove live CLI
  behavior. P2 supplies a typed deal projection as input only after accepted inventory;
  the scripted fixture performs one checked read and makes no bargaining claim.
- The relay server is bounded in-memory storage: 24-hour TTL, 16-KB compact-JWS
  shape cap, 256 mailboxes, 256 messages each, cursors and <=25-second long-poll.
  Wallet delivery state is durable SQLite; the server neither verifies nor interprets financial bodies. House policy is
  deterministic and never counters below floor. The co-hosted HOUSE endpoint is
  implemented with release/env checks; the standalone relay has no house authority.
- Native Tauri is Windows-only in this boundary. Contract/capability tests compile
  on other platforms without GTK; Ubuntu runtime support is not implemented.
  Tauri is pinned to 2.12.1. Runtime windows start from an empty config window list.
  Background attention arrivals show the hidden puck without activation;
  summon/review actions activate windows. Native no-activation still needs an
  interactive test.
- P1 supersedes B8's unattached-shell state. The native actor exclusively owns the
  ledger, Pipeline, signing selection, auth session and scheduler. Its command queue
  is bounded to 64; the event ring is bounded to 128 and native consumers refresh
  projections after a lag. One-second native ticks process deadlines and ten-second
  order polls. Failures on one deal do not starve another deadline. Unknown money
  operations remain reserved; ticks never retry with a fresh operation identity.
- Keys are generated once in the OS keyring: owner plus distinct negotiator,
  shopper and assistant slots. A mandate pins the applicable agent key, which Rust
  selects before signing/payment. No private key has an IPC representation. Lost or
  malformed key material fails closed; no automatic ledger/key reset exists.
- **Credential entry is native, not a React secret form.** `set_credentials` accepts
  only `paypal_sandbox` or `channel3`; after label/token/unlocked checks, a native
  CredUI dialog obtains values. Rust rechecks privilege before writing one keyring
  entry. Cancellation writes nothing, buffers are zeroized, and credential updates
  invalidate the cached OAuth token without making a network verification call.
  `payment_executor_configured` means stored credentials, not live credentials proven
  valid. CredUI's password entry buffer supports 256 UTF-16 code units.
  [Microsoft CredUI documentation](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-creduipromptforcredentialsw)
  documents the generic/always-show/do-not-persist flags.
- Windows Hello uses the desktop HWND interop, not the UWP-only prompt API. Only
  `Verified` produces an internal, non-serializable re-auth proof. The prompt runs
  outside the actor; generation checks reject superseded completions. Unlock records
  completion time; read/timer activity never refreshes privileged idle time.
  Other platforms return typed UNSUPPORTED. Desktop HWND interop requires a supported
  Windows version (Microsoft documents build 22000 as the minimum).
  [UserConsentVerifier desktop guidance](https://learn.microsoft.com/en-us/uwp/api/windows.security.credentials.ui.userconsentverifier),
  [interop requirements](https://learn.microsoft.com/en-us/windows/win32/api/userconsentverifierinterop/nn-userconsentverifierinterop-iuserconsentverifierinterop).
  `native_reauth_available` reports the attached adapter; actual Hello configuration
  is checked when unlocking and may return UNAVAILABLE.
- Configuration review can open `approval` with `{deal_id:null}`. Mandate sign,
  version, revoke, focused band changes, pairing confirmation and deal creation
  require that label, its IPC token and an unlocked owner session. This follows P1's
  explicit privileged requirement; Main's sheets must hand off to approval. Band
  changes sign a new version and rebind the selected pre-settlement deal. Other deals
  referring to a superseded version fail closed until deliberately rebound. Sign and
  rebind are separate durable writes: a crash can stop a deal, never authorize it.
- Pairing now creates and checks signed identity bundles (owner and agent signatures,
  code hash, side, payee, expiry), returns all four words and a signed reply, and only
  pins identity and the shared mailbox seed atomically after owner confirmation.
  Bundle exchange is relay-backed; code-only join discovers a remote machine and
  the creator polls for its signed reply. HOUSE additionally verifies the public
  compile pin and signed hosted table. Pending unconfirmed pairings are
  memory-only, expire after at most 24 hours and are capped at 64.
- `deal_withdraw` writes a signed WITHDRAW without unlocking. `deal_let_lapse`
  dismisses the item to its existing deadline default, suppressing policy progress;
  it does not pretend funds expired/voided early. Defaults continue while paused,
  locked or with all windows hidden, and never capture. `deal_void` requires an owner
  ticket and writes durable authority/outcome. HOLD release moves only to ASK, cannot
  release BLOCK, and subsequent mandate/shield checks still apply.
- Browser handoff verifies the complete stored transcript and the bound SETTLE's
  terms, invoice, attempt, order id and sandbox host, and rechecks the active mandate.
  The client supplies only DecisionArgs and receives null; Rust passes the verified
  URL to the system opener. Seller-owned orders poll without a webview. Buyer-side
  haggles do not use buyer credentials to operate the seller's API resources; that
  P4 now delivers and accepts the signed receipt as SELLER_ATTESTED. Buyer purchase orders poll after recorded
  browser handoff. Seller DigitalNow authorize/capture uses signed mandate authority
  after verified buyer approval; missing/stale market evidence can still require ASK.
- `deal:changed`, `receipt:created`, `attention:changed`, `settings:changed` and
  `wallet:error` now have actual actor producers. Accounting meters remain explicitly
  unavailable; neither spend nor recovered revenue is fabricated. First-run state
  depends on an active owner-signed mandate. Pause is sticky, prevents automatic
  policy create, and leaves existing order polls/deadline defaults running. P2 also
  cancels/revokes jobs and attaches explicit resume/start controls.
- Native arrival uses SW_SHOWNOACTIVATE, remembered physical puck coordinates are
  clamped through the tested work-area placement code, form/pin/snap preferences
  persist, and native drag release classifies/saves a snap. Main snaps follow visible,
  non-minimized Main. Quiet/breathing hints are emitted for the client; the client
  must apply reduced-motion preferences. OS notification attempts are durably claimed
  once per deal/deadline at the 15-minute rung and respect native/user DND and the
  notification toggle. Clicks focus only the corresponding Tumbler card. The plugin's
  desktop builder discards action callbacks, so the native code uses its underlying
  `tauri-winrt-notification` wrapper for clicks; the notification plugin is registered.
  Windows notification identity/delivery still needs packaged-app UAT. Quit lists
  pending ids (including dismissed gates), explains what stops, and validates a hash
  of the current deals before exiting. Main starts centered at 1440x900 outer bounds,
  capped to 90% of its work area. Approval opens beside whichever window requested
  review, flips left when needed, and clamps on a small work area. Hidden construction
  avoids showing the initial size/position; the native adapter accounts for window
  chrome in its outer bounds. These helpers are tested at 100/125/150% scale;
  actual mixed-DPI chrome and placement still need native UAT.
- Additive migration 0004 stores non-secret native preferences, immutable deal category
  context and browser handoff state. Existing financial/audit protections and report
  DDL remain intact. Legacy deals without category context cannot obtain new payment
  authority; no category is guessed. Trusted market evidence has a validated/audited
  repository write; P3 attaches privileged native fetching and rechecks bindings
  after the fetch before storing it.


## Dependencies

Existing B0-B3 dependencies remain. New direct dependencies: reqwest 0.12 with
rustls for bounded HTTP without redirects; tokio for async IO; async-trait for
injected object-safe boundaries; axum for MCP/relay; tower test-only for in-process
requests; ts-rs 12 for generated contracts; Windows Tauri 2.12.1 plus single-instance,
global-shortcut and opener plugins. serde_json arbitrary_precision preserves
market number lexemes; JCS compatibility tests pass. No real credentials or private
keys were loaded or committed. Tests generate ephemeral keys and mock secrets in memory.

P1 adds `keyring` 3.6.1 (Windows native backend), direct `zeroize` for temporary secret
buffers, and the official `windows` 0.62.2 / `windows-future` 0.3.2 crates (already
present transitively) for HWND-scoped Hello, native credential UI, no-activation and
OS notification-state checks. The notification/dialog plugins and the notification
plugin's WinRT wrapper provide native toast clicks and pending-gate Quit confirmation.
`table-runtime` and `table-os` are new local crates. Only the narrow, documented OS
interop modules allow unsafe FFI; the OS crate uses `deny` instead of `forbid` for
that lint so the explicit audited boundaries can compile. P2's engine crate also
uses deny with one documented Windows Job Object module allowing unsafe FFI.
Other crates retain unsafe-forbid. P2 reuses windows/getrandom/ulid/zeroize and
async-trait; P3 adds direct time 0.3 for reporting calendar bounds (already transitive)
and rusqlite's backup feature for read-only memory snapshots. Engine spike-only
dependencies reuse the existing app/MCP/ledger/axum packages. No new dependency
family was introduced. P4 adds the local table-relay crate to isolate the typed,
bounded HTTPS client; its reqwest/url/serde/async-trait dependencies already exist.
Runtime tests add existing rendezvous/tower packages for in-process HTTP requests.
Relay pairing moves the shared identity types and their JWS codec into table-proto;
its new direct ts-rs dependency and table-client's direct table-proto dependency reuse
existing workspace packages to keep protocol validation and generated IPC types in sync.
Dependencies remain Apache-2.0-compatible.

`deny.toml` now permits Tauri's unmodified MPL-2.0 dependencies, Zlib dependencies,
and webpki-roots' CDLA-Permissive-2.0 data. Apache-2.0 remains the repository/crate
license. [Mozilla's compatibility/distribution guidance](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)
allows combination with Apache code and requires source availability notices for
distributed MPL components. [CDLA terms](https://cdla.dev/permissive-2-0/) cover the
root-certificate data. Bundle generation is disabled; packaging must include
third-party licenses and source notices before distribution.

## Validation

Windows, Rust 1.97.1: `cargo fmt --all --check`,
`cargo clippy --workspace --all-targets -- -D warnings`, and
`cargo test --workspace` pass. **180 passed, 0 failed, 9 ignored** at the client-request
boundary (hosted HOUSE baseline 170, P1 baseline 125). Client typecheck, **101 vitest
tests** and production build also pass. The new tests cover owner proof/pin/rollback,
stale identical counters, owner gates and limits, pairing handoff, safe read gates,
label migration/timestamps, snooze/default independence and exact capability grants. Tests cover rejected origins/tokens/lock/selection/hash/
attempt leaving zero payment calls, real actor settlement/browser binding/owner void,
independent deadline progress after unknown void, signed withdrawal, no-assent dismissal,
owner-only HOLD release and permanent BLOCK, signed pairing/replies/words, mandate
version/band/revoke, native credential gating/cancellation, zero-secret IPC inputs,
idle expiry, an in-flight OS prompt with continuing deadlines, persisted preferences,
real receipt events and durable notification claims. P2/P3 add native fixture
process trees, pre-input refusal, stream/version bounds, watchdog/drop cleanup,
inherited environment canaries and token-free temporary configuration,
MCP capacity/expiry/inventory/run bindings, active mandate revoke, pause/restart,
market IO gating/stale binding, read-only Book memory/file connections and injection,
REPLAY-excluding recovery queries, secondary request shapes/single-attempt POSTs,
report pagination and fixed return destinations. P4 adds disk reopen/cursor recovery,
receipt/SETTLE rollback and binding rejection, reporting provenance/mismatch/direction/
pagination checks, and a two-wallet actor test negotiating and settling through the
relay HTTP router in process, starting from code-only pairing and privileged word
confirmation. Pairing tests cover signed reply commitment, key/payee/expiry/JWS
tampering, malformed/echo/conflicting messages, role/origin checks, idempotent retries,
relay loss before confirmation, consumed codes, shared session/IO capacity limits and
an indefinitely pending transport with continuing actor deadlines.
The settlement test loses the relay mailbox after settlement and
proves redelivery preserves both heads and makes no second capture. The buyer makes
zero PayPal calls. Browser availability without local buyer merchant credentials is
tested separately. HOUSE adds H6 (equal heads/capture ids, one create/authorize/capture,
zero buyer API calls, no fabricated market), public/env binding and redaction, deadline/
HOLD/BLOCK/revoke/refusal checks, waking/cancellation/capacity, integer-limit Policy and
file-ledger reopen/mailbox-loss recovery. Bindings drift tests pass.
Native Windows shell/library/binary compilation is included in the workspace checks;
desktop GUI was not launched. Client-request checks are the commands above;
previous boundary logs: `.build/house-check.log`;
earlier logs `.build/p4-final-clippy.log`, `.build/p4-final-tests.log`,
`.build/P1-check.log` and `.build/P1-licenses.log`.

All phase boundaries passed fmt/clippy/test:

| Boundary | Passed / ignored | Local log |
| --- | --- | --- |
| B3 baseline | 64 / 0 | .build/B3-check.log |
| B4 | 72 / 1 | .build/B4-check.log |
| B5 | 78 / 1 | .build/B5-check.log |
| B6 | 82 / 1 | .build/B6-check.log |
| B7 | 94 / 1 | .build/B7-check.log |
| B8 final | 102 / 1 | .build/B8-check.log |
| P1 activation | 125 / 1 | .build/P1-check.log |
| P2 infrastructure | 134 / 1 | Tool outputs in this session |
| P3 selected work | 141 / 1 | .build/p3-tests.log |
| P5 final | 145 / 9 | .build/p5-final-tests.log |
| P4 transport/receipt | 155 / 9 | .build/p4-final-tests.log |
| P4 relay pairing | 159 / 9 | .build/p4-pairing-check.log |
| Hosted HOUSE | 170 / 9 | .build/house-check.log |

Docker/Render files are staged, but no container build, deployment or hosted
cold-start measurement has run. Native runtime behavior is compile-tested with offline actor tests; native GUI/OS UAT remains.

License/source check also passes:
`cargo deny --locked --target x86_64-pc-windows-msvc check licenses sources`
(`.build/P1-licenses.log`). Advisory checking and Ubuntu CI were not run here.

Run `./scripts/check.ps1`. For arbitrary Cargo commands, use the named array
parameter so PowerShell preserves flags:
`./scripts/cargo.ps1 -CargoArgs @('check','-p','table-desktop')`.
Ordinary tests never use the network. Nine ignored tests comprise the eight P5
spikes and the older create-only sandbox spike. All require explicit environment
gates; the exact commands, environment names, expected evidence and recording paths
are in SPIKES.md. Only spike 6 (--version only) was explicitly run here and passed
after the Node path fix. Credentials remain operator-environment inputs for ignored
conformance checks, OS-keyring inputs for the production wallet.

## Unverified and deferred work

Wave 0 adds one: `RelayApi::wake` assumes a `/healthz` request shortens a hosted cold start.
Executable `// UNVERIFIED:` assumptions include codex-cli HTTP MCP environment
header/default-tools approval behavior in argv.rs; native NDJSON input/init ordering
in native.rs; accepted return destinations in the PayPal client; and buyer debit sign/
capture-id mapping in reconciliation.rs. Help confirmed
ignore-user-config/ignore-rules spelling, but live config exclusion is unverified. Official
[noninteractive documentation](https://developers.openai.com/codex/noninteractive)
establishes JSONL/turn events, not the isolation inventory guarantee.

Live spikes still owed: decoy user/project MCP config and tool inventories for both
engines; live-process isolation/cancellation and native window visibility (offline
fixture tree cancellation and installed version resolution pass); two-account seller AUTHORIZE approval/authorize/capture;
buyer/seller API ownership asymmetry and business buyers; owner-app/payee-route
capture/void; accepted custom-scheme/loopback return URLs; Channel3 demo coverage,
tracking/history; invoice delivery/payment; reporting permissions/lag; subscription
failure simulation, approval requirements and avoiding duplicate renewals.
The core order bindings/PayPal restrictions are documented and offline tested;
invoice_id reuse after expiry and live ownership/fee/refund/dispute behavior are
not verified. Secondary clients match primary specs and recording-transport tests;
their live conformance and durable rescue authority integration remain unverified.

Hosted HOUSE: these are UNVERIFIED and not in .research: Render's rate for one paid instance plus
a 1 GB disk, from the Nov 6-9 video through judging; its health-check interval and failure
threshold against the 190 s window; its restart rule; and its SIGTERM grace period. The 'about a
minute' wake time at `apps/desktop/client/src/windows/approval/OwnerConfig.tsx:27` and
`windows/main/setup/CircuitView.tsx:400-402` is unmeasured. Copy that says the HOUSE sleeps when
nobody uses it does not match render.yaml's fixed paid instance.

Exactly deferred by phase:

- **B4/P3 remaining:** live secondary conformance, reporting reconciliation/lag,
  subscription failure simulation; Channel3 URL/image lookup, durable tracking restore.
  Typed secondary clients and owner-gated comparable refresh are implemented.
- **B5/P2 remaining:** live pre-input inventory/config/header/approval conformance,
  version-pinned availability decision and real CLI captured fixtures. Native process
  infrastructure and strict refusal are implemented; native engines remain unavailable.
- **B6/P3 remaining:** shop_search/quote/checkout. Seven tools are advertised across
  roles: table_view, send_offer, accept_offer, withdraw_offer, market_reference,
  propose_purchase and book_query. Purchase supports one pre-existing,
  mandate-bound template line; catalog and multi-line checkout are deferred.
- **B7/P4 verification remaining:** owner release/environment provisioning, Linux container/mount and Render cold-start/deployment;
  live buyer reporting mapping/permissions/lag and native two-machine UAT;
  rescue detection/lever execution/paid-invoice accounting; shop/catalog/feed/CSV;
  repair of missing SETTLE/RECEIPT after confirmed financial writes; recovery for
  unknown operations/crash gaps and external signed export anchoring.
- **B8/P1 remaining:** native OS/IPC interactive verification, mixed-DPI placement
  and native chrome, user-interface rendering/reduced motion,
  notification delivery with a registered packaged app identity, packaging/license
  notices and non-Windows desktop runtime. P1 native implementations have not been
  exercised on the owner's desktop. Rescue activation waits for P3. Hosted HOUSE
  is implemented with release configuration; relay pairing/delivery and buyer receipt/
  reporting are attached and offline-tested. P2 provides actual job
  starts/cancellation/resume; no real model run is enabled here.

## Acceptance map

Partial rows name actual evidence and remaining work; they do not claim a full
UI or sandbox criterion. Test names refer to their owning crate's tests.

| ID | Evidence / remaining work |
| --- | --- |
| H1 | MCP h1_m3_out_of_band_is_error_and_zero_paypal_rows; needs UI. |
| H2 | Protocol h2_reused_nonce_rejected_without_consuming_new_nonce, h2_wrong_audience_expiry_seq_prev_and_signature_rejections, unknown_fields_at_every_closed_boundary_are_rejected; ledger rejection audit test. |
| H3 | App h3_two_accepts_one_order_and_h5_seller_receives_without_owner_click plus Runtime two_wallet_actors_negotiate_and_settle_through_in_process_relay_without_buyer_api_access; sandbox and UI remain. |
| H4 | PayPal h4_truth_binding_and_host_allowlist; app h4_changed_paypal_truth_enters_mismatch_and_cannot_capture and invalid_approval_link_records_evidence_and_cannot_be_opened_or_recreated; needs UI button gating. |
| H5 | Runtime two-wallet relay settlement has equal final heads, one capture, zero buyer API calls and SELLER_ATTESTED chips; own-account reporting matcher is offline-tested. Live timing/account mapping, sandbox and UI remain. |
| H6 | Runtime h6_fresh_wallet_pairs_house_and_closes_through_in_process_relay_with_mock_paypal plus waking/default/reopen invariants pass. Owner provisioning, Render cold-start timing, sandbox and UI remain unverified. |
| F1 | MCP f1_purchase_refusal_leaves_zero_paypal_rows; app purchase_proposal_persists_terms_and_has_zero_payment_calls; ledger insert trigger protects refused deals. |
| F2 | PayPal retries_reuse_request_id_and_oauth_is_not_evidence; app H3 pipeline, unknown_money_outcome_is_reserved_and_never_recreated, owner_tickets_bind_terms_deal_attempt_expiry_and_session_generation, wrong_attempt_cannot_poll_authorize_capture_or_void_an_existing_order; needs sandbox/UI. |
| F3 | App f3_w6_deadline_voids_once_and_lapse_never_calls_paypal; native scheduler attached; sandbox and UI pending. |
| F4 | App f4_w3_w11_approval_label_token_idle_lock_and_os_reauth; native HWND-scoped Hello attached with fake-OS invariant tests; native UAT/UI pending. |
| F5 | Bound payee and authority evidence exist; payee-route export metadata and UI pending. |
| M1 | Single-template purchase checked offline; local/paired multi-line shop checkout, sandbox and UI pending. |
| M2 | Catalog/feed/CSV deferred. |
| M3 | MCP h1_m3_out_of_band_is_error_and_zero_paypal_rows; house floor test. |
| C1 | Closed BookQuery compiler binds values; memory/file read-only mutation/injection tests pass. Needs UI INVALID rendering. |
| C2 | Reporting bounds, pagination and own_account_reporting_requires_success_exact_capture_amount_currency_direction_and_complete_pages pass; live account mapping/lag and UI pending. |
| S1 | Shield s1_payee_blocks_without_engine_and_no_reference_never_passes; core market quartile/band tests; needs UI. |
| S2 | Shield s2_model_can_never_lower_caution; app s2_held_authorization_voids_immediately_and_never_captures and shield_ask_and_revoked_mandates_stop_each_money_grant_before_network; needs sandbox. |
| S3 | Engine s3_inventory_missing_or_decoy_tools_fails_closed and forbidden_events_after_safe_init_poison_terminal_verdict; live isolation spike pending. |
| R1 | Core r1_retry_refuses_replay_near_retry_and_excess_balance and discount_property_style_never_increases_amount; rescue services/levers/sandbox pending. |
| R2 | recovered_sum query excludes REPLAY/scripted rows and requires verified sandbox capture receipts; service/paid-invoice accounting and sandbox deferred. |
| R3 | Ledger r3_paypal_path_cannot_name_plan_wide_repricing_or_queries; secondary client has no plan-pricing method; durable rescue integration pending. |
| E1 | Parser tests plus native fixture stdin/watchdog/tree/drop cleanup and actor pause/restart tests pass. Live isolation/engine availability remain gated. |
| E2 | Engine scripted_runs_are_labelled_and_schema_checked_and_cancelled; app replay_mode_never_grants_payment_authority_or_runs_deadlines; core deal_projection_roundtrips_market_shield_and_mode; needs UI. |
| E3 | Engine exact_argv_and_e3_no_stream_json_schema_conflict. |
| U1 | Attention w4_tumbler_schema_has_no_untrusted_text_and_w11_lock_preserves_items asserts on_silence; needs UI rendering. |
| U2 | Mode is generated on deals/items/receipt contract; accounting/export and UI badges/meters pending. |
| U3 | Protocol human_note_is_bounded_and_never_in_agent_projection; ledger w4_received_injection_note_stays_out_of_attention_at_every_form; needs UI plain-text quarantine. |
| U4 | Needs UI at 1280x800/font inspection. |
| W1 | Native close-to-tray/runtime route retention implemented; needs interactive close/reopen and client route restoration test. |
| W2 | Pure ladder emits show_without_activation; native background projection does not show/focus; native no-activation/ladder wired; GetForegroundWindow interactive test pending. |
| W3 | Desktop w3_release_set_is_approval_only_and_all_commands_are_declared; app runtime label/token/lock test; native IPC integration test still owed. |
| W4 | Ledger w4_received_injection_note_stays_out_of_attention_at_every_form; generated AttentionSnapshot contains no merchant free text; needs UI. |
| W5 | Attention ladder_boundaries_and_w5_one_notification_dnd; native DND/notification adapter and durable rung claim wired; delivery/click UAT pending. |
| W6 | App f3_w6_deadline_voids_once_and_lapse_never_calls_paypal; exactly one confirmed void/idempotent tick; native receipt producer attached; UI pending (audit count deviation above). |
| W7 | MCP safe_withdraw_is_signed_and_never_calls_paypal; native signed-withdraw actor handler attached; UI confirmation pending. |
| W8 | Attention w8_placement_property_style_at_100_125_150_percent, w8_snap_scales_and_ignores_hidden_or_minimized_main, puck_anchor_survives_flips_and_resize, invalid_geometry_never_panics_and_small_work_area_clamps; native form placement/scale callback implemented; interactive mixed-DPI/drag/snaps pending. |
| W9 | Single-instance callback summons existing Tumbler in Stack; native second-process test pending. |
| W10 | Attention w10_motion_preference_and_dnd_suppress_breathing; UI media query/animation pending. |
| W11 | Attention lock preserves items; app idle test; shell summary reports lock and native unlock uses Hello; OS UAT pending. |

## Client handoff

Generated Rust-owned TypeScript is in **bindings/**. Use CommandContract/EventContract,
CommandError, IpcHeaders, Deal and AttentionSnapshot; the type map is not a payload.
ULIDs are strings, hashes are 32-number tuples, money is integer minor units + ISO,
timestamps are Unix seconds and unit results are null. Regenerate with
`./scripts/cargo.ps1 -CargoArgs @('run','-p','table-client','--bin','generate-bindings')`.
The checked-in files are regenerated and drift-tested; do not edit them by hand.

Non-null Args use `invoke(name, {args: payload})`; null Args have no payload. The
approval window gets `approval_token`, keeps it only in memory and sends it in
invoke options `{headers: {'X-Wallet-Ipc': token}}`. Main/Tumbler cannot obtain it.
The token is neither an API credential nor a signing key. Error codes include
LOCKED, PERMISSION, INVALID, NOT_FOUND, UNAVAILABLE, UNSUPPORTED and LEDGER_TRUST.

**First run:** open `approval_open({deal_id:null})` for owner configuration, obtain
its token and call unlock. Call `set_credentials` with **only** `"paypal_sandbox"`
or `"channel3"`; a Rust-owned Windows dialog accepts the values. Never build React
credential fields, persist a token, or put secret text in an IPC body. Sign mandates
there with `mandate_sign`; id=null allocates an id, and the version increments in Rust.
Read active versions from mandate_list. AgentSlot selects an OS-keyring agent key,
which is never returned as a private key. `first_run` is true until a mandate exists.

| Command | Gate / labels | Args -> result | Actual availability at this boundary |
| --- | --- | --- | --- |
| get_settings | read: all | null -> SettingsSnapshot | Real stored-credential, lock, first-run, engine, pause, relay attachment, typed house state and preference flags. relay_available means configured transport, not a successful live probe. Meters remain unavailable. |
| list_deals | read: main | null -> Deal[] | Real ledger, including stored created_at/updated_at. |
| get_deal | read: main | DealArgs -> Deal | Real ledger. |
| deal_evidence | read: main | DealArgs -> DealEvidence | Durable NONE / SELLER_ATTESTED / PAYPAL_VERIFIED and reconciliation chips; no merchant text. |
| deal_reconcile | read: main | ReconcileArgs -> DealEvidence | Real own-account reporting GET for a sandbox RECEIPTED deal, bounded window/pages. Requires configured credentials. Missing rows stay pending; live buyer capture-id/debit mapping is unverified. |
| engine_status | read: main | null -> EngineInfo[] | Actor registry: scripted available; installed native versions probed but unavailable pending isolation conformance. |
| engine_select | config: main | EngineSelectArgs -> null | Scripted selection persists; native selection returns UNAVAILABLE. |
| agent_start | main | AgentStartArgs -> RunSnapshot | Mandate-bound run; scripted checked read available, native conformance gated. Four runs maximum, one per deal. |
| agent_runs | read: main | null -> RunSnapshot[] | Active runs and up to 64 completed summaries; no raw model text. |
| resume_all_agents | main | null -> null | Clears sticky pause; requires an explicit later start. |
| market_refresh | approval + token + unlocked + selected | MarketRefreshArgs -> MarketRef | Real Channel3 client using keyring key; rechecks terms/mandate/currency after IO. Live fetch unverified. |
| attention_list | read: all | null -> AttentionSnapshot | Real sorted gate/hold projection; approval sees selected deal only. Above-threshold buyer counters become GATE; stable labels and optional wallet_spend_today_currency included. |
| main_open | route: main/tumbler | MainRoute -> null | Shows Main and restores/emits route. |
| approval_open | route: main/tumbler | ApprovalOpenArgs -> null | Select deal/configuration, or Main-only pairing selection via optional pairing id. Deal and pairing cannot both be selected. |
| approval_summary | read: approval | DealArgs -> ApprovalSummary | Bound selected deal; real evidence, lock, can_release, can_owner_accept, counter_hash and separate can_open_paypal. Buyer browser approval can be available without local merchant credentials. |
| approval_selection | read: approval | null -> DealId or null | Current actor-selected deal; null for pairing/configuration review. |
| approval_pairing | read: approval | null -> PendingPairing or null | Selected, still-pending words/house/fixed context; no peer bundle, payee or URL. |
| deal_display | read: all; selected if approval | DealArgs -> DealDisplay | Persistent label, locally bound signed item_ref title, deadline/default and verified signed band. |
| deal_transcript | read: main/approval; selected if approval | DealArgs -> TranscriptStep[] | Verified full-chain price/status projection; no raw JWS, NOTE, peer prose or URLs. |
| counterparty_list | read: main/approval | null -> CounterpartyDisplay[] | Owner-confirmed local labels, house flag, first_seen and derived closed-deal counts. |
| approval_token | capability: approval | null -> string | Real in-memory capability, available while locked. |
| unlock | approval + token | UnlockArgs {} -> null | Real native Hello; cancellation/failure never unlocks. Unsupported elsewhere. |
| set_credentials | approval + token + unlocked | CredentialArgs -> null | Native credential entry and keyring write; no secret IPC fields/results. |
| mandate_list | read: main/approval | null -> MandateListEntry[] | Verified active owner-signed payload/signature plus local agent slot. |
| mandate_sign | approval + token + unlocked | MandateSignArgs -> OpenMandate | Real owner signature and monotonic version insert. |
| mandate_revoke | approval + token + unlocked | MandateRevokeArgs -> null | Durable revoke; subsequent authority checks fail closed. |
| band_set | approval + token + unlocked + selected | BandArgs -> OpenMandate | Signs/rebinds a new version before settlement only. |
| pairing_create | main | PairingCreateArgs -> PairingOffer | Real random code + signed public bundle; publishes it through the configured relay before returning. Without a relay, returns a bundle for offline/manual exchange; code-only discovery is unavailable. |
| pairing_join | main | PairingJoinArgs -> PairingWords | Omit peer or pass null for code-only relay discovery; verifies signatures/code/side/expiry/commitment and publishes the signed reply before returning words. Explicit peer supports offline/manual exchange. HOUSE accepts buyer + omitted peer with compiled public pin and relay; returns house_table for checked deal_join and shows waking while pending. |
| pairing_poll | main | PairingPollArgs -> PairingWords or null | Creator-only signed reply discovery for its still-pending code; null while waiting. Re-publishes the same offer after relay loss. Missing relay -> UNAVAILABLE; unknown/expired/consumed code -> INVALID; conflicting signed replies -> PERMISSION. |
| pairing_confirm | approval + token + unlocked | PairingConfirmArgs -> KeyId | Confirms all words and pins signed peer identity/payee plus the mailbox seed; HOUSE is marked House and its verified table retained. |
| deal_create | approval + token + unlocked | DealCreateArgs -> Deal | Mandate-checked sandbox deal/category/deadline creation; no payment call. Paired sellers queue a signed LISTING in the durable outbox. |
| deal_join | approval + token + unlocked | DealJoinArgs -> Deal | Real buyer haggle creation using the seller's deal ULID and initial terms, with the buyer's own signed mandate. Both sides must already be paired. HOUSE additionally checks its retained signed table/terms/category/deadline. |
| settings_write | main/tumbler | TumblerPreferences -> null | Persists pin, puck position, form, snap, quiet, DND and notifications. |
| tumbler_set_form | tumbler | FormArgs -> null | Rust work-area/scale placement + persisted form/anchor. |
| tumbler_pin | tumbler | PinArgs -> null | Native always-on-top + persistence. |
| tumbler_drag | tumbler | null -> null | Native drag from puck; Rust classifies drop after mouse release. |
| tumbler_snap | tumbler | null -> Snap | Native-coordinate snap classification and persistence. |
| deal_withdraw | all; selected if approval | DealArgs -> null | Real signed WITHDRAW toward the default; no unlock and no PayPal call. State/key/mandate bindings still apply. |
| deal_let_lapse | main/tumbler | DealArgs -> null | Dismisses to an existing Rust deadline; never consents or pretends to void early. |
| deal_snooze | tumbler | DealArgs -> null | GATE deadline strictly >45 minutes away; 30-minute persistent view suppression. HOLD/last notification pierce snooze; defaults stay independent. |
| deal_owner_accept | approval + token + unlocked + selected | DecisionArgs -> Deal | Buyer sandbox haggle only. Exact latest inbound COUNTER digest + terms, owner signature and owner audit; every mandate/shield/deadline/round check remains. No PayPal call. |
| deal_countersign | approval + token + unlocked + selected | DecisionArgs -> Deal | Real bound create from AGREED or authorize from APPROVED on owned seller/purchase resources. Requires credentials and rechecked mandate/shield. |
| deal_capture | approval + token + unlocked + selected | DecisionArgs -> Deal | Real bound capture of AUTHORIZED before deadline, with durable countersign/authority. |
| deal_void | approval + token + unlocked + selected | DecisionArgs -> Deal | Real owner-authorized void of AUTHORIZED; unknown outcome remains reserved. |
| shield_release | approval + token + unlocked + selected | DecisionArgs -> Deal | HOLD -> ASK only; BLOCK cannot be released. |
| rescue_approve | approval + token + unlocked + selected | DecisionArgs -> Deal | **UNAVAILABLE**: depends on the P3 rescue executor; no fake mutation. |
| open_paypal_in_browser | approval + token + unlocked + selected | DecisionArgs -> null | Verified stored SETTLE + mandate, then Rust system opener; no client URL. |
| pause_all_agents | main/tumbler | null -> null | Persists pause, cancels all jobs/revokes grants and stops automatic policy create. Polls/defaults continue. |
| quit_summary | main/tumbler | null -> QuitSummary | Real pending set (including dismissed gates), current confirmation hash and stop explanation. |
| quit_confirm | main/tumbler | QuitArgs -> null | Rejects changed pending deals, hides windows and exits. Tray uses a native confirm dialog. |
| counterparty_note | read: main | DealArgs -> CounterpartyNote or null | Wave 0. Latest inbound signed NOTE, chain re-verified, ≤ 280 chars, never parsed. Render only in quarantine. |
| pairing_abort | main/approval (no token, no unlock) | PairingAbortArgs -> null | Wave 0. Exactly one of pairing_id / code; approval only its own pairing by id. Idempotent; pins nothing. |
| house_wake | main | null -> HouseState | Wave 0. Idle → waking → ready via GET /healthz on the relay origin; failure returns to idle. No pairing, no money. |
| approval_handoff | read: approval | null -> ApprovalHandoff | Wave 0. Target (null = owner configuration), selected deal and Main's draft (pre-fill only). `approval_open` now also takes optional `target` and `draft`; drafts only from main, checked for binding. |
| audit_page | read: main | AuditPageArgs -> AuditPage | Wave 0. Newest first, before-exclusive paging, limit 1-200, chain verified first; closed facts only. |
| owner_facts | read: main/approval | null -> OwnerFacts | Wave 0. Lock countdown, last Transaction Search call, engine probe time/detail, credential stored dates, agent roster. No secrets. |
| book_query | read: main | BookQueryArgs -> BookAnswer | Wave 0. Closed BookQuery from raw JSON; rejection = INVALID "BookQuery rejected: <reason>" verbatim; read-only connection. |

For two desktops, set TABLE_RELAY_URL to the deployed rendezvous HTTPS origin before
launch. One owner calls Main's pairing_create and shares only its code. The other
calls pairing_join with `{code,side,payee}` (peer omitted/null). The creator polls
pairing_poll with `{code}` until it returns words rather than null. Both owners compare
all four words and confirm them in their own approval windows. A creator code is
consumed on confirmation; transient unconfirmed state does not survive process restart.
The seller uses deal_create; the buyer uses deal_join with
`{deal_id: sellerDeal.id, create: buyerLocalDealArgs}` and identical initial terms.
Each wallet derives the same mailbox. Signed negotiation, SETTLE and receipt delivery
then runs in the actor and survives wallet delivery-state reopening or relay mailbox loss.
Ordinary automatic policy settlement still requires fresh market evidence and signed
mandate/shield checks. HOUSE uses its explicit pinned authority for ASK, without market
fabrication; HOLD/BLOCK still stop it. See [DEPLOY.md](DEPLOY.md). Deployment and
native two-desktop connectivity/word-display UAT remain unverified.

For HOUSE, the wallet and hosted binary must be built with the same public release
pin. A debug build without one shows house=unavailable. Call pairing_join with
`{code:"HOUSE", side:"buyer", payee: buyerPayee}` and omitted/null peer. Render
get_settings().house/settings:changed as idle/waking/ready/unavailable; show **House
waking** while the request is pending. A timeout is a retryable failure, not a pairing.
Confirm the returned words in approval, then use PairingWords.house_table's deal_id,
category and initial terms in deal_join with the buyer's own mandate. house_table is
null for ordinary pairing. Rust verifies and retains the HOUSE table and deadline;
never supply a different local ULID or terms. Negotiation and browser approval use
the same existing commands and gates. This session added no client UI.

DecisionArgs is `{deal_id,attempt,terms_hash,counter_hash?}` from ApprovalSummary.
For owner ACCEPT copy counter_hash too; require can_owner_accept===true. This is
separate from seller/purchase payment release and does not require buyer credentials. A configured
executor does not override state, deadline, pairing, mandate or shield rejection.
Buyer haggle resources belong to the seller's credentials: do not offer buyer-side
capture/authorize buttons; P4 supplies signed receipt acceptance instead. Disable
capture/authorize/void controls while locked or can_release=false. Gate browser approval
separately on can_open_paypal; buyer credentials are unnecessary for that browser action.
Handle typed failures as failures.
No SQL, arbitrary URL, client-supplied owner decision, secret read or agent payment
tool is registered. Book is an Assistant MCP tool; catalog and durable rescue remain P3 work.

Events are targeted; subscribe then fetch initial snapshots. They are projections,
not retained UI state. Native event-ring lag triggers a full ledger/settings/attention
refresh. New real producers and targets:

| Event | Targets | Payload / producer |
| --- | --- | --- |
| agent:changed | main | RunSnapshot after start/init/end/cancellation; no model text. |
| attention:changed | main, tumbler | AttentionSnapshot from actor changes/native idle tick. |
| deal:changed | main | DealChanged from actual ledger mutations. |
| receipt:created | main, tumbler | ReceiptEvent with typed evidence from state changes, including buyer SELLER_ATTESTED acceptance and deadline defaults. |
| settings:changed | main, tumbler, approval | SettingsSnapshot after config/lock/pause changes. |
| wallet:error | main | CommandError for scheduler failures/unknown operation conflicts. |
| approval:summary | approval | Selected immutable summary refreshed from actor. |
| main:route | main | MainRoute from explicit route command. |
| tumbler:handoff | tumbler | TumblerHandoff {deal_id,approve_until} after a successful system browser handoff, using the recorded deadline. |
| tumbler:form | tumbler | Native Rust form changes. |
| tumbler:orient | tumbler | OrientationEvent from native placement/scale callbacks. |
| tumbler:status | main | Visibility/form/count mirror. |
| tumbler:selected | tumbler | DealArgs from a notification click; focus that card. |
| tumbler:visual | tumbler | VisualState with quiet opacity and breathing hint; client must additionally respect reduced motion. |
| pairing:pinned | main | PairingPinned {pairing_id,key_id,house} after a successful pairing_confirm (wave 0). |

The completed React window folders remain unchanged by this backend session. Next client work can wire
configuration, reads, routing, forms, safe actions and supported payment actions.
It must render OS setup/cancel/unsupported states and explicit dependencies honestly.
Secrets, signatures, defaults, policy and browser-link verification stay in Rust.

## Exact resume point

**All seven backend requests are done at a green boundary.** The client session can
now wire owner ACCEPT using can_owner_accept and all DecisionArgs bindings; route
pairing id through approval_open then read approval_pairing; subscribe to
tumbler:handoff; call Rust deal_snooze; consume timestamps/currency and mandate.agent.
Use pending.ts as the generated projection import point. No window-folder changes
or outstanding window type errors remain in this session.

Perform native UAT for these new commands/events alongside the existing checklist.
No real model runs, live PayPal calls, deployment, GUI launch, real keyring writes
or git state changes were performed. Shipping HOUSE still needs the owner-provisioned
compile pin and matching runtime environment from [DEPLOY.md](DEPLOY.md).
Existing P1/P2/P5, relay/delivery and hosted HOUSE work must not be redone.

Next backend items, only when the owner resumes backend work:

1. P3 rescue: durable failure detection from polled events or labelled REPLAY fixtures,
   owner-bound lever reservations/execution, renewal exclusion and confirmed recovery
   accounting excluding REPLAY-only rows (R1-R3). SecondaryApi/Book already exist.
   Activate rescue_approve only after that path is implemented and tested.
2. P3 catalog: mandate-bound shop floors, shop_search/quote/checkout (M1/M3), item/
   breakdown/total equality and capture only after verified approval. Seven tools remain
   advertised; the three catalog tools are absent.
3. Financial crash gaps: reconstruct missing SETTLE/RECEIPT from confirmed recorded
   truth and durable operation identity, never another create/capture. Unknown outcomes
   require reconciliation and stay reserved. Committed-envelope delivery recovery already
   works for wallets and the house.

P5 commands remain unchanged and were not run by this session. Spikes 1/2 still must
prove native pre-input isolation before version-specific availability can be enabled.
Future backend work should rerun fmt/clippy/workspace tests and regenerate bindings
when contracts change. HOUSE live UAT/provisioning is an operator/client release step,
not another automatic plumbing task in this session.

**Client:** consume the regenerated contracts and the availability table above.
**Native UAT:** still owed for Hello success/cancel/unconfigured/idle re-lock, native
credential cancellation/storage (never a webview), real IPC label/token/selected-deal
checks, foreground preservation on arrival, mixed-DPI drag/snap/restart, notification
identity/delivery/click/DND, confirmed Quit and single-instance behavior. No native
app-data or OS keyring writes were made by this session: the application was not
launched and tests injected memory vaults/OS/HTTP boundaries.

## T2 deterministic negotiator (2026-10-07)

First slice of moonshot theme T2 (card runtime-core-1): a policy negotiator that bargains
through the wallet's own loopback MCP, so the haggle needs no native engine. Reconcile found
no existing policy negotiator on `main`. Rust only; `bindings/` and `apps/desktop/client` are
unchanged (no generated type changed; `TranscriptBy`/`TranscriptType` only gained
`PartialEq, Eq`).

**Built**
- `table_core::negotiation` (pure): the house `Policy`/`Decision` moved here unchanged
  (`house-seller` re-exports them) plus `BuyerPolicy`. The buyer opens at the bottom of its
  signed band (floor, else fresh market p25, else 60% of the ceiling), concedes linearly over
  `max_rounds` toward the lower of the signed ceiling and a fresh market median, and never
  offers or accepts above the ceiling. Integer minor units only.
- `table_engine::PolicyEngine` (`EngineAdapter`, `EngineId::Scripted`, `Mode::ScriptedEngine`):
  `tools/list`, then `table_view`, then one of `send_offer` / `accept_offer` /
  `withdraw_offer` through the run's MCP grant URL and token. It decides from the typed
  `PolicyBrief` the runtime builds from the signed band and transcript shape, and from the
  `table_view` deal projection; it never reads counterparty text. Its transport is a trait:
  the desktop uses `reqwest` (already a workspace dependency) against the loopback listener,
  tests drive the real MCP router in process.
- `start_agent` gives the scripted slot a real MCP grant (the empty-grant branch is gone) and
  keeps the 120 s expiry, the four-run cap and one run per deal. The variant follows the side
  the deal's mandate pins (seller deal -> seller policy, buyer deal -> buyer mirror).
- `Runtime::tick` re-arms: a negotiating deal whose latest message is the peer's OFFER,
  COUNTER or ACCEPT, with no active run, agents not paused and the scripted engine selected,
  gets one policy run per peer message (keyed on the transcript head, so a refused answer is
  not retried in a loop). An agent ACCEPT on a clause-6 ASK is still refused and the owner's
  accept is unchanged.

**Tests added**
- `table-core`: seller concession path, buyer open/concede/ceiling, fresh-median target, anchors.
- `table-engine`: decisions per side and stance stay in the band; stale median ignored.
- `table-runtime::policy_tests`: re-arming never exceeds four runs and one run per deal;
  nothing starts while paused or under another engine; one run per peer message; falsifier -
  a buyer policy configured above the signed ceiling is refused by the mandate check, the run
  still ends clean, `intent.refused` is audited and `paypal_calls` stays empty.
- `relay_tests`: `two_wallet_actors_negotiate_and_settle_...` and `h6_fresh_wallet_pairs_house_...`
  now run from policy runs with 0 hand-injected `send_offer`/`accept_offer`; assertions kept
  (one capture, zero buyer API calls, equal heads). No hand-injected variant was kept: nothing
  else it covered is uncovered.

**Deviations / notes**
- Arming covers the peer's OFFER and ACCEPT as well as COUNTER: a seller's first trigger is the
  buyer's OFFER and a deal only agrees once the ACCEPT is answered. The buyer's opening is
  still the owner's `Start`, never automatic.
- A wallet seller refuses inbound offers below its own floor, so only HOUSE (which declines
  them as evidence and counters) shows a real counter. The two-wallet test therefore closes in
  one round: the buyer opens at its band floor (the listing price), the seller accepts, the
  buyer's agent countersigns under clause 6. The owner-accept-above-threshold path is
  exercised by the H6 test (HOUSE counters 22.50, the buyer's agent is refused, the owner
  accepts) instead of the two-wallet test; relay replay count there is 6 not 7 (no injected
  counter).
- The buyer's policy `max_rounds` is the band's minus one, leaving a round for the reply its
  own offer invites. `Action::Start` on a deal with nothing waiting runs `table_view` only.
- Engine label still reads "scripted" in `EngineInfo.reason` text only as the policy
  negotiator; `EngineId`/`Mode` unchanged so the IPC contract is unchanged.
- `reqwest` is now a direct dependency of `table-runtime` (already in `Cargo.lock`).
- `cargo clippy/test --workspace` was run with `--exclude table-desktop`: that crate cannot
  build in a worktree without `apps/desktop/client/dist` (tauri `generate_context!`), unrelated
  to this change. A shared `CARGO_TARGET_DIR` with another checkout produced stale-artifact
  errors; a private target dir was used for the final run.

**Left**
- Client: the POLICY ENGINE badge (render `mode: scripted_engine` runs as the policy
  negotiator on run cards) is a separate client slice; no client file was touched.
- Real counters from a wallet seller (needs a below-floor "declined as evidence" path like
  HOUSE's), `withdraw` on exhausted rounds is untested end to end, and the HOUSE video
  rehearsal.

## Gate without exclusions (2026-10-07)

- **What failed.** The merge gate could not compile `table-desktop` (`tauri::generate_context!` panics when the
  gitignored `apps/desktop/client/dist` is absent) and skipped `native_stdin_stderr_terminal_and_temp_cleanup`, which
  failed on `main` (`native.rs:134`, `engine.run(...)` returning `Timeout`).
- **Cause.** (A) No placeholder bundle in a tree that never ran the client build. (B) A test-fixture budget, not a
  defect in `crates/table-engine/src`: `fixture()` set `RunLimits.init` to 500 ms. With the seven native tests spawning
  the fixture in parallel on Windows, first output sometimes took longer; measured before the fix: 2 or 3 of 7 tests
  failed with `Timeout` in 3 of 4 runs (`stdin_stderr` and also `toolless` and `cancellation`). The 5 s total and the
  2 s cleanup wait were not the limit. No stale-fixture-binary problem was involved.
- **Fix.** `apps/desktop/src-tauri/build.rs` (Windows branch) creates `client/dist/index.html` as a placeholder and emits
  one `cargo:warning` when it is missing and the profile is not `release`; a release build without the real bundle
  fails with a message naming the client build. Nothing under `client/dist` is committed (it stays gitignored); CI,
  which builds the client first, takes the early return. `tests/native.rs` `fixture()` now uses
  `init = min(total, 4000 ms)` (`NativeEngine::new` requires `init <= total`); every assertion is unchanged.
- **Result.** `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings` and
  `cargo test --workspace` pass with no `--exclude` and no `--skip`; `cargo test -p table-engine --test native` passed
  6 runs in a row. The merge gate can drop `--exclude table-desktop` and `--skip native_stdin_stderr_terminal_and_temp_cleanup`.

## Security fixes

- **C-1 (High, scan 2026-10-07) fixed** in `services/rendezvous/src/lib.rs`. The store holds `Inner { boxes,
  total_bytes }`; `send` returns `Error::Full` (429) past `MAX_MAILBOX_BYTES` (256 KiB) or `MAX_TOTAL_BYTES`
  (64 MiB); expired or removed boxes release their bytes; the expiry sweep runs in `send` as well as `create`.
  `MemoryStore::new(clock)` and `router` are unchanged. Note: 256 boxes x 256 KiB equals the 64 MiB total, so the
  global cap is a backstop that cannot bind before the per-box and box-count caps today; it guards future changes
  to either.
- **C-7 (Medium) fixed, with one part left out.** Messages are stored as `Arc<str>` and a read clones pointers
  under the lock, copying to `String` after it is released; `read` and `sync` return at most 32 messages. A capped
  read cannot lose or duplicate a message: the wallet stages `after + messages.len()` and the ledger rejects a batch
  unless its `after` equals the stored cursor (`table-ledger/src/relay.rs:180`), so the remainder arrives on the next
  poll. Left out: moving the dedupe scan after the capacity checks. A byte-identical retry to a full mailbox must
  still be acknowledged with its sequence number (otherwise a wallet whose send landed but whose reply was lost
  would see 429 forever), so the scan stays first; it is a length-prefixed compare over at most 256 messages.
- Tests: `services/rendezvous/tests/relay.rs` (boundary, global, expiry release, paging, resend dedupe).
- **C-2 (Medium) fixed.** `Client::execute` projects the binding from the raw body before redaction (`Observation.binding` -> `PaypalCall.binding`); `record_paypal_call` and `finish_operation` store it instead of re-projecting the redacted body, so `paypal_calls.binding_json` now holds `custom_id`, `invoice_id`, `payee_merchant_id` and amount on the live path. `table-verify` requires all four on every order record with purchase units and its result text names what it compared. Tests: `create_observation_binds_custom_id_invoice_payee_and_amount_without_the_email` (`table-paypal/tests/client.rs`), `the_ledger_stores_the_carried_binding_and_never_re_projects_the_redacted_response` and `paypal_bindings_keep_identifiers_and_amount_but_never_payer_text_or_links` (`table-ledger`), and the custom_id, payee and missing-field tamper cases in `two_wallet_actors_negotiate_and_settle_through_in_process_relay_without_buyer_api_access` (`table-runtime/src/relay_tests.rs`). Bindings recorded before this fix lack custom_id and payee and now fail verification.
- **C-5 (Medium) fixed.** The HOUSE seller no longer polls an `AwaitingApproval` deal every second. `Seller` keeps an in-memory per-deal `PollSchedule` (`services/house-seller/src/hosted.rs`): first poll at once, then 5 s doubling to a 60 s cap, restarted when the deal's state changes and dropped when the deal leaves `AwaitingApproval` or reaches its deadline. Deadlines and the `Agreed`, `Approved` and `Authorized` steps still run on every tick. A deal that is never approved gets 363 polls over the 6 h window instead of about 21,600. No ledger change and no migration. Tests: `six_hour_window_polls_a_few_hundred_times_not_21600`, `backoff_doubles_to_the_cap`, `state_change_resets_the_interval`, `deals_are_scheduled_independently_and_forgotten`. The scan's optional skip of identical polls in `record_paypal_call` was not done.
- **C-8 (Low) fixed.** A stalled or dead HOUSE actor is now visible. `HouseHandle::table` and `snapshot` answer 429 only when the channel is full, `Unavailable` (503) when it is closed, and `Unavailable` when the actor does not reply within 20 s. The actor writes an `AtomicI64` heartbeat on every timer tick, and HOUSE serves its own `/healthz`, which answers 503 when the heartbeat is more than 30 s old and 200 otherwise. `rendezvous` gained `relay_router` (mailbox routes without `/healthz`); `rendezvous::router` is that plus the always-200 `/healthz`, so the standalone rendezvous binary is unchanged. Tests: `closed_channel_is_unavailable`, `full_channel_is_full`, `reply_that_never_comes_is_unavailable_after_the_timeout`, `healthz_follows_the_heartbeat`; `services/rendezvous/tests/relay.rs` still passes.
- **house-seller-demo council-lite r1 rework (2026-10-07; 0373f21 line 1, d7ec3d1 line 3, 5915462 line 2).** Three fixes.
  (1) A full HOUSE (429) and a refusing HOUSE (any other 4xx, with a fixed refusal body naming daily_limit or other, and no free text) are told apart from a HOUSE that did not answer: `table_relay::Error::{Full, Refused}` and `answer_error`. The wallet words each case under REFUSED ('The house is full right now', 'The house has hit its limit for today', 'The house turned this table down', each with 'No money moved') and leaves the house Ready. Only no answer is UNAVAILABLE ('The house is waking or could not be reached') and goes back to Idle. A failed join no longer marks the house 'not part of this version'. PairingDesk shows 'Try again; nothing is lost' only for UNAVAILABLE and drops the unmeasured 'about a minute'.
  (2) DECISIONS 12 is built: the tick writes the heartbeat before and after every awaited deal step. `HEARTBEAT_STALE` is 190 s: 3 attempts x (OAuth 30 s + call 30 s) + backoff 3 s = 183 s, plus 7 s. A stalled actor still reads 503. At startup the HOUSE logs each money operation that a previous run left pending (deal, operation, attempt, outcome unknown). The pipeline's primary key prevents a second request id. Resolving the operation is T10. SIGTERM or ctrl-c stops serving gracefully, then the actor finishes the tick in flight and exits.
  (3) Every failed tick step logs `house step=<step> deal=<id> error=<code>` to stderr. A failure that repeats is folded into one line until it changes. tokio's `signal` feature is enabled for house-seller (no new crate).
  Tests: `answers_split_into_full_refused_and_unavailable`, `house_full_daily_limit_refusal_and_silence_reach_the_wallet_in_plain_words`, `house_health_stays_up_through_a_slow_tick_of_several_deals`, `house_restart_mid_capture_reserves_no_second_request_id_and_reports_it`, `house_drain_finishes_the_tick_in_flight_then_stops`, `house_failed_step_writes_one_redacted_log_line` and `healthz_follows_the_heartbeat`. PairingDesk.tsx was not typechecked (a worktree has no client node_modules).
- **house-seller-demo full council r1 (2026-10-07, at 4b55400).** Outcome ready: overall 0.547 on coverage 0.70. The judges are uncalibrated, so the floors are advisory. Ready is not an approval: the operator decides.
  Scores: value 0.50, craft 0.56, robustness 0.62. Rivalry and economics were not measured: no lookups, no price book, no telemetry, and the HOUSE is not deployed.
  The lite lines:
  - Line 3 (redacted log) is closed.
  - Line 1 is mostly closed. Only the daily-limit refusal is driven through to the wallet. Full, limit and turned-down share the REFUSED chip, whose meaning in words.ts:35 is written for the owner's own rules.
  - Line 2 is closed for liveness and SIGTERM, not for restart.

  Open, high:
  - A restart with a pending money step leaves the deal stuck (T10).
  - The HOUSE returns its signed mandate with its floor (scan C-14), so a floor-bidding agent closes in one round.
  - 64 deals that are agreed but not approved hold every HOUSE slot for 6 h (`house_open_request_count`). A short approval deadline for HOUSE deals is the cheapest fix.

  Open, medium:
  - The const assert on `HEARTBEAT_STALE` (hosted.rs:110) compares the constant with itself.
  - One tick has no overall bound, so a drain can outlast the host's grace period.
  - A step that keeps failing logs once and then goes quiet while /healthz stays 200.
  - The slow-PayPal test proves the heartbeat is written between steps, not that real calls finish within 190 s.

## Policy authority above clause 6 (2026-10-07)

- `crates/table-app/tests/pipeline.rs::policy_authority_is_refused_above_clause_6_before_any_paypal_call`: with a signed mandate whose clause 6 threshold (10.00) is below the deal (12.00), `Authority::Policy` is refused at create, authorize and capture with zero new mock PayPal calls and `paypal_calls` rows, and no countersign row at create; the same deal then reaches `Receipted` with `Authority::Owner(OwnerTicket)`, countersign present before capture. For authorize and capture the countersign row already exists from the owner's create, so those steps assert it is unchanged. No defect found; the gate held.

## Spend firewall / agent-gated-spend: a cleared purchase waits for the owner (2026-10-07)

- An agent's purchase that passes the mandate check waits at Agreed. Creating the PayPal order, authorizing it and capturing it each need the owner's decision in the approval window; the clause-6 policy countersign does not apply to purchases (`Authority::Policy` is refused for every purchase deal, before any countersign row, reservation or network call). A cleared purchase counts in the daily budget from the moment it clears until it is withdrawn or expires. This closes agent-gated-spend MA-1.
- Mechanism: `DealEvent::PurchaseCleared` (Pairing to Agreed), applied by `propose_purchase` (buyer purchases only) in its own transaction with the `deal.transition` audit row; the scheduler no longer creates orders for purchases. The text of the Shopper slot in `configuration.rs` now says money moves only when the owner decides.
- A purchase under a mandate with no Band gets a 24 h decision window (`PURCHASE_DECISION_WINDOW_SECS`, DECISIONS section 8): at the deadline it lapses to WITHDRAWN with `SafeDefault` and no PayPal call (test `a_purchase_without_a_band_lapses_after_a_day_and_a_band_deadline_still_wins`). A proposal writes one `purchase.proposed` audit row (test `one_purchase_proposal_writes_exactly_one_audit_row_and_the_chain_verifies`). The mock Shopper copy in `backend.ts` now matches `configuration.rs`.

## H5 seller money in (2026-10-07, shield-screening rework slice 1)

Operator decision on H5 (ask c9f99185): money in needs no click. Council-lite run 3ff9d92d's
value line ("the seller wallet's automatic steps cannot run in the native build") is closed; its
craft-4 item and question 2 of run ed13e041 are taken in.
- (1) One shield gate: `shield_allows(verdict, decided_by, step)` in `table-app` `pipeline.rs`
  replaces the four copies in create, authorize, capture and `step_allowed`. HOLD and BLOCK stop
  every step under every authority; ASK passes Human and HouseMandate as before, and
  SellerMandate on authorize and capture only (`authority()` grants it only on a seller deal in
  Approved or Authorized, an order the buyer already approved). Create, purchases and Policy keep
  today's gate. Test: `the_shield_gate_matrix_pins_h5_and_step_allowed_agrees_with_every_real_step`
  (4 verdicts x 4 authorities x 3 steps, real steps, `step_allowed` agrees wherever it can
  judge, a refusal writes and calls nothing). The two tests that pinned "ASK stops the seller"
  were rewritten to the rule (`shield_ask_stops_policy_and_a_revoked_mandate_stops_the_seller_before_network`,
  `a_buyer_approval_counts_until_the_order_expires_though_the_market_went_stale`).
- (2) A stale market price can hold a deal but never clear it: `table_shield::Case` gains
  `market_fresh`; `shield()` passes the deal's reference whatever its age. The 40% rule runs on
  any reference; a stale one that does not trigger it gives ASK, never CLEAR. BLOCK rules and
  `combine()` unchanged. Test: table-shield `a_stale_market_can_hold_a_deal_but_never_clear_it`.
- (3) Acceptance H5 in the runtime, `table-runtime/src/h5_tests.rs`:
  `h5_the_seller_takes_money_in_on_the_buyers_approval_with_no_click` (no market reference; the
  owner creates the order from the approval window because the create gate still asks; the
  buyer's APPROVED is seen by the next tick after the approval window idle-locked; authorize and
  capture run under SellerMandate, read from each operation's `money.authorized` audit row, the
  value also stored in `operations.decided_by`; RECEIPTED). Negative cases:
  `a_fresh_price_hold_stops_the_sellers_authorize_and_ageing_never_lifts_it`,
  `a_payee_mismatch_blocks_and_nothing_moves`, `the_sellers_create_on_policy_still_asks`,
  `a_purchase_step_on_policy_is_still_refused`. `Pipeline::shield_verdict(id, now)` is a new
  read-only accessor (Rust only, not IPC).
- (4) The forecast's seller window still holds: its gate only turns from pass to refusal (HOLD
  and BLOCK no longer depend on the time; what ages moves only between ASK and CLEAR, both pass;
  the mandate refuses from expiry and band deadline). No fail-closed change was needed; the doc
  comment on `seller_mandate_window` says why. Differential tests:
  `an_unpriced_seller_order_forecasts_money_in_and_a_real_tick_agrees`,
  `a_price_held_seller_order_forecasts_no_money_in_after_its_market_ages`. The table-attention
  property test `forecast_never_moves_money_out_over_every_input` passes unedited.
- What a shield refusal of the seller's authorize or capture does to the tick today (unchanged,
  `scheduler.rs`): `tick_deal` propagates the pipeline's `Permission` error, so `tick()` returns
  it as its first failure after still processing the other deals. Nothing is recorded (no
  operation, no `paypal_calls` row, no audit row), the deal stays Approved (or Authorized) and the
  refusal repeats every tick until the deadline default applies (expiry, or auto-void 72 h after
  authorize). Recording the refusal is shield slice 2.
- Left for shield slice 2: `Deal.shield` has no production writer (BLOCK reaches the gate only
  through it; the native `shield()` cannot see a payee mismatch, which the order check catches as
  Mismatch); the model-caution path has no production caller; release vs recompute (a released
  model HOLD becomes ASK, which now passes the seller's authorize and capture); the
  new-counterparty fixtures.

## Overnight waves (2026-10-07, coordinator session)

One coordinator merged builder sessions wave by wave on `claude/confident-euler-99xqm9`, rerunning
the full client and Rust gates after every merge. Wave 1: T4 slice 3 + T2 badge, T5, T7. Before
it, the Linux legs of CI were made green: `table-engine/tests/native.rs` wrote `codex.exe` (only
Windows resolves it) and left Windows-only helpers unused under clippy `-D warnings`.

### T4 slice 3 walk-away + quit confirm, T2 practice-agent badge (83174f3, 93e93f3)

- **Quit lines (pure, new):** `table_attention::quit` adds `quit_lines(&[QuitSource], &[ForecastLine]) -> QuitLines { while_off, at_paypal }`, `QuitLine { deal_id, label, effect, amount_minor, currency, text }`, `QuitEffect` (`request_not_sent | not_collected | not_collected_if_approved | waits | request_runs_out | hold_runs_out | seller_may_collect`), `ON_QUIT` and `quit_message` (native dialog text: deal numbers, never ids). Quitting stops the scheduler, so every create, authorize or capture in the forecast becomes a "won't happen while The Table is off" line; a buyer-approval step reads "If the buyer approves on PayPal, the payment is not collected until you open The Table again". An order awaiting approval or a hold also gets "still happens at PayPal by itself" (approve window; a hold released by PayPal after 29 days at most, paypal-platform.md:22/:114 [S]). A buyer deal already approved or on hold says the seller can still collect it (paypal-platform.md:361). Every pending deal gets at least one line; no line says money goes out.
- **Contract:** `QuitSummary` gains optional `while_off` / `at_paypal` (`None` when the forecast read fails); bindings `QuitSummary.ts`, `QuitLine.ts`, `QuitEffect.ts`. `quit_confirm`'s `confirmation_id` now hashes `(pending deals, while_off, at_paypal, on_quit)`, so a change that alters only the lines is refused.
- **Behaviour change:** a deal held only by its shield verdict counts as pending only while not terminal; MISMATCH stays listed.
- **Native tray Quit** shows `quit_message` and asks again if the confirm is refused because what it showed changed. Windows-only: **not compiled on this Linux host**; compile and native check owed. It keeps the plugin's OK/Cancel labels.
- **Tumbler stack:** one "If you walk away" row from `AttentionSnapshot.forecast`: `$0.00 out` per currency, `$X in` / `up to $X in` when a buyer approval is needed, `N holds released`; ⓘ opens up to three lines (when · what · "your rule" / "safe default" / "the buyer already approved"), conditional lines read "If the buyer approves". No forecast reads "Can't forecast right now". Aggregation in `tumbler/logic.ts` (`walkAway`), labels and amounts only (W4). The stack list shows one row fewer and scrolls.
- **Quit sheet (main, new):** `QuitSheet` (Ctrl K → "Quit The Table"), `main/quit.ts` `quitView`; leads with Rust's `on_quit`, then "Won't happen while The Table is off" and "Still happens at PayPal, by itself"; a refused confirm reloads. Buttons "Keep it running" / "Quit The Table" (no gold). Nothing in the client rendered a quit confirm before.
- **T2 badge:** `runBadge` (words.ts) and `RunBadge` (shared/honesty.tsx) show "Practice agent" next to runs whose `mode` is `scripted_engine` (deal page agent chip, Details "Agent app" row, Settings working-agent rows).
- **Mock:** `mock/forecast.ts` mirrors `forecast()` and `quit_lines`; `attention_list` carries `forecast` (`?forecast=off` previews a failed read); `quit_confirm` refuses a changed confirmation; `agent_start` uses `scripted_engine` only for the scripted engine (as `engines.rs`).
- **Tests:** `table_attention::quit::tests` (11: seller order awaiting buyer, physical seller order, approved seller order, agreed seller deal, authorized hold, seller hold, buyer offer waits, pending deal without forecast line, no open deals, no line says money goes out, dialog names deal numbers); `table-runtime` `quit_tests` (6, incl. `quit_confirm_refuses_when_the_shown_lines_changed_though_the_deals_did_not`, `quit_with_an_unreadable_forecast_promises_nothing_per_deal`); client `tumbler/walkaway.test.ts` (9), `main/quit.test.ts` (3), `lib/runWords.test.tsx` (3), `mock/forecast.test.ts` (3).
- **UNVERIFIED:** how long PayPal keeps an approved-but-uncollected order is not in the research, so no line claims it.
- **Left:** native Windows compile and check of the tray quit dialog; a Tumbler-menu quit entry if a menu is added.

### T7 "Maya's week" director: a no-install judge path on the mock (deceb2b, aaec457)

Client only, no contract change. Run: `pnpm --dir apps/desktop/client dev`, open `/director.html`
(or serve a static `dist`). Linked from the README.
- **One clock.** `src/lib/clock.ts` is the only clock: `nowUnix()` (format.ts) and `useNow()` (hooks.ts) read `clockNow()`; `useNow` re-renders at once on a jump; Tumbler snooze checks and the CircuitView facts timestamp moved off `Date.now()`. In the shell it is wall time: `simulateClock()` refuses when `__TAURI_INTERNALS__` is present and `setClockOffset` is ignored unless simulation is on.
- **Shared mock clock.** `mockBackend()` turns simulation on and reads the offset from `localStorage['the-table-mock-clock']`; a `{kind:'clock'}` envelope on the `the-table-mock` BroadcastChannel keeps every mock window on one offset; `resetMockState()` clears it.
- **`MockWorld`** (`mockBackend(label).world`, preview only, no money operation): `advance` / `sweep` apply table-core's deadline defaults (AUTHORIZED→AUTO_VOIDED; PAIRING/LISTED/NEGOTIATING/AGREED→WITHDRAWN; SETTLING/AWAITING_APPROVAL/APPROVED→EXPIRED), each with `decided_by {type:'safe_default', deadline}`, an audit row, `deal:changed` + `receipt:created` with the shell's sentence, then `attention:changed`. `rewind(label, upTo, interim)` shows a deal part-way through its signed steps; `reset(at?)` starts the week at a story time (14:02:04 local, so the fixtures' 18:00 and 20:00 are true).
- **Beats as data** (`src/director/`): `actions.ts` (typed `Action` union with deliberately no approve, pay, capture or release action; `runActions`, `applyWorld`, `foldScene`), `helpers.ts` (every Tumbler preview control as a beat helper; `Preview.tsx` runs the same helpers; new stage controls "Deadline passes" and "Four hours pass"; the ≤2 h / ≤15 min controls move the shared clock), `beats.ts` (21 beats in 6 chapters, about 2:50): (a) the haggle to Dan's $329 counter, the ask-me-above gate, the Tumbler card, the approval window opens (never approved); (d) the clock runs past the deadline and D-0193 is withdrawn by the safe default; (c) D-0199's $339 request does not match the $329 deal: a hold and a review with no pay button; (b) The Table closes, D-0190 on hold, days pass, AUTO_VOIDED.
- **`director.html`** (vite input `director`): a dark (or light, following `table-theme`) stage with the three windows framed at native sizes (`index.html` 1280×800, `approval.html` 744×660, `tumbler.html?frame=director` = new bare `preview/Framed.tsx`), a camera that follows each beat, a caption rail with simulated time, play/pause/previous/next/restart (Space, ←, →, Home), a per-chapter scrubber, and the permanent banner "Browser preview with sample data — not the wallet. No PayPal page is ever shown." `?beat=`, `?play=0`, `?camera=desk`. Refuses to run inside the shell; ships in `dist` but no shell window points at it.
- **Wording:** `words.ts` gains plain words for the shell's deadline sentence; the D-0199 fixture's silence line no longer says "SETTLE" (coordinator fix).
- **Tests (22):** `src/lib/clock.test.ts` (4), `src/director/beats.test.ts` (8: ordered, readable timing, known actions only, never moves money, plain-word captions, all four stories, beatAt, helpers cover every preview control), `src/director/story.test.ts` (10: each story's end state, the whole run never transitions into a money state and every lapse is safe_default, seek equivalence, shared offset, ladder follows the clock, reset alignment, the clock never runs backwards).
- **Deviations:** story order is a, d, c, b (a days-long jump in b would lapse the haggle first). The mock's idle lock follows the simulated clock, so the Tumbler shows its lock after jumps over 15 minutes (accurate).
- **Left:** reuse the beat file for Playwright video takes; measure time-to-first-gate on cold viewers (target under 30 s); host the static build at a public link.

### T5 Rust-composed approval checks (97cb9eb; approval-window-1)

The approval checklist is composed by the pipeline from the predicates the money steps run, and
each owner decision is bound to the exact list it was taken on. No new command, capability,
migration or dependency; no PayPal endpoint, field or limit added.
- **Domain (`table-core/src/checks.rs`):** `ApprovalCheck { id, status, text, detail }`; `ApprovalCheckId` = amount, payee, host, invoice, shield, mandate (enum order is list order); `ApprovalCheckStatus` = pass, fail, wait, not_applicable; `checks_hash()` = SHA-256 over `b"table.approval-checks.v1\0"` + canonical JSON of the list.
- **Composition (`table-app/src/checks.rs`):** pure `compose(&CheckFacts)` + `Pipeline::approval_checks(id, now)` (reads the ledger, `shield_verdict`, `mandate_check`; no PayPal, no write). amount: latest stored SETTLE amount (and AUTHORIZE intent) vs signed terms, a buyer accepting a counter compares the pending offer's terms hash, MISMATCH fails, no order yet = wait. payee: `settlement_payee` must be the owner's own single payee, a paired key's declared payee, or on the clause-7 list. host: `table_proto::approval_url` allowlist, only when a link exists (refused host named in detail only). invoice: `invoice_id(deal, attempt)` equals the SETTLE's. shield: CLEAR/ASK pass; HOLD/BLOCK/unreadable fail. mandate: Allow passes; clause-6 Ask passes as "your call"; Refused / retired / not-yet-active / unreadable fail. Layer-1 `text` carries no ids, clause numbers, protocol verbs or hosts. New read-only `Ledger::latest_settle(id)` re-verifies the transcript first.
- **Contract:** `ApprovalSummary.checks`, `ApprovalSummary.checks_hash` (required); `DecisionArgs.checks_hash?: H256 | null`; bindings `ApprovalCheck.ts`, `ApprovalCheckId.ts`, `ApprovalCheckStatus.ts`.
- **Runtime (`service.rs`):** `decide()` recomputes the checks for every decision except Void (countersign, owner accept, capture, open PayPal, shield release, rescue), after the label/token/selected/terms/attempt checks and before the ticket. Missing or different hash → `INVALID "The summary changed. Review it again."`; any failing line → `INVALID "A check on this deal failed, so nothing was done."` (shield release exempt for the shield line only). A refused decision makes no PayPal call and writes no row and no state. An accepted decision appends one `owner.decision` audit row from `owner` with `{decision, decided_by: human{at}, checks_hash, terms_hash, attempt}` just before its step.
- **Client:** `buildChecks` and its synthetic lines deleted (with dead `ui.tsx` `Checks` and `Parts.tsx` `rowChecks`); `review/Checks.tsx` `WalletChecks` renders Rust's lines verbatim (mark, "Why?" for fail/wait, "Proof" for detail, not-needed lines folded); CHECKING reveal stays presentation. `gating.ts` `checksAllow` replaces `anyCheckFailed`; void/withdraw never need it. `decisionArgs` / `ownerAcceptArgs` send `checks_hash`; "summary changed" refetches and replays the reveal. Details lists every check plus a "Checklist" hash reference. words.ts: `SUMMARY_CHANGED`, `CHECK_FAILED`, `CHECK_STATUS_WORD`.
- **Mock parity:** `src/mock/checks.ts` composes the same six lines; every money handler enforces hash and fail rules; D-0199 fails the amount line, D-0198 fails only the shield line. M12 approved payees gained `partsco` and `pixel-bay` (Rust's clause 7 refuses unlisted payees). `STORE_KEY` → `the-table-mock-state-v6`.
- **Tests:** table-core `the_checks_hash_is_domain_separated_and_commits_every_field_and_the_order`; table-app `checks_tests.rs` (9, one per check pass and fail, plus money formatting); table-runtime `checks_tests.rs` `a_decision_with_a_missing_or_stale_checks_hash_is_refused_before_any_paypal_call_or_write` (all six hash-bound decisions; zero HTTP paths and `paypal_calls` rows; no new audit row; void needs no hash; `owner.decision` row ahead of `money.authorized`) and `a_decision_while_a_check_fails_is_refused_and_a_release_may_fail_only_the_shield_line`; `real_actor_countersign_verified_browser_link_poll_and_seller_capture` also asserts a reused pre-order hash is refused. Client `mock/checks.test.ts` (5), `review/checks.test.tsx` (4), a T5 gating block (4).
- **Deviations:** (1) the hash goes in a dedicated `owner.decision` audit row, not inside the money rows (no ledger signature or `DecidedBy` change; written before the step, so a step that fails at PayPal still has its decision recorded; open PayPal now writes this one row). (2) "All checks pass" = no line fails; a wait line is one the decision's own step verifies before money moves. (3) the window's own comparison rows (`diff.ts`) no longer narrow gating. (4) a shield release is also refused when another line fails (tightening). (5) a rescue approval is hash-checked before it answers UNAVAILABLE.
- **Flaky under load (seen once, unrelated):** `house_tests::house_health_stays_up_through_a_slow_tick_of_several_deals` timed out at 10 s with load ~4.5; passed 3 times alone.
- **Left:** a Proof drawer reading `owner.decision` rows ("owner saw: …"); the per-decision native prompt (native-shell-1); a buyer haggle's PayPal order payee is not read (the order is seller-owned).

### T6 Rewind: who decided each money step (3e75215, 0b433e8; main-window-2)

It shows, from the verified audit chain, who decided each money step. Typed DecisionTraces
(money-pipeline-2) are not built. No migration, no new dependency, no new privileged command, no
PayPal call, no write path; `audit_log` is unchanged.
- **Contract** (`table-client`): `deal_history(DealHistoryArgs { deal_id?, from?, to? }) -> DealHistory { steps, truncated }`. `from`/`to` are Unix seconds, window `[from, to)`, `from >= to` is INVALID. Steps oldest first, capped at the newest 500 (`HISTORY_STEPS`); at most 4000 rows read; `truncated` says older ones were left out. `HistoryStep { at, deal_id, seq, kind, state_after?, authority, paypal }`; `kind` is a closed `HistoryKind` (37 values, `other` for anything unclassified); `authority` closed: owner / signed_rule{clause?} / seller_mandate / house_mandate / safe_default / agent_intent / none; `paypal` none or `{ method: create_order|authorize|capture|void|read_order|reporting|other, outcome: ok|failed|unknown }`. Appended to COMMANDS (not RELEASE_COMMANDS); main only (`capabilities/main.json`, build.rs, generate_handler!), no unlock.
- **Ledger** (`audit.rs`): `history_rows(deal?, from?, to?, limit)` verifies the whole chain first (a broken chain is an `Integrity` error, never a partial list); `paypal_statuses_at(deal, at)`.
- **Projection** (`table-runtime/src/history.rs`, pure `project`): reads only typed fields (action name, `decided_by`, `to`, envelope `typ`/`direction`, `operation`/`confirmed`, `status`, allowlisted path family); `detail_json`, reasons, request ids, hashes and note text never cross; NOTE and HELLO are not steps. `money.authorized` opens an operation whose transitions fold into the `money.observed` step; an unconfirmed operation is `failed` when a 4xx was recorded at that time, `unknown` otherwise. An order read becomes the call of the transition it caused; reporting reads attach to `reporting_checked`. A deadline WITHDRAWN under a safe default is `lapsed`. `intent.refused` becomes signed_rule with no clause (its reason is free text). `shield.released` is the owner. Bookkeeping rows are skipped (`deadline.set`, `market.observed`, `relay.bound`, `run.*`, `counterparty.pinned`, `envelope.rejected`, `mandate.*`, `deal.mandate_rebound`). `offer.declined` (hosted HOUSE only) is `other`. New actions from T5 (`owner.decision`) are classified by the table-driven test that scans the sources.
- **Home (the Dial):** "Rewind" from the footer chip or `R` (in the `?` sheet); Esc or "Back to now" returns to live. A Mon–Sun engraved scrubber (day marks, hatched future, gold playhead, ‹ › week paging, Play/Pause: a week in 16 s; reduced motion jumps tick to tick; keyboard slider ←/→ hour, Shift day, Home/End, Space). Beads stand by their state at the playhead (pure `historyAt` in `logic.ts`). One tick per money operation coloured by authority: you = gold, your signed rule = teal, buyer approved under your shop rules = green, safe default = grey; a refusal is a red ×; agent or nobody dashed. Clicking a tick opens the deal. The hub narrates the step in plain words ("Tue 14:02 · Your rules refused 40 × GPU: over the per-deal limit. PayPal was never asked.").
- **Deal page:** a compact "Who decided" list under "What happened" (`deal/WhoDecided.tsx`). Coordinator fix: a deal that ended before its first milestone now leads the strip with its "Ended" marker (it overlapped "Proof").
- **Mock:** `deal_history` (main only, same window rules and cap) from a `history` of Maya's week (GPU refusal with no call, dock order and hold under rule 6, D-0185 seller authorize and capture under the seller mandate, the owner's D-0180 void, new fixture D-0181 voided by the safe default; Spend now has 6 deals). Every fixture deal's replay ends in its current state; fixture `created_at` is pulled back to the deal's first history step (coordinator fix). `STORE_KEY` → `the-table-mock-state-v7`.
- **Tests (Rust):** `history::tests::every_audit_action_the_wallet_writes_is_classified_by_typed_fields_only` (also scans ledger, app and runtime sources so a new audit action without a row fails), `history::tests::a_money_operation_folds_its_transitions_and_an_unconfirmed_call_says_failed_or_unknown`, `history_tests::{a_seller_capture_shows_the_rule_that_ordered_and_the_seller_mandate_that_collected, a_hold_left_alone_is_voided_by_the_safe_default, a_refused_intent_names_its_clause_and_has_no_paypal_tick, history_is_main_only_read_only_closed_and_never_carries_their_words}`, ledger `history_rows_are_deal_scoped_windowed_capped_and_refused_whole_on_a_broken_chain`. **Client:** `src/windows/main/rewind.test.ts` (13).
- **Deviations:** seconds not ms; one tick per money operation, not per `paypal_calls` row (order and reporting reads are not ticks).
- **Left:** native shell command compiles only on Windows (not built here); the typed DecisionTrace would let `intent.refused` name its clause; no Proof drawer link from a tick.

### T12 Mandate what-if before signing (d496eb1, 4ad4487; approval-window-2)

`mandate_simulate(MandateSimulateArgs { draft: MandateSignArgs, from?, to? }) -> MandateSimulation { from, to, lines: Vec<SimulatedLine>, not_simulated }`.
Approval label only, no token and no unlock (it moves nothing). Read-only: nothing is signed, no
row is written, PayPal is never called. Lines: `{ deal_id, label, title, item_ref, kind, side, at,
amount?, unit_price, before, after }`; `SimulatedVerdict` closed: `allow | ask{clause} |
refuse{clause, reason} | not_simulated`.
- **How (`crates/table-runtime/src/simulate.rs`):** the draft is built by `draft_payload`, now shared with `sign_mandate`; an invalid draft fails `validate()` and is answered REFUSED with `mandate_sign`'s message. An edited mandate (`draft.id`) replays its own deals; a new mandate replays the deals whose mandate agent key is the slot's key. Default window the last 7 days; a backwards window or one over 31 days is INVALID. Intent per deal is rebuilt as `mandate_check_rounds` builds it (role from side and kind, `deal_category`, `counterparty_policy`, rounds used, `usage_for(deal, created_at)` per scan C-4). A missing category, counterparty row, readable rounds/usage or `created_at` makes the line `not_simulated` (counted, never guessed). `before` = the in-force version (none in force = `refuse{1, "mandate is not active"}` as the pipeline answers); `after` = the draft; both through `MandatePayload::check` itself.
- **Client:** `MandateEditor` replaces the UNAVAILABLE replay; `useSimulation` debounces 400 ms and keeps the last answer dimmed while updating. A one-line summary sits above Sign ("This version would have refused 1, asked you about 2, allowed 6; 1 couldn't be checked."); the scoreboard reads now → with your change; the table lists only deals whose answer changed (rules in words, no clause numbers on Layer 1), unchanged ones fold. Lever ticks and the sign sheet's "In plain words" read the same answer; hovering Withdraw previews every line refused with "No rules in force". `owner/preview.ts` (the hand-copied clause mirror) and its test are deleted, with `diff.ts` `oneClauseFromDraft`.
- **Mock:** `mock/simulate.ts` mirrors `validate()` and `check()` with Rust's reason strings; `MockState.categories` per fixture deal (D-0180 has none, so it shows "not checked"; D-0181 added at merge); GATE `mandate_simulate: ['approval']`.
- **Wiring:** `COMMANDS`, `CommandContract`, `Action::Simulate`, dispatcher, native `commands.rs`/`native.rs`, `build.rs`, `capabilities/approval.json` and the capability test, appended; bindings regenerated (4 new files).
- **Tests:** `table-runtime` `tests::simulate_tests` (10: unchanged rules replay as today; lowering ask-me to $50 turns the $64 dock into a question; adding compute leaves the GPU refused by the per-deal limit; removing a payee refuses that payee's deals; missing fact → not simulated; invalid draft refused and nothing replayed; window and agent scope; writes nothing, signs nothing, calls no PayPal; approval only, no token or unlock; a deal under the rules in force gets the live pipeline's verdict via `Wallet::check_mandate`). Desktop capability test gains `mandate-simulate`. Client `mock/simulate.test.ts` (6), `owner/whatif.test.tsx` (7).
- **Deviations:** seconds not ms; validity dates are not replayed against the past (each payload is checked at `max(now, payload.not_before)`, a what-if on the terms); a seller deal under a draft naming other than exactly one payee is `not_simulated`; Main's "Clause trace" reuse is not built.
- **Left:** persist the Intent at check time if replayed intents ever diverge; Main "Clause trace"; mock usage approximates agreement order by creation time.

### T10 PayPal ground truth: read-back resolver (3515b2f, 5e62cc2, 2b9b247; money-pipeline-1)

- **What it does.** A create, authorize, capture or void whose PayPal outcome is unknown (transport loss, timeout, undecodable 2xx, a non-confirming answer, or `pending` left by a stopped process) stays reserved under its one request id. `table_app::Pipeline::resolve` / `resolve_due` (`crates/table-app/src/resolve.rs`) reads PayPal's order (`GET /v2/checkout/orders/{id}`, recorded in `paypal_calls`) and does exactly one of: **confirm** (`Ledger::resolve_confirmed` finishes the operation with the observed facts under its original `decided_by` and applies the event the answer would have applied; authorize deadline counts from the reservation; capture receipt signed through `issue_receipt`); **re-send with the identical request id** (`resend_gate` re-runs `authority()`, requires the same `decided_by`, re-runs `shield_allows`, the capture deadline and countersign, the chosen lapse, `Pipeline::policy_paused`, the 6 h request-id window and `MAX_RESENDS = 3`; a safe-default void has no budget or window); or **park** (`Ledger::park_operation`, reason recorded; backoff 15 s doubling to 900 s).
- **Create has no read-back** (the order id was in the lost answer and the research documents no read by request id): inside 6 h it is re-sent with the same id (PayPal keeps request ids 6 h [S-spec]; acceptance F2), otherwise it parks and lapses at its deadline (its approval link never left the wallet).
- **The resolver never calls `reserve_operation`**, so it cannot mint a request id, and it parks as ambiguous if the stored id differs from `RequestId::for_operation(deal, attempt, op)`.
- **Deadlines:** `Pipeline::deadline_default` (now used by the scheduler, `Pipeline::tick` and the HOUSE) and `auto_void` read an open operation back first: an unreadable capture blocks the void (a capture that went through cannot be voided; no money moves); a capture or authorize PayPal shows not done after its deadline closes as `not_done` and the safe default runs. A deadline default never captures.
- **While an operation is open:** `create`, `authorize`, `capture`, `owner_void`, `step_allowed` and `Wallet::withdraw` refuse with `Permission` (nothing written); the scheduler starts no step and the forecast excludes the deal.
- **Where it runs:** the wallet scheduler (`tick_deal`) every tick on the operation's backoff, which also resolves what a crash left pending; the HOUSE `Seller::resolve_pending` before its loop (replacing `report_pending`; logs `house pending deal=… operation=… outcome=…`), and `advance` resolves first.
- **Ledger:** migration `0008_resolver.sql` adds `operation_checks(deal_id, attempt, operation, state parked|closed, reason, tries, resends, next_at, updated_at)` (FK to `operations`), `user_version` 8. **Deviation from design §8 DDL:** one added table. `finish_operation` goes through a shared `resolver::finish`; new read-only `paypal_call_requests(id)`.
- **Audit actions (new):** `money.resent`, `money.parked` (reasons `unreadable`, `ambiguous`, `needs_owner`, `refused`, `window`; written on the first park and when the reason changes), `money.resolved` (outcomes `confirmed`, `confirmed_after_resend`, `not_done`, `lapsed`). The Rewind classifies a park as the new `HistoryKind::CheckingWithPaypal` step; resolved, resent and T5's `owner.decision` are bookkeeping; its source scan now covers `resolver.rs` and `service.rs` (coordinator, at merge).
- **Contract:** optional `DealEvidence.money_check` and `AttentionItem.money_check` (`MoneyCheck { step, state: checking|parked, since, next_check }`); no new command. While open, the attention item is a HOLD with only `open_in_table`, headline "Checking with PayPal $X", silence `MONEY_CHECK_SILENCE` ("nothing more is sent until PayPal confirms"), shown even on a lapse-chosen deal.
- **Client:** `moneyCheckWord`, `MONEY_CHECK_PARKED` ("We couldn't confirm a payment with PayPal. Nothing more will be sent until we can."); deal page dashed "Checking with PayPal" pill, "Not confirmed yet", step "Checking", no Withdraw; Tumbler "Checking" chip; Counter dashed chip (not counted as needing the owner); Book "payments checking with PayPal" item and pills. Mock fixture D-0194 (seller capture parked) with its Rewind story; money handlers refuse with PERMISSION while checking. UX-GUIDE gains one vocabulary row.
- **Tests:** table-app `tests/resolver.rs` (stateful PayPal double with an idempotency store and cut / lose / garble / unreadable chaos): `lost_answer_after_paypal_did_it_confirms_with_one_paypal_write` (all 4 operations), `lost_before_paypal_saw_it_resends_with_the_identical_request_id`, `confirmed_steps_carry_their_facts_receipt_and_deadline`, `an_undecodable_2xx_is_read_back_and_confirmed`, `unreadable_paypal_parks_and_the_deadline_never_collects`, `an_expired_owner_ticket_parks_and_never_resends`, `a_refused_resend_records_only_the_read`, `no_path_sends_one_operation_under_two_request_ids` (4 operations × 5 chaos modes × 40 ticks); unit tests in `resolve.rs`; table-runtime `house_restart_mid_capture_resolves_on_startup_under_the_same_request_id` (replaces `…reserves_no_second_request_id_and_reports_it`), `failed_void_does_not_starve_another_deadline_or_retry_unknown_money` rewritten; table-attention `a_money_check_is_a_hold_that_only_opens_the_deal_and_never_promises_money`, `a_money_check_keeps_its_own_line_whatever_the_forecast_says`; client `src/lib/moneyCheck.test.ts`.
- **UNVERIFIED:** order reads list an authorization's captures under `purchase_units[].payments.captures` (the shape `Payments` already decodes); the authorization status `VOIDED` inside an order read (the research names only the webhook `PAYMENT.AUTHORIZATION.VOIDED`); the 6 h `PayPal-Request-Id` store for the Payments v2 capture and void (the research states it for Orders v2 only); the resolver has not run against the live sandbox. Add these to sandbox spike 3.
- **Left:** an approval-window action to re-send an owner-decided step under a fresh ticket (the API accepts one; no command calls it); the sandbox-only "cut the wire" developer setting (only the test double exists); open operations on deals that ended for another reason (e.g. a peer WITHDRAW) are not resolved; Book totals still count a parked capture under "On hold"; a deal with no deadline and a parked create stays Settling. `house_health_stays_up_through_a_slow_tick_of_several_deals` timed out once under parallel load (10 s wait); passes alone.

### Design polish pass 1: module pages, deal page, sheets (dccb6fe, 0ade069; client only)

- **Sample times:** `buildMockState` gains a fixture-only `at: [created, updated]`; live deals sit at offsets matching their transcripts/notes/deadlines, closed deals are spread over the week so far (clamped to Monday 01:00 local so `ledgerScope` keeps them "this week"). Where a deal has a Rewind history, that history is the one clock (created = first step, updated = latest; coordinator, at merge). Silence lines use the core's sentences (`table-attention` silence.rs) instead of "auto-void at 72 h", fixed clock times or "SETTLE".
- `clockLabel(unix, now?)`: weekday + time within 6 days, otherwise "3 Nov 23:20" (was "Shop rules in force until Tue" for a 27-day expiry).
- **Deal page:** an ending before the first milestone leads the strip; the thread's top fade only while content is hidden above; thread + facts span the page; Start agent is not primary while the deal needs the owner; deal id removed from the header line (kept in Details); "Who decided" also lists a payment being checked with PayPal.
- **Layer-1 ids removed:** Shield paused card (names the item) and rows, Rescue decision card, Counter order cards and simple past rows, Tables closed rows.
- **Counter:** code-only items shown as a quiet mono code tag with a tooltip (never humanised into a fake catalog title); price inputs carry a currency mark (`currencyMark`); the tray no longer lets rows ghost through.
- **Shared CSS:** explainer steps and the settings chain keep title + description together; the Connections caption sits under its title; Tables' list heading matches `.ui-section-h`; "Open deal" everywhere; Agent rules shows "3 agents · 5 rule sets".
- **Tests:** `lib/foundation.test.ts` (weekday vs date), `setup/limits.test.ts` (`setsLine`), `modules/counter/model.test.ts` (`currencyMark`); `clientRequests.test.ts` compares created_at with the fixture's value.
- **Left:** the deal breadcrumb still shows the deal label (App.tsx); `countdown()` prints "2 d 18 h" (UX-GUIDE prefers "2 days 18 h"; shared with Tumbler/approval); two "Assistant · Shop order deals" cards look alike.

### T14 Wallet-wide limits / exposure envelope (cac2633, ceefb45; core-domain-2)

- **Exposure fold (`table-core/src/exposure.rs`, pure):** `fold_exposure(&[ExposureDeal], now)` per currency (never converted), money out only (buyer deals): `paid_today`, `held` (AUTHORIZED now), `committed` (AGREED/SETTLING/AWAITING_APPROVAL/APPROVED now), `out_today` (the day's budget), `deals_today`. Released states never count; seller deals (money in) never count. Day rules are the per-mandate velocity's (scan C-4): a deal's place is its first `deal.transition` to AGREED in audit order; `exposure_for_deal` judges a deal against the deals that agreed earlier that UTC day and every other deal's held and committed money.
- **WalletEnvelope** `{ version, currency, max_out_day, max_held, max_deals_day, expires }`, owner-signed over `b"table.wallet-envelope.v1\0" || JCS(payload)`; `validate()` refuses version 0, mixed currency, zero limits, bad expiry. `check()` only refuses: seller side allows; expired, other currency, deals today ≥ max, out today + amount > max_out_day, or held + committed + amount > max_held refuse. Refusals map to `Refusal { clause: ENVELOPE_CLAUSE (0) }`, Display `wallet limit <limit>: <reason>`.
- **Where it runs:** `Wallet::envelope_check`, called inside `mandate_check_rounds` right after `MandatePayload::check`, so agent intents, `check_owner_accept`, `OpenBrowser` and every `Pipeline::authority()` step are covered before any write, reservation or PayPal call (`pipeline.rs` unchanged). No limits signed = no extra limit; a stored row that fails body, commitment or signature checks refuses money out (never reads as no limit). An agent purchase or accept refused by the limits writes `intent.refused {layer:"wallet_limit"}`; a purchase goes REFUSED with `decided_by: Policy{clause:0}`. The T5 checklist's rules line says "Outside your rules: your wallet limits."
- **Ledger:** migration **`0009_wallet_limits.sql`** (renumbered at merge; T10 took 0008) adds `wallet_envelopes` with update/delete abort triggers; `user_version` 9. `insert_wallet_envelope` verifies the signature, requires the next version and writes one `wallet_limit.signed` audit row (Rewind: bookkeeping; the scanner reads `limits.rs`). `active_wallet_envelope` re-verifies on read.
- **Commands:** `envelope_sign` (approval label + token + unlocked; in RELEASE_COMMANDS; an unusable set or a past expiry is REFUSED); `envelope_get() -> ExposureView` (main, tumbler, approval; status none/active/expired/unverified, limits and numbers only). `AttentionSnapshot` gains optional `exposure`; `wallet_spend_today_minor/currency` now come from the fold.
- **Client:** approval owner configuration "Wallet limits" card (three rows with today's meters, a change sheet with one gold button); Home "Today", the title-bar meter and the Tumbler stack show paid out today and on hold now against the limits (gold at 4/5, integer arithmetic); "No wallet limit" when none; expired or unverified limits get a gold line. `src/lib/limits.ts`; mock `src/mock/exposure.ts` (`?limits=none` previews no limits; Maya's limits $1,000 a day, $600 on hold, 6 deals a day). Mock store key v9.
- **Tests:** table-core 7 (incl. property test `no_sequence_of_deals_across_mandates_exceeds_the_envelope`, 300 runs); table-ledger 3 (incl. `forged_or_tampered_limits_never_read_as_none`, differential `the_exposure_window_equals_the_velocity_window_under_one_mandate`); table-runtime 6 (incl. `the_wallet_limit_refuses_the_third_purchase_across_mandates_before_any_paypal_call`, `tighter_limits_stop_an_owner_decision_before_any_paypal_call`, `wide_wallet_limits_never_loosen_a_mandate`, `expired_or_forged_limits_refuse_money_out_and_never_money_in`); client `limits.test.ts` (6), `exposure.test.ts` (4).
- **Deviations:** the check sits in the shared mandate check, not a separate pipeline call; `create_deal` checks the mandate directly, so opening a buyer deal is not checked against the limits (the first check is the agent's intent or a money step); "Most on hold at once" counts held plus agreed-and-waiting money; one currency per envelope (another currency is refused); `meters_available` stays false (meters show because `exposure` is present).
- **Left:** per-currency envelopes; "after this: $X of $Y today" on a buyer decision; Book metrics from the same fold; native check of the new commands (Windows shell).

### Design polish pass 2: Home (the Dial), the Tumbler, the approval window (2fa495f; client only)

- **Time words:** `countdown()` over a day reads "2 days 18 h" / "1 day 3 h" / "3 days" (UX-GUIDE); under a day it stays a ticking clock; one spelling for every `<Countdown>` (approval footer, deal page, Tumbler hand-off).
- **Home, Needs you:** rows are a 3-line grid (verb + amount / who + time left / the default on silence across the full width, 2-line clamp); no id fallback. **Hub plate:** module + time left (no id), silence line up to 2 lines, `shortTitle()`, "Open deal". **Rewind:** one "Back to now" (the scrubber's), focus lands on Play, ticks and aria labels carry no ids. **Footer:** the permanent "Press ? for shortcuts" line (against principle 7) is a quiet `?` chip; the `?` sheet adds ↑ ↓ for decisions.
- **Breadcrumbs:** the main deal crumb shows the deal title; `.ui-crumbs` last crumb ellipsizes; the approval `ReviewBar` drops the id.
- **Quit sheet / Ctrl K:** deals by title; palette items keep the label searchable through a hidden `also`.
- **Tumbler:** tickers name the deal by counterparty (`withWho`), never by label or a raw ULID; welcome legend no longer cut; stack rows bold the consequence (full text in the tooltip).
- **Tests:** `lib/foundation.test.ts` countdown days wording, `tumbler/logic.test.ts` tickers never name ids, `main/quit.test.ts` rows keep `dealId`.
- **Left:** the deal page shows "‹ The Table" beside the "The Table ›" crumb (`Shell.tsx`); the director's `offsetWords` still says "N d N h later"; Tumbler stack rows still truncate at 440 px (full text on hover); the mock gives the "Checking with PayPal" item `kind: 'hold'`, so the stack shows "Paused" for it.

### Book: "Ask in your own words" without an agent app (290a4ee; client only)

- **Built:** `modules/book/understand.ts`, a pure deterministic reader with a fixed word list (no LLM, no network, no IO) that turns a typed question (≤ 200 characters, `MAX_ASK`) into the closed `BookQuery`, answered by the existing `book_query`. Reads time ranges (today, yesterday, this/last week (Monday weeks), this/last month, this year, last N days, past week/fortnight/month, "since <weekday>", month names after "in"/"during", all time; sent as `range` [from, to) in RFC 3339 from the owner's UTC offset), metrics (count, sum_amount, avg_vs_market_pct, recovered_sum; default count + amount), statuses (paid, on hold, stopped, refused, refunded, mismatch, failed, disputed, in progress), kinds, groupings (day, counterparty, kind, state, decided_by; at most 2) and the reconciliation view. A counterparty filter matches only names from the known `counterparty_list` (display name, its parts, `declared_payee`, "house"); unpaired counterparties are never matched and a name made only of known words is never a name. Every word must be read or be a filler; otherwise the answer is "unsure" with the words it did not understand (never a guess). `book/rules.ts` ports `BookQuery::rejection` with Rust's exact words as a guard and test oracle; Rust still checks every query.
- **Screen:** "I read this as:" chips (remove ×; time and grouping editable; "Any time" not removable), the note "Understood by your wallet · no AI involved", an unsure line with three tested phrasings; the UNAVAILABLE path for typed questions is gone; Enter asks, Esc clears; a late answer to an older question is ignored; answer columns and group cells in plain words. Mock `book_query` checks and applies the range.
- **Tests:** `book/understand.test.ts` (47 phrasings → exact BookQuery, each passing the rules; unsure cases incl. `$100`, by item/hour, unknown or unpaired names, two times, three groupings, the cap; chip edits; the mock answers every phrasing; a bad range refused in Rust's words), `book/AskReading.test.tsx`. Client 600 tests.
- **Deviations:** spend and receive both read as "Paid" (money direction is not a BookQuery field; the answer keeps out and in on their own lines); grouped by day, the window uses local days while Rust's answer uses UTC days.
- **Left:** suggestions while typing; amount/date/vs-market comparisons are not read from text ("over $100" stays unsure); the slip shows the original text after chip edits.

### T9 glass-box HOUSE: public signed ledger, minutely head, buyer witness, scoreboard, verifier (d041ca9, 62c7d01; house-seller-1)

- **Types** (`table-proto/src/house_ledger.rs`): `HouseLedgerView` (`table.house.ledger.v1`), `HouseDealView`, `HouseRound`, `HouseMoneyStep`, `HouseClosed`, `HouseRefusals`, `HouseHead {epoch, epoch_started, row_count, audit_head, at}`, `SignedHouseHead`, `HousePrefix`/`SignedHousePrefix`; pure `compare_heads` → Same / Extends / Longer / NewEpoch / Shorter / Rewritten. Heads and prefixes are signed by the release agent key over JCS `["table.house.head.v1", head]` / `["table.house.prefix.v1", prefix]`. The epoch is the hash of the chain's first row, so a new disk is a visible new epoch. No field can carry free text; the guest appears only as a 12-character key-id prefix; no guest payee, PayPal id or secret.
- **Ledger reads** (`table-ledger/src/glass.rs`): `Ledger::house_facts(limit)` verifies the whole chain once and reads envelopes, closed mandates, `paypal_calls` counts and audit rows; read-only.
- **HOUSE** (`services/house-seller/src/glass.rs`, `routes.rs`): the actor publishes the projection and signed head at start, then at most once a minute (`PUBLISH_EVERY = 60`, cap 500 deals, 100 per page). Routes `GET /v1/house/head`, `GET /v1/house/prefix?rows=N`, `GET /v1/house/ledger?limit=&before=`, `GET /house` (+ `scoreboard.css` / `scoreboard.js`) read only the in-memory snapshot: never write, never call PayPal, hold no key. JSON routes `no-store`, CORS `*`; the page has a strict CSP. Turned-away requests counted by fixed reason code only since start. HOUSE secrets stay env-only (DECISIONS §14). DEPLOY.md lists the public read routes and the judge path.
- **Scoreboard** (`services/house-seller/src/scoreboard/`), served by the HOUSE so judges need no desktop app: tiles (deals today, median discount off the ask, turned away with 0 PayPal calls, entries in the signed record) and eight checks re-run in the browser (owner pin and mandate commitment and head signature via WebCrypto Ed25519 / SHA-256, shown as unknown when the browser lacks Ed25519; heads never shorter across this browser's earlier looks; never below the floor; capture only after authorize after approval; every money step under the house mandate or a safe-default void; no PayPal call without agreement; guests only as prefixes); deal search; "Check it yourself" (downloads and the `table-verify` command); light and dark, responsive.
- **Wallet witness** (`table-runtime/src/witness.rs`, `table-ledger/src/witness.rs`, migration **`0010_house_heads.sql`**, renumbered at merge, `user_version` 10): after a HOUSE purchase is RECEIPTED or RECONCILED the actor tick fetches the head (IO outside the actor; waits up to `COVER_WAIT = 300` s for a head signed after the receipt) and keeps it as a `receipt` row; every `CHECK_EVERY = 900` s it fetches the head plus a signed prefix at the receipt head's row count and keeps a `check` row. Rows are verified against the release pin before keeping, append-only (triggers), audited as `house.head_kept` / `house.head_checked` (Rewind: bookkeeping). `DealEvidence.house_record` (`HouseRecord {state: kept|holds|longer|restarted|shorter|rewritten, kept_at, entries, checked_at}`) is evidence only: no state change, no money effect. `RelayApi::house_head` / `house_prefix` are GETs bounded to 4 KiB.
- **Verifier** (`table-verify/src/house.rs`): pure `verify_house(view, heads, pin)` with 8 checks (house_pin, house_head, house_heads, house_floor, house_capture, house_authority, house_quiet, house_private) and `heads_consistent`; CLI `table-verify --house <ledger.json> [--head <head.json>]... [--pin <release.json>]` (files only, never the network).
- **Client:** a "House seller's record" card on the deal's proof tab and a row in the PayPal records sheet; warning states put a chip on the "Proof from PayPal" tab ("The house's record got shorter since your receipt. No money moved. Keep your signed proof…"). `houseRecordWord()`; mock parity `house_record: null` and a fixture option `house`.
- **Tests:** table-runtime `glass_tests` (`house_projection_carries_no_free_text_payee_paypal_id_or_full_guest_key`, `house_verifier_catches_capture_without_authorize_price_below_floor_and_quiet_breach`, `house_head_verifies_tamper_fails_prefix_proves_extension_and_a_new_disk_is_a_new_epoch`, `house_read_routes_move_no_money_write_nothing_and_page_the_ledger`, `buyer_keeps_the_house_head_with_the_receipt_and_flags_a_shrinking_record_without_moving_money`); table-proto `heads_compare_by_epoch_length_and_prefix`, `head_signature_is_domain_separated_and_tamper_evident`; table-ledger `house_heads_are_verified_on_keep_audited_and_append_only`, `house_record_takes_the_most_telling_later_head`; history classification rows; client `lib/houseRecord.test.tsx`.
- **Deviations:** the prefix route is an addition (proves a longer head extends the kept one); refusal counts reset on HOUSE restart ("since <date>"); scoreboard head consistency covers only this browser's earlier looks; browser signature checks use WebCrypto `verify` (not `verify_strict`; the CLI is strict); no receipted HOUSE deal in the mock fixtures.
- **UNVERIFIED:** WebCrypto Ed25519 support in judges' browsers (verified in Chromium 1194 only; others show "can't check here"); Render behaviour for the 503 window before the first publish after a cold start.
- **Left:** optionally include the stored head in the T1 proof bundle; a projection test for a band-declined inbound offer; UAT on the deployed HOUSE once deploy is authorized.

### Subscription rescue: one fix, DISCOUNT_THIS_CYCLE, end to end (406872e..24fca28; DECISIONS §13)

The seven pieces of the submission cut:
1. **Replay and detection.** `rescue_replay` (approval window, privileged: token + label + unlocked) records a failed renewal labelled REPLAY (subscription id, subscriber email, plan, cycle price) under the newest active rules carrying the fixes clause; without one it refuses ("Sign rules for fixing failed renewals first.") and writes nothing. The deal opens at AGREED and the window is rebound to it. `Pipeline::rescue_detect` opens a PayPal-reported (counted) rescue from a subscription read, built and tested offline but **not yet called** by any command or scheduler pass.
2. **Fixes clause (clause 8):** `Clause::Lever { levers: [DISCOUNT_THIS_CYCLE], max_discount_bp, max_discount }` with `CpRule::Subscribers` (rescue only, never a paired wallet); `validate()` requires the rescue role, the subscribers rule and the fixes clause together, in rules of their own. The approval editor shows "Most off one missed renewal" (amount slider + percent box) only once the rescue role is allowed; `mandate_simulate` reads it.
3. **Durable approve.** `rescue_approve` (token + label + unlocked + T5 `checks_hash`) creates the invoice for this cycle's discounted amount, then sends it, each step a reserved money operation with one request id (`invoice-create` / `invoice-send`; `operations` rebuilt in migration **0011_rescue.sql**, `user_version` 11, to admit them). A lost create is found by the deal's deterministic invoice number (`rescue_invoice_number(deal, 1)`) and never created twice (not found → parks and lapses); a lost send is read back and re-sent only under its own request id after a fresh owner decision. Authority recorded in `decided_by` and the audit log; no agent tool; the scheduler only reads back and applies deadlines (never starts a create or a send). Silence: an unapproved fix lapses (PayPal retries by itself), an unsent draft expires, a sent invoice expires unpaid; nothing is collected by default.
4. **Recovered money** counts only when the deal is sandbox and RECEIPTED/RECONCILED with `paypal_verified` receipt evidence, the rescue case's source is `paypal`, there is a verified receipt for the invoice id and `invoice-send` is confirmed: one SQL predicate (`table-ledger` rescue `COUNTED`) shared by `rescue_recovered`, `RescueView.counted` and the Book's `recovered_sum`. A REPLAY failure or a merely sent invoice never counts.
5. **Fixed invoice wording:** `table-core` `invoice_text`, filled only with the offer's numbers, shown via `ApprovalSummary.rescue` and `rescue_book`; `modules/rescue/preview.ts`'s illustrative wording replaced for the discount.
6. **Spike 8** (`table-paypal::spike_8_invoice_create_send_paid`, `#[ignore]`, gated on `TABLE_LIVE_SANDBOX`) uses the rescue shape and records `invoice_searched` / `found_by_number`; SPIKES.md §8 marks it as asked of the owner. **Not run.**
7. **Offline native tests** (below).
- **Client:** the Rescue page reads `rescue_book` (the Discount card shows the wallet's offer, e.g. "20% off: $9.60 instead of $12.00", and the real invoice line; Pause, Retry and Downgrade read "Not available yet"; Recovered from `RescueBook.recovered` with reasons a rescue does not count; "Replay a renewal ↗" opens the approval window on target `rescue`). Approval window: the `rescue` gate on AGREED (or SETTLING when `can_release`), one gold "Hold to approve the discount · $X", diff rows (fix vs rule, invoice vs signed amount, recipient, rules line, source), strip Checking → Ready → Invoice sent → Subscriber paid, `owner/RescueReplay.tsx` (pure `owner/replay.ts`). Rescue states: AGREED "Renewal failed", SETTLING "Sending invoice", FAILED terminal "Fix failed" (invoice cancelled).
- **Mock parity:** `rescue_replay` (approval), `rescue_book` (main, approval), a real `rescue_approve`; `approval_summary.rescue`; `recovered_sum` uses counted rescues only; `mock/checks.ts` composes the rescue lines like Rust `compose_rescue`; `mock/rescue.ts` mirrors `propose_discount`, `invoice_text`, `Recipient`, `valid_subscription_id`. Fixtures D-0188 (AGREED replay $12.00 → $9.60), D-0182 (invoice sent), D-0178 (counted RECEIPTED $9.00). STORE_KEY v10.
- **Tests:** table-core 5 (incl. `proposed_offers_always_check_back_property_style`, `discount_property_style_never_increases_amount`, `the_invoice_text_is_fixed_and_filled_only_with_the_offer_numbers`); table-ledger 3 (incl. `only_a_paid_receipted_invoice_on_a_paypal_reported_failure_counts_as_recovered`, `migration_0011_keeps_every_operation_and_its_check_and_admits_the_invoice_steps`); table-app `tests/rescue.rs` 8 (incl. `every_refusal_comes_before_any_paypal_call`, `a_lost_create_is_found_by_its_number_and_never_made_twice`, `a_replayed_failure_is_invoiced_on_the_owners_decision_but_never_counts`, `silence_lets_a_fix_lapse_and_an_unpaid_invoice_expire_and_nothing_is_collected`); table-runtime 2; table-paypal invoice wire tests; client rescue model/preview rewritten, `approval/owner/replay.test.ts`, foundation tests.
- **Deviations:** a rescue deal waits at AGREED (was FAILED); FAILED now means the invoice was cancelled; the REPLAY invoice is real but never counted; `rescue_replay` in the shell also sets `DesktopState.selected`.
- **UNVERIFIED** (marked in code; add to spike 8): `detail.invoice_number`, its length cap and `detail.note` on Invoicing v2 create; the `search-invoices` body field `invoice_number` and response `items`; that `billing_info.outstanding_balance` after one failed payment equals that cycle's price (`rescue_detect`).
- **Left:** wire `rescue_detect` to a command or scheduler pass (and decide where the subscriber email comes from); run spike 8 (owner); Pause, Retry after fix, Downgrade; the Book page's local `isRecovered` estimate could read `rescue_book`.

### T15 MarketWatch: keep prices fresh under a signed rule (5221f8f..97da5a2; market-data-1)

- **Rule:** `Clause::MarketWatch { items: [WatchedItem { item_ref, product_id }], max_refreshes_day }`, **clause 9** (after the rescue lever 8). Validated at signing: 1 to `MAX_WATCHED_ITEMS` = 20 items, no item twice; allowance 1 to `MAX_MARKET_CHECKS_DAY` = 200 a day; product id passes `market_product_valid` (shared with `table-market`). Optional, at most one per mandate. `check()` never reads it, so it grants no money authority; `mandate_simulate` answers are unchanged with or without it.
- **Freshness (table-core):** `MARKET_FRESH_SECS` (900) and `market_fresh` replace the pipeline's inline check; `MARKET_REFRESH_LEAD_SECS` (60) and `market_refresh_due` mark a reference due when absent, from the future, or within 60 s of going stale; the market cache serves an entry only while not due. `market_watch_step` / `market_watch_open`: a seller deal is watched only up to Agreed (the forecast's seller-mandate window assumes no new reference after that), a buyer deal while pre-capture; terminal, captured and replay deals never.
- **Ledger:** `reserve_market_check` writes one `market.checked` audit row (actor `market`; mandate id, version, hash, item, product, UTC day, count, allowance) in an IMMEDIATE transaction before the fetch; over the allowance it writes nothing (`Conflict`). `market_checks_today` counts per mandate per UTC day across all versions, so re-signing does not reset the day, even across a crash. No migration.
- **Runtime scheduler:** `start_market_watch` after each tick plans checks only with a market client and key, agents not paused, not lapsed, no open PayPal operation, mandate active and still passing `select_signer`/`check_mandate`, reference due, allowance left, one check per deal at a time. The fetch runs on a spawned task through `MarketApi` and returns as `Message::MarketWatched`; `market_watched` stores the reference (`market.observed`, as an owner refresh) only if deal, terms hash, mandate version, currency and product still match and the rules still hold. A failed or mismatched answer waits 120 s (each try counts). A check makes no PayPal call. Rewind: `market.checked` is bookkeeping (source scan includes `table-ledger/src/market_watch.rs`).
- **Forecast:** kept conservative; a planned or in-flight check is never counted as fresh. `forecast_never_moves_money_out_over_every_input` unedited and green.
- **Contract:** `OwnerFacts.market_watch: Vec<MarketWatchFact { mandate_id, mandate_version, agent, items, max_per_day, used_today, used_up }>`; bindings `WatchedItem`, `MarketWatchFact`, `Clause` regenerated. No new command.
- **Client:** `lib/marketWatch.ts`; words "Keep prices fresh", "up to N checks a day", "Price checks today: 3 of 12", "Kept fresh by your rules"; approval editor rule popover (items + products + checks-a-day stepper) with diff and validation parity; Setup → Market prices shows each rule's checks today and watched items; deal Proof → Typical price says "Kept fresh by your rules." or that today's checks are used up. Mock parity (M-14 watches two monitors at 3 of 12; S-2 watches monitor-arm at 6 of 6, used up). Mock store v11.
- **Tests:** table-core `a_market_watch_rule_is_validated_at_signing`, `a_market_watch_rule_grants_no_money_authority_and_changes_no_answer`, `market_watch::tests` (4); table-ledger `price_checks_are_audited_first_counted_per_mandate_and_utc_day_and_never_exceed_the_allowance`; table-market `a_cached_band_within_the_refresh_lead_is_fetched_again`; table-runtime `market_watch_tests` (7, incl. `a_watched_seller_deal_no_longer_stalls_its_policy_countersign_runs_on_a_fresh_price` with zero PayPal requests from the check, `a_watched_price_far_over_the_market_holds_and_nothing_is_created`, `the_daily_allowance_is_never_exceeded_and_owner_facts_say_when_it_is_used_up`); client `lib/marketWatch.test.ts` (7). Workspace at merge: 420 passed / 0 failed / 9 ignored; client 615.
- **UNVERIFIED:** `MAX_MARKET_CHECKS_DAY` = 200 and `MAX_WATCHED_ITEMS` = 20 are wallet guards, not service limits; the per-call credit cost of the market service is not sourced (the hackathon key has 20,000 credits [S]).
- **Left:** the mock never makes checks (fixed counts); no live test of the refresh loop with a real market key.
