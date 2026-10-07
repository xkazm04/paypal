# Moonshot backlog - The Table

Generated 2026-10-05 by `/scan-sweep` (ideas-only) with the ad-hoc lens **moonshot-architect**, run on all 20 contexts with 2 cards per context. **No code was changed.**
This is a menu of bold directions to choose from, not a plan. Fill in the **Decision** columns: `go`, `slice` (first slice only), `later` or `no`.
Full cards (Summary / Description / Flow / Expected impact / Evaluation + `file:line` evidence) are in [moonshot-cards.md](moonshot-cards.md).

| | |
|---|---|
| Context map | [`context-map.json`](../../context-map.json): 7 groups, 20 contexts, 349 tracked files (design docs, research and prototypes are left unmapped as reference) |
| Scouts | 8 read-only group scouts, ~1.56M subagent tokens in total |
| Output | **40 cards** (L/XL only), folded into **19 themes**; **48 incidental defects** for the stabilize loop |
| Deadline | Submissions close 2026-11-12 14:00 PT (~5.5 weeks). Each theme lists its first demo-able slice. |
| Ranking | Impact, weighted by how many scouts converged on the theme (corr), plus how many other cards wait on it. Corroboration is the strongest signal these runs produce, but a shared *pattern* is not a shared *build*, so each theme says whether one build would close all of its cards. |

## 0. Fix before any demo (not moonshots)

> **Swept 2026-10-06.** 1 fixed (`b44012c`). 2 partly fixed: `DELETE` removed and each mailbox now wakes only its own long-polls (`6d08d67`); unauthenticated mailbox creation is folded into card relay-and-rendezvous-1. 3 rejected on re-check (SETTLE carries no payee, and `Order::verify` already enforces the PayPal payee binding). 4 fixed (`01c5303`, `3fe352a`). 5 fixed (`e079d4b`). 6 README fixed (`0c98a1c`); turning on cargo-deny needs your licence decision. See `docs/build/STATUS.md` § "Incidental sweep (2026-10-06)".

These incidental defects came up while the scouts were reading the code. They are not part of the moonshot deck, but each one would break or embarrass the submission:

1. **HOUSE locks out every judge after 64 buyers.** House request reservations are written before validation and never released (`services/house-seller/src/hosted.rs:194-202`, `crates/table-ledger/src/house.rs:16-21`). On the persistent Render disk, HOUSE returns 429 forever once rehearsals, video takes and judges add up to 64, and `docs/build/DEPLOY.md` forbids replacing the ledger. Found independently by two scouts.
2. **Anyone can fill the relay.** `PUT` is unauthenticated and there is one global cap of 256 mailboxes (`services/rendezvous/src/lib.rs:75-80`). 256 anonymous creates block every new pairing, including HOUSE deliveries, for 24 h. `DELETE` needs no membership proof either (`:196-202`).
3. **The shield's BLOCK rule can never fire.** The pipeline passes the same payee as both expected and actual, and passes `friends_and_family:false` (`crates/table-app/src/pipeline.rs:350-352`).
4. **The approval checklist claims checks it never ran.** "amount = signed terms" is marked passed for every non-MISMATCH deal without comparing anything (`apps/desktop/client/src/windows/approval/model.ts:290`, `:321`).
5. **A lost keyring entry silently rotates the owner identity** instead of failing closed (`crates/table-runtime/src/vault.rs:98-106`, reachable from read paths).
6. **The README is stale.** It says only B0-B3 are built (`README.md:9`), which contradicts STATUS, and it is the first thing a judge reads. Also, CI never runs `cargo-deny` (`.github/workflows/ci.yml:45`).

