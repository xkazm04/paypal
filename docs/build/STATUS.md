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

- Shield: fixtures/§10.5 make "new counterparty > $100" a HOLD; the §7 rule table says ASK.
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
  answers UNAVAILABLE; the deal view has an Export proof button.
- Proof: the two-wallet settlement test exports both sides, requires all nine checks, and forges five
  bundles (PayPal amount, capture authority, transcript byte, audit row, payee) that each fail.
- What the verifier cannot prove from the file: an owner decision (`DecidedBy::Human`) is the wallet's
  record, not an owner signature (owner ACCEPT proofs are signatures and are checked); the HOUSE release
  pin is not in the bundle; truncation of the wallet's own audit tail needs an external head (T9).
- Since Wave 0 commits inbound NOTE envelopes to the transcript, a bundle can carry counterparty
  Note text inside a signed JWS. It is never printed or parsed by the verifier; share bundles knowing that.
- Not yet run: the native save dialog (compile/clippy only, no GUI harness). The verifier logic mirrors
  the ledger's transcript/audit checks rather than sharing code; the export-then-verify test guards
  that parity.

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

## Policy authority above clause 6 (2026-10-07)

- `crates/table-app/tests/pipeline.rs::policy_authority_is_refused_above_clause_6_before_any_paypal_call`: with a signed mandate whose clause 6 threshold (10.00) is below the deal (12.00), `Authority::Policy` is refused at create, authorize and capture with zero new mock PayPal calls and `paypal_calls` rows, and no countersign row at create; the same deal then reaches `Receipted` with `Authority::Owner(OwnerTicket)`, countersign present before capture. For authorize and capture the countersign row already exists from the owner's create, so those steps assert it is unchanged. No defect found; the gate held.

## Spend firewall / agent-gated-spend: a cleared purchase waits for the owner (2026-10-07)

- An agent's purchase that passes the mandate check waits at Agreed. Creating the PayPal order, authorizing it and capturing it each need the owner's decision in the approval window; the clause-6 policy countersign does not apply to purchases (`Authority::Policy` is refused for every purchase deal, before any countersign row, reservation or network call). A cleared purchase counts in the daily budget from the moment it clears until it is withdrawn or expires. This closes agent-gated-spend MA-1.
- Mechanism: `DealEvent::PurchaseCleared` (Pairing to Agreed), applied by `propose_purchase` (buyer purchases only) in its own transaction with the `deal.transition` audit row; the scheduler no longer creates orders for purchases. The text of the Shopper slot in `configuration.rs` now says money moves only when the owner decides.
- A purchase under a mandate with no Band gets a 24 h decision window (`PURCHASE_DECISION_WINDOW_SECS`, DECISIONS section 8): at the deadline it lapses to WITHDRAWN with `SafeDefault` and no PayPal call (test `a_purchase_without_a_band_lapses_after_a_day_and_a_band_deadline_still_wins`). A proposal writes one `purchase.proposed` audit row (test `one_purchase_proposal_writes_exactly_one_audit_row_and_the_chain_verifies`). The mock Shopper copy in `backend.ts` now matches `configuration.rs`.