The full list of incidental defects is in [§5](#5-incidental-defects-for-the-stabilize-loop).

## 1. Themes, ranked

| # | Theme | Cards | corr | Impact | First slice | Gates | One build? | Decision |
|---|---|---|---|---|---|---|---|---|
| 1 | **Offline proof bundle + `table-verify`** | [ledger-1](moonshot-cards.md#ledger-1), [runtime-core-2](moonshot-cards.md#runtime-core-2), [main-window-1](moonshot-cards.md#main-window-1), [ops-and-delivery-1](moonshot-cards.md#ops-and-delivery-1), [core-domain-1](moonshot-cards.md#core-domain-1) | 5 | 9 | ~6 d | contract, policy-tighten | yes - one export bundle + one verifier binary; core-domain-1 adds clause witnesses on top || go - bundle + `table-verify` CLI |
| 2 | **Deterministic negotiator (haggle without an LLM)** | [runtime-core-1](moonshot-cards.md#runtime-core-1), [ops-and-delivery-2](moonshot-cards.md#ops-and-delivery-2) | 3 | 9 | ~5-6 d | direction | yes for the negotiator; ops-and-delivery-2 also carries the installer + HOUSE canary || go - policy engine via MCP |
| 3 | **Real engine session (attested, multi-turn)** | [engine-adapters-1](moonshot-cards.md#engine-adapters-1), [agent-tool-surface-1](moonshot-cards.md#agent-tool-surface-1), [agent-tool-surface-2](moonshot-cards.md#agent-tool-surface-2) | 1 | 10 | ~7-9 d | architecture, contract, policy-tighten | no - engine-adapters-1 is the prerequisite; the other two are built on it (each has a first slice that works without it) || go - canary-first attested session (spike 2 first) |
| 4 | **Walk-away forecast + evidenced silence** | [tumbler-window-1](moonshot-cards.md#tumbler-window-1), [attention-ladder-2](moonshot-cards.md#attention-ladder-2), [attention-ladder-1](moonshot-cards.md#attention-ladder-1) | 2 | 9 | ~3-4 d | contract, none, architecture | yes for the forecast (tumbler-window-1 = attention-ladder-2); attention-ladder-1 is the audit half || go - forecast in the Tumbler |
| 5 | **Owner sees Rust-composed truth at the decision** | [approval-window-1](moonshot-cards.md#approval-window-1), [native-shell-1](moonshot-cards.md#native-shell-1) | 2 | 9 | ~4 d | policy-tighten | close - both bind the decision to a hash of the text Rust composed; one is the checklist, the other the OS Hello prompt || go - Rust-attested checklist |
| 6 | **Explainable authority (why / who decided)** | [money-pipeline-2](moonshot-cards.md#money-pipeline-2), [main-window-2](moonshot-cards.md#main-window-2) | 2 | 8 | ~4 d | contract | yes - the typed DecisionTrace feeds the Rewind timeline || go - Rewind timeline on the Dial |
| 7 | **Judge path without install (record / replay)** | [ipc-contract-2](moonshot-cards.md#ipc-contract-2), [client-foundation-2](moonshot-cards.md#client-foundation-2), [engine-adapters-2](moonshot-cards.md#engine-adapters-2) | 3 | 8 | ~4-7 d | direction, contract | no - three different tapes (IPC stream, scripted mock director, engine run); pick one || go - scripted "Maya's week" director |
| 8 | **Multi-seller RFQ (first signed ACCEPT wins)** | [pairing-and-relay-runtime-1](moonshot-cards.md#pairing-and-relay-runtime-1), [relay-and-rendezvous-2](moonshot-cards.md#relay-and-rendezvous-2) | 2 | 8 | ~4-7 d | contract, policy-tighten | yes - group id + Rust group guard allowing one ACCEPT + sibling WITHDRAW || go - two-table group slice |
| 9 | **External witness / anchored audit head** | [house-seller-1](moonshot-cards.md#house-seller-1), [pairing-and-relay-runtime-2](moonshot-cards.md#pairing-and-relay-runtime-2) | 2 | 9 | ~5 d | direction, architecture | no - two witnesses (public HOUSE ledger, relay countersign); both close STATUS's deferred external anchoring || go - glass-box HOUSE |
| 10 | **PayPal ground truth** | [money-pipeline-1](moonshot-cards.md#money-pipeline-1), [paypal-gateway-1](moonshot-cards.md#paypal-gateway-1), [paypal-gateway-2](moonshot-cards.md#paypal-gateway-2) | 1 | 8 | ~5 d each | architecture, contract, none | no - read-back resolver, events feed, hostile-PayPal double; the resolver is the core || go - read-back resolver |
| 11 | **Single-source authority manifest + conformance** | [ipc-contract-1](moonshot-cards.md#ipc-contract-1), [client-foundation-1](moonshot-cards.md#client-foundation-1) | 2 | 8 | ~6 d | contract | no - ipc-contract-1 generates the tables client-foundation-1 then tests against both backends || go - one authority table, generate the rest |
| 12 | **Mandate what-if before signing** | [approval-window-2](moonshot-cards.md#approval-window-2) | 1 | 8 | ~3 d | contract | n/a || go - replay last week's intents |
| 13 | **Selective mandate disclosure** | [protocol-1](moonshot-cards.md#protocol-1) | 2 | 8 | ~8 d | contract | shares the clause-tree commitment with core-domain-1 (T1) - build once || go - per-clause commitment + "Prove my band" |
| 14 | **Wallet-wide exposure envelope** | [core-domain-2](moonshot-cards.md#core-domain-2) | 1 | 8 | ~5 d | policy-tighten | n/a || go - signed wallet envelope |
| 15 | **Verifiable market evidence** | [market-data-1](moonshot-cards.md#market-data-1), [market-data-2](moonshot-cards.md#market-data-2) | 1 | 8 | ~4-5 d | contract | no - auto-refresh under a mandate clause vs a fair-price certificate || go - mandate-scheduled refresh |
| 16 | **Deal state as a verified projection of the audit log** | [ledger-2](moonshot-cards.md#ledger-2) | 1 | 7 | ~5 d | architecture | n/a || go - audit deltas + drift check |
| 17 | **Open protocol spec + second verifier** | [protocol-2](moonshot-cards.md#protocol-2) | 1 | 7 | ~6 d | direction | n/a || go - spec + vectors + TS verifier |
| 18 | **Beyond the desktop (directions)** | [native-shell-2](moonshot-cards.md#native-shell-2), [house-seller-2](moonshot-cards.md#house-seller-2), [tumbler-window-2](moonshot-cards.md#tumbler-window-2) | 3 | 9 | ~3-9 d first slices | direction, architecture | no - three different product bets: OS payment sheet for any local agent, merchant-hosted storefront, phone companion that can only say no || go - OS payment sheet (native-shell-2) only |
| 19 | **End-to-end encrypted relay** | [relay-and-rendezvous-1](moonshot-cards.md#relay-and-rendezvous-1) | 1 | 6 | ~7 d | contract | n/a || go - sealed envelopes + pairing-bound capabilities |

### Why each theme ranks where it does

1. **Offline proof bundle + `table-verify`** - Five of eight scouts, from five layers, independently asked for the same thing: an exported deal bundle a judge can verify offline that proves every PayPal call had a lawful authority. `verify_audit`/`verify_transcript` already exist and are only called from tests. Best fit for "provable, not just trusted".
2. **Deterministic negotiator (haggle without an LLM)** - Today nothing shipped can actually bargain: native engines are gated on spikes 1/2 and the scripted engine only calls `table_view`. This removes the demo's single point of failure and is a prerequisite for the multi-seller RFQ and the judge kit. The engines scout raised the same gap in its notes.
3. **Real engine session (attested, multi-turn)** - Impact 10: it makes the headline "two owners' agents haggle" moment possible. Four other cards list it in `depends_on`. It also carries the most risk: it depends on UNVERIFIED engine behaviour (spike 2).
4. **Walk-away forecast + evidenced silence** - The cheapest high-impact item: "if you do nothing, here is what moves and on whose authority, and it ends in no money moved". It makes the "silence never moves money" invariant visible, needs no PayPal, and is a 20-second video beat.
5. **Owner sees Rust-composed truth at the decision** - Today the READY checklist is assembled in TypeScript, and its "amount = signed terms" line passes without comparing anything. Moving the check, and the amount shown on the Windows Hello prompt, into Rust closes a real trust gap and is a strong video shot.
6. **Explainable authority (why / who decided)** - There are 20 bare `Error::Permission` exits, and refused create/authorize/capture calls leave no audit row. The trace makes refusals legible, and the timeline colours every money call by its authority. Pairs naturally with T1.
7. **Judge path without install (record / replay)** - Three scouts saw that judges may not have Windows, either engine CLI, or patience for an install. Each card offers a browser-only way to watch the real windows run. The pattern is corroborated; the build is a choice.
8. **Multi-seller RFQ (first signed ACCEPT wins)** - A new agent-commerce scenario the spine almost supports already. Needs T2 to look autonomous on video. Also fixes route leakage against the 64-route lifetime cap.
9. **External witness / anchored audit head** - Closes the known gap that a truncated audit tail cannot be detected. The glass-box HOUSE scoreboard is the most judge-facing of the two.
10. **PayPal ground truth** - Exactly-once money under lost responses is the most serious latent money bug class found (an `unknown` capture can lead to a void PayPal rejects). The hostile-PayPal matrix is demo-able with no live PayPal.
11. **Single-source authority manifest + conformance** - Command authority is hand-maintained in 9 places. Generating them from one table closes the owed W3 native IPC test, and its hash can go into every receipt. Prerequisite for T7 (IPC replay) and the OS payment sheet.
12. **Mandate what-if before signing** - Low risk (3), reuses the pure `MandatePayload::check`, and gives the owner a real reason to trust the mandate they sign.
13. **Selective mandate disclosure** - Prove "my band was respected" without revealing the other limits. Strong cryptographic story; the clause tree should be built once, here or in T1.
14. **Wallet-wide exposure envelope** - Several agents with several mandates have no wallet-wide cap; the spend meter is hard-coded to 0. Tightens policy (policy-tighten), so it routes cleanly.
15. **Verifiable market evidence** - market-data-1 is what lets below-threshold policy countersign actually run with no owner present (today the evidence goes stale after 900 s). market-data-2 puts a re-verifiable price certificate on every receipt.
16. **Deal state as a verified projection of the audit log** - Money decisions read a mutable `deals` row of which only `terms_hash` is integrity-checked. Architecture-gated. Also fixes the O(n) re-verify on every append.
17. **Open protocol spec + second verifier** - Positions The Table as a protocol rather than an app. Direction call.
18. **Beyond the desktop (directions)** - Big product directions, each an XL with a first slice. native-shell-2 (connect any local agent to the Tumbler) answers the "consumer-side gap" from the landscape research and is the boldest single card.
19. **End-to-end encrypted relay** - The relay operator can read every price, order id and payee today. Prerequisite for the phone companion (T18).

## 1a. Decisions (owner, 2026-10-06)

Taken one theme at a time from three approaches each. Every theme was approved for its first slice; nothing is built yet.
The scope chosen per theme:

| # | Theme | Chosen approach | Not chosen now | ~Days | Lands after |
|---|---|---|---|---|---|
| 1 | Offline proof bundle **(built and merged 2026-10-06, 482187a)** | `Ledger::export_bundle` (mandate, JWS transcript, closed mandate, redacted calls + `binding_json`, audit segment, agent-signed evidence head), pure `table-verify` CLI, "Export proof" button | in-app drawer first; CI dossier | 6 | (T13 clause tree optional) |
| 2 | Deterministic negotiator | PolicyEngine adapter reusing HOUSE `Policy`, through the real MCP fence, re-armed on each inbound COUNTER, POLICY ENGINE badge | judge kit; replay-only | 5.5 | - |
| 3 | Real engine session | canary turn, attested + audited inventory, long-lived multi-turn claude-code process; codex-cli stays gated | agent-surface-first; spike-only | 8 | spike 2; owner confirms the rule is "no deal data before the inventory" |
| 4 | Walk-away forecast | pure `forecast()` on `AttentionSnapshot`, "If you walk away" in Tumbler + quit confirm, property test "never ends with money moving" | single ladder + silence log | 3.5 | - |
| 5 | Rust-composed truth | READY checks composed by the pipeline, `checks_hash` in `DecisionArgs`, Rust refuses a mismatched hash | per-decision Hello prompt | 3.5 | - |
| 6 | Explainable authority | `deal_history` projection + Rewind scrubber under the Dial, ticks coloured owner / signed rule / safe default | typed decision traces | 4 | - |
| 7 | No-install judge path | "Maya's week" director on the mock backend: injectable clock, beat file, three windows framed, static preview link | IPC tape; engine flight recorder | 3.5 | - |
| 8 | Multi-seller RFQ | group id, one velocity reservation per group, at-most-one-ACCEPT guard, automatic signed WITHDRAW; HOUSE + one desktop peer | WANT broadcast; guard only | 6 | T2 |
| 9 | External witness | HOUSE public read route + minutely signed head, buyer stores head with receipt, scoreboard page | relay countersign; peer-held head | 5 | (pairs with T1) |
| 10 | PayPal ground truth | read-back resolver for `unknown` operations (confirm / same-Request-Id re-send / park), "cut the wire" chaos toggle | hostile-PayPal matrix; events feed | 5 | - |
| 11 | Authority manifest | one declarative table generating COMMANDS, capabilities, build.rs list, dispatcher and mock gates; label x lock x token test; hash in settings/receipts | conformance tests only; client harness | 6 | - |
| 12 | Mandate what-if | `mandate_simulate(draft)` over last week's recorded intents, before/after verdicts above Sign | clause diff; synthetic probes | 3 | - |
| 13 | Selective disclosure (post-submission) | salted per-clause Merkle commitment in HELLO, "Prove my band" export, offline verify | whole-mandate commitment; fold into T1 | 8 | (shares clause tree with T1) |
| 14 | Exposure envelope | Exposure fold + owner-signed `WalletEnvelope` checked after the mandate, before any network call; real meters | meters only; wallet-scoped velocity | 5 | - |
| 15 | Market evidence | signed MarketWatch clause (item -> product id, refresh budget) + scheduler refresh outside the actor | fair-price certificate | 4.5 | - |
| 16 | Verified projection (post-submission) | full audit deltas for remaining `deals` mutations, `Ledger::replay`, fail-closed drift check on open and before money ops | time-scrubber; park | 4.5 | - |
| 17 | Open protocol (post-submission) | v1 spec, ~30 golden vectors, Rust runner, TypeScript verifier agreeing in CI | spec only; park | 6 | - |
| 18 | Beyond the desktop (post-submission) | native-shell-2 first slice only: `table-connect` stdio MCP bridge, named pipe, owner binds to an agent slot's mandate, "connected agent" chip | merchant House kit; phone companion | 8.5 | T11 |
| 19 | Encrypted relay (post-submission) | sealed envelopes (key from the pairing code), mailbox id = H(capability), create/send/delete need it; closes the relay flood | capabilities only; rate-limit | 7 | - |

**Total: ~102.5 focused days** against ~37 working days to 2026-11-12. Everything chosen cannot fit before submission; the operator's submission cut (below) fixes what lands before the video.

### Sequencing (owner, 2026-10-06): parallel builder sessions in waves

Three to five builder sessions run in parallel on disjoint write sets, merged wave by wave, with the full `scripts/check.ps1` gate after every merge and before the next wave starts. Shared append-only surfaces (ledger migrations, `COMMANDS`/bindings, `deny.toml`) are serialised: a builder appends at the end and never reformats.

| Wave | Builders (write set) | Why together |
|---|---|---|
| 1 | T2 negotiator (runtime/engines) · T1 proof bundle (ledger + new `table-verify` bin) · T4 forecast + T5 Rust checklist (attention, approval summary, client) · T10 read-back resolver (table-app pipeline, table-paypal) | T2 unblocks T8; T1 is the top-corroborated spine; T4/T5 are cheap, demo-critical and avoid PayPal |
| 2 | T6 Rewind (ledger projection + main window) · T7 director (client mock) · T12 what-if (core + approval window) · T11 authority manifest (table-client, shell, capabilities) | T11 lands before T18; T6/T7/T12 are client-heavy but touch different windows |
| 3 | T8 RFQ (runtime + ledger groups) · T9 glass-box HOUSE (house-seller) · T14 exposure envelope (core + pipeline) · T15 MarketWatch (market + scheduler) | T8 needs T2; T14/T15 both touch the pipeline check order, so they merge one after the other |
| 4 | T13 selective disclosure (proto + core) · T16 verified projection (ledger) · T17 protocol spec + TS verifier · T19 sealed relay (proto, rendezvous, relay, HOUSE) · T18 OS payment sheet (shell + new bridge) | protocol changes (T13, T19) go last and alone in their area; T18 needs T11 |
| any | T3 attested engine session (engine + runtime) | starts in whichever wave follows a passing spike 2 and the owner's confirmation of the "no deal data before the inventory" rule |

Videos (Nov 6-9) are recorded from whatever has merged by then. Waves 1-3 merge before the videos; wave 4 is post-submission (see the submission cut below).

**Submission cut (owner, 2026-10-07)**

- Waves 1-3 merge before the Nov 6-9 video. Two builders run continuously.
- Wave 2 (T6, T7, T11, T12) merges by Oct 28; wave 3 (T8, T9, T14, T15) by Nov 4.
- Verification is compressed into Nov 4-6.
- Wave 4 (T13, T16, T17, T18, T19) is post-submission.
- T3 is not scheduled by the cut; it stays gated as its `any` row says.
- Wave 3 also builds subscription rescue's one lever, DISCOUNT_THIS_CYCLE, end to end (owner, 2026-10-07). Its seven pieces:
  - a detection, or a labelled replay, that creates a rescue deal;
  - a lever clause in the mandate;
  - a durable approve step under a recorded authority that creates and sends the invoice and polls it to PAID;
  - money counted as recovered only from a verified, receipted capture;
  - the fixed invoice text;
  - one live sandbox invoice check (spike 8), asked of the owner first;
  - native tests.

## 2. A suggested path for the remaining 5.5 weeks

> Superseded by the owner's sequencing decision above (parallel waves); kept for the record.

This is the coordinator's reading, offered as a starting point for your decision. It is not decided.

- **Week 1 (by Oct 12):** the §0 fixes, then **T2 deterministic negotiator**. After that the haggle demo no longer depends on spikes 1/2.
- **Weeks 2-3 (by Oct 26):** **T1 proof bundle + `table-verify`** with **T6 decision traces** feeding it, plus **T4 walk-away forecast** (3-4 d). Together they make the safety model visible: what happened, who authorised it, and what happens if you walk away.
- **Week 4 (by Nov 2):** **T5 Rust-composed decision truth**, the strongest "the webview is only a viewer" shot. Start **T3 real engine session** only if spike 2 has passed by then; if it has not, ship on T2.
- **Week 5 (by Nov 9):** **one** of T7 (no-install judge path) or T8 (multi-seller RFQ) as the stretch item, then the video takes (Nov 6-9 in the design report's plan).
- **Parked as post-hackathon directions:** T16-T19. T18 `native-shell-2` is the one to revisit first.

## 3. Dependency edges

Prerequisites are lifted in the ranking: the most valuable item can be the unglamorous one that others wait on.

- `client-foundation-2` lands after: client conformance harness
- `tumbler-window-2` lands after: silence forecast by authority
- `ops-and-delivery-2` lands after: scripted bargaining engine (engines context); HOUSE release provisioning (house-seller context)
- `ipc-contract-2` lands after: single-source authority manifest
- `native-shell-2` lands after: single-source authority manifest; agent-tool-surface
- `core-domain-1` lands after: signed audit export anchoring
- `attention-ladder-1` lands after: verifiable mandate verdicts
- `attention-ladder-2` lands after: deadline escalation evidence
- `relay-and-rendezvous-2` lands after: merchant-hosted negotiable storefront
- `money-pipeline-1` lands after: verified PayPal event ingestion (optional accelerator, not required)
- `ledger-1` lands after: explainable authority decisions (traces enrich the bundle; not required)
- `ledger-2` lands after: verifiable deal receipts (shares the body_hash and audit-detail widening)
- `paypal-gateway-1` lands after: exactly-once money operations (consumes the feed to resolve unknown outcomes faster)
- `pairing-and-relay-runtime-1` lands after: deterministic negotiator engine
- `market-data-2` lands after: verifiable authority dossier
- `engine-adapters-2` lands after: attested engine session
- `agent-tool-surface-1` lands after: attested engine session
- `agent-tool-surface-2` lands after: attested engine session

## 4. All cards

i/e/r = impact / effort / risk, each 1-10. Gate is the scan-sweep escalation: `direction` / `architecture` / `policy-loosen` / `irreversible` need your call; `contract` / `policy-tighten` / `none` are verifiable by tests.

| Card | Title | Theme | Context | Size | i/e/r | Gate | Kind | Decision |
|---|---|---|---|---|---|---|---|---|
| [ledger-1](moonshot-cards.md#ledger-1) | Export a self-verifying deal proof bundle with an offline verifier anyone can run | T1 | ledger | XL | 9/8/4 | contract | trust |  |
| [runtime-core-2](moonshot-cards.md#runtime-core-2) | Export a signed authority dossier a judge can verify offline, call by call | T1 | runtime-core | XL | 8/7/5 | contract | trust |  |
| [main-window-1](moonshot-cards.md#main-window-1) | Give every deal a Proof drawer: verify offline, match fingerprints, export the bundle | T1 | main-window | L | 8/6/4 | contract | trust |  |
| [ops-and-delivery-1](moonshot-cards.md#ops-and-delivery-1) | Turn CI into a public safety dossier: hostile-agent gauntlet plus verifiable ledger | T1 | ops-and-delivery | XL | 8/7/3 | policy-tighten | trust |  |
| [core-domain-1](moonshot-cards.md#core-domain-1) | Make every mandate verdict provable: traced check, clause tree, offline verifier | T1 | core-domain | XL | 9/8/5 | contract | trust |  |
| [runtime-core-1](moonshot-cards.md#runtime-core-1) | Ship a deterministic policy negotiator that bargains through the real MCP fence | T2 | runtime-core | L | 9/5/4 | direction | demo |  |
| [ops-and-delivery-2](moonshot-cards.md#ops-and-delivery-2) | Ship the judge kit: release installer, scripted negotiator, live HOUSE canary to Dec 15 | T2 | ops-and-delivery | XL | 9/8/6 | direction | demo |  |
| [engine-adapters-1](moonshot-cards.md#engine-adapters-1) | Unlock native engines with a canary-first attested multi-turn session | T3 | engine-adapters | XL | 10/7/7 | architecture | architecture |  |
| [agent-tool-surface-1](moonshot-cards.md#agent-tool-surface-1) | Give the agent a real table: build the §6.4 projection, coded refusals, role playbooks | T3 | agent-tool-surface | L | 9/6/4 | contract | product |  |
| [agent-tool-surface-2](moonshot-cards.md#agent-tool-surface-2) | Light up the quarantine shield: live scam-typology verdicts with quoted evidence | T3 | agent-tool-surface | L | 8/6/5 | policy-tighten | trust |  |
| [tumbler-window-1](moonshot-cards.md#tumbler-window-1) | Show the walk-away forecast: what moves, and on whose authority, if Maya does nothing | T4 | tumbler-window | L | 9/5/4 | contract | trust |  |
| [attention-ladder-2](moonshot-cards.md#attention-ladder-2) | Show a walk-away forecast of every rung and default, ending in 'no money moves' | T4 | attention-ladder | L | 8/5/3 | none | product |  |
| [attention-ladder-1](moonshot-cards.md#attention-ladder-1) | Turn the attention ladder into hash-chained evidence of informed silence | T4 | attention-ladder | L | 8/6/4 | architecture | trust |  |
| [approval-window-1](moonshot-cards.md#approval-window-1) | Make the READY checklist Rust-attested and bind each decision to what the owner saw | T5 | approval-window | L | 9/6/4 | policy-tighten | trust |  |
| [native-shell-1](moonshot-cards.md#native-shell-1) | Seal each money-out decision with a Rust-composed Windows Hello prompt | T5 | native-shell | L | 9/5/4 | policy-tighten | trust |  |
| [money-pipeline-2](moonshot-cards.md#money-pipeline-2) | Make every money gate explain itself: typed decision traces the owner can read | T6 | money-pipeline | L | 8/5/3 | contract | trust |  |
| [main-window-2](moonshot-cards.md#main-window-2) | Rewind the week on the Dial: scrub the audit chain, colour each money call by authority | T6 | main-window | L | 8/6/5 | contract | product |  |
| [ipc-contract-2](moonshot-cards.md#ipc-contract-2) | Record the typed IPC stream and replay all three windows in a browser for judges | T7 | ipc-contract | XL | 8/7/4 | direction | demo |  |
| [client-foundation-2](moonshot-cards.md#client-foundation-2) | Ship a scripted 'Maya's week' director that drives all three windows as a watch-only judge path | T7 | client-foundation | L | 7/5/4 | direction | demo |  |
| [engine-adapters-2](moonshot-cards.md#engine-adapters-2) | Ship an engine flight recorder: sealed run tapes for replay, regression and review | T7 | engine-adapters | L | 8/5/4 | contract | demo |  |
| [pairing-and-relay-runtime-1](moonshot-cards.md#pairing-and-relay-runtime-1) | Let one buyer intent shop around several paired sellers; first signed ACCEPT wins | T8 | pairing-and-relay-runtime | XL | 8/8/6 | contract | product |  |
| [relay-and-rendezvous-2](moonshot-cards.md#relay-and-rendezvous-2) | Turn the rendezvous into a multi-seller table: one signed WANT, N sellers race | T8 | relay-and-rendezvous | XL | 8/8/6 | policy-tighten | product |  |
| [house-seller-1](moonshot-cards.md#house-seller-1) | Glass-box house: publish a signed, verifiable ledger of every house deal | T9 | house-seller | L | 9/5/4 | direction | trust |  |
| [pairing-and-relay-runtime-2](moonshot-cards.md#pairing-and-relay-runtime-2) | Make the relay a pinned witness that countersigns envelope hashes into a log | T9 | pairing-and-relay-runtime | L | 7/6/5 | architecture | trust |  |
| [money-pipeline-1](moonshot-cards.md#money-pipeline-1) | Make every money operation exactly-once by resolving UNKNOWN outcomes from PayPal | T10 | money-pipeline | L | 8/6/5 | architecture | architecture |  |
| [paypal-gateway-1](moonshot-cards.md#paypal-gateway-1) | Build a verified PayPal truth feed from webhooks-events polling and read-backs | T10 | paypal-gateway | XL | 8/7/6 | contract | platform |  |
| [paypal-gateway-2](moonshot-cards.md#paypal-gateway-2) | Record sandbox cassettes once, then publish a hostile-PayPal conformance matrix | T10 | paypal-gateway | L | 7/5/3 | none | demo |  |
| [ipc-contract-1](moonshot-cards.md#ipc-contract-1) | Declare every command's authority once and publish it as a verifiable manifest | T11 | ipc-contract | L | 8/6/3 | contract | architecture |  |
| [client-foundation-1](moonshot-cards.md#client-foundation-1) | Run one acceptance suite against both the browser mock and the real Tauri shell | T11 | client-foundation | L | 7/6/4 | contract | platform |  |
| [approval-window-2](moonshot-cards.md#approval-window-2) | Simulate a mandate against last week's ledger before the owner signs it | T12 | approval-window | L | 8/5/3 | contract | product |  |
| [protocol-1](moonshot-cards.md#protocol-1) | Prove the band after the deal: HELLO commitments with selective clause reveal | T13 | protocol | L | 8/6/5 | contract | trust |  |
| [core-domain-2](moonshot-cards.md#core-domain-2) | Put a signed wallet-wide exposure envelope above every mandate | T14 | core-domain | L | 8/6/4 | policy-tighten | architecture |  |
| [market-data-1](moonshot-cards.md#market-data-1) | Let a signed mandate clause keep market evidence fresh so policy countersign runs | T15 | market-data | L | 8/5/5 | contract | platform |  |
| [market-data-2](moonshot-cards.md#market-data-2) | Turn the market band into a re-verifiable fair-price certificate on every receipt | T15 | market-data | L | 7/6/4 | contract | trust |  |
| [ledger-2](moonshot-cards.md#ledger-2) | Turn the mutable deals row into a verified projection of the audit log | T16 | ledger | XL | 7/8/6 | architecture | architecture |  |
| [protocol-2](moonshot-cards.md#protocol-2) | Publish Table Protocol v1 as an open spec with golden vectors and a 2nd verifier | T17 | protocol | L | 7/5/3 | direction | platform |  |
| [native-shell-2](moonshot-cards.md#native-shell-2) | Make the Tumbler the OS payment sheet for any local agent the owner connects | T18 | native-shell | XL | 9/8/6 | direction | product |  |
| [house-seller-2](moonshot-cards.md#house-seller-2) | Merchant House kit: any PayPal merchant deploys a negotiable storefront | T18 | house-seller | XL | 7/8/6 | architecture | platform |  |
| [tumbler-window-2](moonshot-cards.md#tumbler-window-2) | Carry the Tumbler off the desk: a paired phone companion that can only say no | T18 | tumbler-window | XL | 8/9/8 | architecture | platform |  |
| [relay-and-rendezvous-1](moonshot-cards.md#relay-and-rendezvous-1) | Seal the mailbox: end-to-end encrypt envelopes and bind mailbox ops to pairing | T19 | relay-and-rendezvous | L | 6/6/5 | contract | architecture |  |

No card needs `policy-loosen` or `irreversible`. Every card keeps or tightens the AGENTS.md invariants; each card's "Invariants" line says how.

## 5. Incidental defects (for the stabilize loop)

> **Swept 2026-10-06:** of 47 distinct items (48 rows; HOUSE capacity appears twice), 36 were fixed in 32 commits, 4 were rejected on re-check, 3 wait on an owner decision, and 4 were folded into cards. The per-item outcome is in `docs/build/STATUS.md` § "Incidental sweep (2026-10-06)".

Verified in the code by the scouts, but not fixed: this was an ideas-only run. They can be worked down with a plain `/scan-sweep --one <context>` round. Items 1-6 of §0 are drawn from this list.

| Context | Anchor | Defect |
|---|---|---|
| core-domain | `crates/table-core/src/mandate.rs:185` | validate() only checks currency between band floor and ceiling; it never cross-checks clauses 3/4/5/6, so an owner can sign a mandate whose clause-6 threshold currency differs from clause 3 and every check then refuses at mandate.rs:367 ('threshold currency mismatch') - a dead-on-arrival mandate signed without warning (S). |
| core-domain | `crates/table-core/src/mandate.rs:200` | validate() treats clause 4 (Band) as optional, but check() refuses every Haggle/ShopOrder intent without a band (mandate.rs:380-387); a mandate whose PerDeal.kind is Haggle or ShopOrder and has no band validates, signs and can never allow anything (S). |
| attention-ladder | `crates/table-attention/src/lib.rs:171` | A HOLD item offers Withdraw whenever state != Authorized, including MISMATCH (lib.rs:122) and shield holds on post-capture states; transition(Mismatch\|Captured.., Withdraw) is rejected (crates/table-core/src/deal.rs:184, enforced at crates/table-app/src/agent.rs:375), so the only action on a MISMATCH card always fails (M). |
| attention-ladder | `crates/table-runtime/src/dispatcher.rs:111` | Both AttentionSource::from_deal call sites (dispatcher.rs:82, 108-114) pass None for pairing_display_name and clause, so AttentionItem.counterparty and .clause are always null and Tumbler cards can never name the clause or counterparty that window-duality's GATE/HOLD/STOP table shows (M). |
| attention-ladder | `crates/table-attention/src/lib.rs:250` | AttentionLadder.notified is never pruned; the shell keeps one ladder for the process lifetime (apps/desktop/src-tauri/src/native/events.rs:75), so it grows by one entry per deal/deadline forever (S). |
| money-pipeline | `crates/table-app/src/pipeline.rs:857` | The public Pipeline::tick propagates the first per-deal auto_void error with `?`. An unknown void stays reserved, so the retry fails at reserve_operation (crates/table-ledger/src/repositories.rs:739) on every tick, and every deal sorted after it is starved. The native scheduler avoids this (STATUS.md:365), but the public API contradicts it and the tests use it. |
| money-pipeline | `crates/table-app/src/reconciliation.rs:18-24` | reconcile appends a hash-chained audit row with actor 'owner', but the method takes no OwnerTicket and the IPC command is a main-window read (STATUS.md:689). The audit claims owner authority for a non-privileged action. |
| ledger | `crates/table-ledger/src/audit.rs:75` | Every append re-verifies the whole audit chain (JCS plus SHA-256 over all rows), and finish_operation appends 2-3 rows per transaction (repositories.rs:789-800). Cost is O(n) per write and O(n^2) over the ledger's lifetime, inside IMMEDIATE transactions on the 1 s tick path. |
| ledger | `crates/table-ledger/src/repositories.rs:804-812` | set_deadline upserts the deadline that drives auto-void and expiry with no audit row, unlike every other money-relevant write. A moved deadline leaves no trace in the chain. |
| ledger | `crates/table-ledger/src/redaction.rs:10-33` | The redaction allowlist drops custom_id (the terms-hash binding), payee.merchant_id and links. Stored paypal_calls evidence therefore cannot re-prove the Order::verify bindings after the fact, although confirm_reporting (receipt.rs:165) does rely on stored bodies as proof. |
| paypal-gateway | `crates/table-paypal/src/client.rs:327` | get_authorization is implemented but has no production caller, and the app-level MockApi panics if it is called (crates/table-app/tests/pipeline.rs:141-146). The only authorization read-back primitive is unexercised at the pipeline level. |
| paypal-gateway | `crates/table-paypal/src/client.rs:253-255` | decoded() maps a 2xx response that fails to deserialise to Error::Unknown. A PayPal schema change on create, authorize or capture is then indistinguishable from transport loss and permanently parks the operation as 'unknown' (repositories.rs:774-786). |
| runtime-core | `crates/table-runtime/src/vault.rs:98-106` | signing_key mints and stores a fresh key when an entry is missing, including 'owner', and is reached from read paths (settings() -> owner() at crates/table-runtime/src/service.rs:137-139, 185-189); a lost keyring entry silently rotates the owner identity (first_run flips true, pinned peers mismatch) instead of failing closed as docs/build/STATUS.md:367-370 states. |
| runtime-core | `crates/table-runtime/src/service.rs:493-511` | create_deal inserts the deal and category before bind_paired_relay; if binding fails (e.g. the lifetime 64-route cap at crates/table-ledger/src/relay.rs:75-77) the command errors but leaves a PAIRING deal with no route and no deadline (set_deadline at service.rs:513-524 never runs), so no deadline default ever applies to it. |
| runtime-core | `crates/table-runtime/src/scheduler.rs:57` | An AGREED seller/purchase deal whose mandate was revoked fails select_signer on every 1-second tick; tick() returns the error and actor.rs:296 broadcasts a WalletEvent::Fault each second with no backoff (safe, because the deadline branch runs first, but noisy). |
| pairing-and-relay-runtime | `crates/table-runtime/src/relay.rs:110-115` | When select_signer fails (revoked or superseded mandate) the inbox message is skipped with continue and never finished, so a peer's WITHDRAW/SETTLE stays pending forever, is retried every tick and emits a Fault each second via crates/table-runtime/src/actor.rs:295. |
| pairing-and-relay-runtime | `crates/table-runtime/src/relay.rs:32-38` | relay_work (crates/table-ledger/src/relay.rs:97-100) returns routes for terminal deals too, so the actor keeps long-polling dead mailboxes (2 s each, 4 per round) forever, diluting live-deal latency, and those routes consume the never-released 64-route lifetime cap. |
| engine-adapters | `crates/table-engine/src/parser.rs:146-176` | codex item.started and item.completed both map to events, so each mcp_tool_call yields two ToolCall events and each agent_message two Text events. Harmless today because the runtime drops native events (engines.rs:295), but it corrupts any recorder, reel or tool-call counter. |
| engine-adapters | `crates/table-engine/src/parser.rs:3-14` | The parser's wallet-tool allowlist includes shop_search, shop_quote and shop_checkout, which the MCP server never serves (crates/table-mcp/src/lib.rs:187-197), and it is role-agnostic. An init inventory reporting mcp__wallet__shop_checkout, or a shopper run listing negotiator tools, passes attestation. The allowlist should derive from the same role-filtered catalog as tools(). |
| engine-adapters | `crates/table-engine/src/native.rs:139` | One hard-coded system prompt is written for every role and profile, including the toolless shield run that should get prompts/shield.md. LaunchOptions has no role, so the prompts/*.md files are dead. |
| agent-tool-surface | `crates/table-app/src/pipeline.rs:350-352` | The shield case passes the same payee as expected and actual and friends_and_family:false, so the payee-mismatch and friends-and-family BLOCK rule (crates/table-shield/src/lib.rs:15-17) can never fire in production. |
| agent-tool-surface | `crates/table-mcp/src/lib.rs:263-271` | MCP-layer refusals (session not enabled, tool not in role catalog such as 'capture', argument decode failure) return isError but write no audit row. Only refused offers are audited (crates/table-app/src/agent.rs:449-455), so an agent reaching for nonexistent money tools leaves no trace. |
| agent-tool-surface | `crates/table-mcp/src/lib.rs:204` | send_offer's advertised inputSchema declares delivery as an unconstrained {"type":"object"} while design §8 specifies an enum. The typed decode rejects bad shapes, but the agent gets no schema guidance and fails by trial. |
| market-data | `crates/table-runtime/src/market.rs:62-69` | store_market rechecks terms/mandate/currency but MarketBinding has no product id, so a band for any product id the owner types is stored as the deal's evidence and the stored MarketRef cannot say which product it priced. |
| market-data | `crates/table-market/src/lib.rs:199-209` | history() parses a per-point currency and returns a Vec<Money> without a same-currency check, so a mixed-currency history is returned as if comparable. |
| protocol | `crates/table-proto/src/envelope.rs:17` | S: ShortText rejects only Cc controls (char::is_control); Unicode format chars such as U+202E bidi override and U+200B zero-width pass into Note text and display_name, enabling visual spoofing once the quarantine box renders them. |
| protocol | `crates/table-proto/src/envelope.rs:449` | S: envelope exp upper bound reuses table_core::money::MAX_MINOR (a money limit) as a timestamp ceiling - unit coupling that silently changes if the money bound changes. |
| relay-and-rendezvous | `services/rendezvous/src/lib.rs:75-80` | M: unauthenticated PUT plus a global 256-mailbox cap - 256 anonymous creates return Full for every new mailbox for 24 h, including the co-hosted house's own delivery (services/house-seller/src/hosted.rs:373-376). |
| relay-and-rendezvous | `services/rendezvous/src/lib.rs:196-202` | S: DELETE /v1/mailbox/{hash} needs no proof of membership; anyone who learns a mailbox hash can force a generation reset and full replay for both parties. |
| relay-and-rendezvous | `services/rendezvous/src/lib.rs:115` | S: a single store-wide Notify (notify_waiters) wakes every long-poll on every mailbox for any send; up to 256 boxes re-query on each message (thundering herd). |
| house-seller | `services/house-seller/src/hosted.rs:194-202` | M: a house.request.* reservation is written before validation (mandate check at hosted.rs:241-259) and is never deleted (crates/table-ledger/src/house.rs:16-21, :119-121). On the persistent Render disk the house therefore has a lifetime cap of 64 distinct buyer requests, after which it returns 429 forever; 64 self-signed random buyer identities exhaust it. |
| house-seller | `services/house-seller/src/hosted.rs:209-221` | S: a paired counterparty row (words_confirmed_at = now) is inserted before the mandate check, so requests later refused at hosted.rs:241-259 still leave counterparty rows. |
| ipc-contract | `crates/table-client/tests/bindings.rs:41` | The drift test only checks that COMMANDS is a subset of CommandContract. A CommandContract field missing from COMMANDS (and therefore from the capability tests) passes without notice. |
| ipc-contract | `crates/table-client/src/lib.rs:30` | From<table_app::Error> maps Refused (mandate refusal), Domain and Protocol all to INVALID. The UI can only tell 'your mandate refused this' apart from malformed input by parsing the message string. |
| native-shell | `apps/desktop/src-tauri/tests/capabilities.rs:39` | The capability test checks that every command is listed in build.rs but never checks the generate_handler! list in apps/desktop/src-tauri/src/native.rs:121. A command that is declared and granted but not registered only fails at runtime. |
| native-shell | `apps/desktop/src-tauri/src/native.rs:399` | While the Tumbler is snapped to Main, every Moved event of the main window calls set_form, which calls persist_surface (apps/desktop/src-tauri/src/native/surface.rs:237 -> :91). That spawns one Action::Preferences ledger write per move event during a drag; it should debounce or persist once the move ends. |
| client-foundation | `apps/desktop/client/src/shared/honesty.tsx:38` | Quarantine (the U3 plain-text box for counterparty text) is exported but imported by no window; there is no rendering site for untrusted text at all. |
| client-foundation | `apps/desktop/client/src/mock/backend.ts:396` | mock mandate_revoke filters every version of the mandate out of state, erasing signed history instead of recording a revocation; the preview then shows deals bound to a mandate that no longer lists. |
| client-foundation | `apps/desktop/client/src/mock/backend.ts:404` | mock band_set versions state.mandates.at(-1) (whatever mandate was signed last) instead of the deal's mandate_id, and never rebinds the deal's mandate_version. |
| main-window | `apps/desktop/client/src/windows/main/Modules.tsx:200` | Spend's GateCard shows the last mandate in mandate_list, not the one governing purchases; with the fixtures (mock/fixtures.ts:223-226) it lists the haggle mandate (per deal haggle $340) instead of purchase $200. |
| main-window | `apps/desktop/client/src/windows/main/Modules.tsx:186` | 'Clause trace' button only calls nav.onDeal; no trace exists anywhere, so the label promises evidence the view does not show. |
| main-window | `apps/desktop/client/src/windows/main/Home.tsx:97` | keydown useEffect has no dependency array while Home re-renders every second via useNow (Home.tsx:142), so the window listener is torn down and re-added every second. |
| tumbler-window | `apps/desktop/client/src/windows/tumbler/Tumbler.tsx:424` | toggleDnd writes the whole TumblerPreferences from the last settings snapshot; persist_surface stores new form/position without emitting settings:changed (apps/desktop/src-tauri/src/native/surface.rs:74-96, crates/table-runtime/src/dispatcher.rs:401-410), and settings_write resets the anchor and calls set_form(args.form) (apps/desktop/src-tauri/src/native/routing.rs:135-146), so toggling Do-not-disturb from the stack can jump the puck back to its launch position and collapse to a stale form. |
| approval-window | `apps/desktop/client/src/windows/approval/model.ts:290` | the 'amount = signed terms' line is status ok for every non-MISMATCH deal without comparing any amount, so READY shows a check that was never performed. |
| approval-window | `apps/desktop/client/src/windows/approval/model.ts:321` | with no receipt evidence the evidence line becomes an ok 'delivery ...' entry, a fact rather than a check, yet it counts toward READY. |
| ops-and-delivery | `README.md:9` | README status is stale: it says B0-B3 are built and that the wallet, HTTP clients, engines and desktop shell are not implemented, which contradicts docs/build/STATUS.md:3-17 (P1-P5, client wired). This is the first thing a judge reads. |
| ops-and-delivery | `.github/workflows/ci.yml:45` | CI never runs cargo-deny, although AGENTS.md makes deny.toml the dependency-compatibility gate; licence and advisory drift goes unchecked (STATUS.md:552 confirms advisories were never run). |
| ops-and-delivery | `services/house-seller/src/hosted.rs:197` | The HOUSE capacity check counts every house.request.% reservation ever made (crates/table-ledger/src/house.rs:16-21) and none is ever released, so after 64 distinct buyers (rehearsals, video takes and judges included) HOUSE returns Full permanently for that ledger. DEPLOY.md:100-106 forbids replacing the ledger, which makes this a judging-period outage. |

## 6. Method and caveats

- `moonshot-architect` is **not** a registered lens in the scan-sweep lens catalog, so it was run as an ad-hoc lens. The coverage ledger records this run with `lens_keys: []` and does not count it as lens coverage for any context.
- The Personas bridge was not running, so the coordinator partitioned the context map by hand from `git ls-files` and the crate boundaries, not from the app's scan lane. It can be replaced by a Personas scan later without affecting this deck.
- Every card's Evaluation is `Method: simulation`, meaning three walked cases from the tree, not a measurement. Before building a card, re-verify its premise; scouts can be wrong about reachability.
- Cards that depend on PayPal or engine behaviour cite `.research/*.md` or are marked UNVERIFIED (notably: claude-code's tool-list timing for T3, and webhooks-events listing without a registered listener for T10).
- Scout result files (raw JSON) were kept in the session scratchpad only. This document and moonshot-cards.md are the durable record. **Treat both as the never-re-propose list for the next sweep.**
