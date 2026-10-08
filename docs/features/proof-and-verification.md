# Proof and verification

The Table can show its work. A finished or open deal exports as one signed proof file
(`.tableproof`). The file holds the owner-signed rules, both agents' signed messages, the closed
mandates, the money operations with their request ids, the redacted PayPal records, the deal's
audit rows and, in format v2, the evidence behind each newer safety feature. Anyone can check it
offline: with the `table-verify` command-line tool, or in the wallet's own Book through "Check a
proof file". The same verifier runs in CI over a golden deal. CI also runs a seeded
hostile-agent gauntlet and an acceptance matrix that maps every design acceptance ID to the tests
that carry it. Together these are the "safety dossier" a judge, an accountant or the other side of
a deal can read without trusting the wallet's screens.

## What the owner sees

- **main window, deal page, proof tab:** "Save signed proof". Before saving, a sheet lists what
  anyone with the file can check (`PROOF_FILE_SHOWS` in `lib/words.ts`). It also warns once that
  the file carries the deal's rules (price limits, payees, caps) and the other side's notes. A
  native save dialog writes the file. The toast reads "Signed proof saved · check it with
  “Check a proof file” in the Book".
- **main window, Book:** "Check a proof file" (`windows/main/modules/book/ProofCheck.tsx`). The
  owner picks a file in a native open dialog, and Rust reads and checks it. The sheet shows:
  - one plain line per check (`PROOF_CHECKS`), with "not checked" lines explained
    (`PROOF_NOT_APPLICABLE`, `PROOF_OLDER_FILE`, `PROOF_NOT_CHECKED`);
  - the file's owner key in full, with "Matches your wallet" or "A different wallet";
  - the permissions fingerprint, with "Made by the same version" or "A different version";
  - the verdict: verified, "Every check that applies passed", or "Not every check could be
    made".
- **Settings › Detailed › Saved keys** and the approval window's owner configuration show "Your
  owner key" in groups of four with Copy (`shared/ownerKey.tsx`). This is the anchor a person
  checking a file compares against.
- **Book › Audit trail:** if the chain fails its check, the sheet says so in plain words and
  offers "Check again" (`AUDIT_BROKEN`). It shows no partial history.

## How it works

1. **Export.** `deal_export_proof` (main and approval) reaches `Action::ExportProof`.
   `Ledger::export_proof(id, owner, at, house)` (`crates/table-ledger/src/bundle.rs`)
   re-verifies the transcript and the whole audit chain before copying anything. It adds request
   ids, the shop-around group's `group.*` rows and up to 1000 kept house heads.
   `Runtime::sign_proof` (`crates/table-runtime/src/proof.rs`) adds the T11 permissions
   fingerprint and signs the evidence head with the agent key the deal's mandate names. The shell
   saves through a native dialog (`apps/desktop/src-tauri/src/native/commands.rs`).
2. **Format.** `table_proto::ProofBundle` (`crates/table-proto/src/proof.rs`) is
   `PROOF_FORMAT = "table.proof.v2"`. `PROOF_FORMAT_V1` stays readable. v2 adds optional committed
   fields: `authority_manifest`, `group`, `house {release, heads}`, and `request_id` on
   operations and calls. No v2 field carries counterparty free text. The evidence commitment uses
   the file's own format string as its domain, so a v2 file relabelled v1 fails.
3. **Check.** `table_verify::verify_bundle` (`crates/table-verify/src/lib.rs`, `v2.rs`) runs
   15 checks with stable ids:

   | id | what it checks |
   | --- | --- |
   | `format` | the file is a format this verifier reads |
   | `mandate` | the owner signed the mandate |
   | `transcript` | transcript signatures and hash chain |
   | `countersign` | each closed mandate binds terms, amount and an approved payee |
   | `authority` | every money call has a lawful authority (an unclassified money POST fails) |
   | `paypal_order` | each 2xx order create, authorize and read matches the signed terms (custom id, invoice id, payee, amount) |
   | `audit` | audit rows are hash-consistent |
   | `receipt` | any receipt is inside the transcript |
   | `owner_saw` | every owner-decided money step has an earlier `owner.decision` row with a checks hash |
   | `one_request` | resolved, re-sent and parked steps reuse one reserved request id |
   | `group` | at most one agreed table in a group, the winner; withdrawals follow the win |
   | `shield` | no non-void money step while BLOCK or an unreleased HOLD covers these terms |
   | `house_record` | kept house heads verify against the pin and never shrink |
   | `permissions` | the permissions fingerprint (in the app: same or different version) |
   | `evidence` | the evidence head is signed by the deal's agent |

   Each `Check` has `ok`, `checked` and `applies`. `Report::verified()` holds when every check
   that applies passed (`ok || !applies`). A check with nothing to check reads "not checked" and
   makes no claim. A check that applies but cannot be made, such as an order record saved before
   bindings were stored, holds the file back.
4. **In the app.** `proof_check` (main, answered by the shell) reads the file through a native open
   dialog. `table_client::check_proof_file` caps it at `PROOF_FILE_LIMIT` (8 MiB), parses it, runs
   the same verifier and compares the fingerprint with the wallet's own.
5. **On the command line.** `cargo run -p table-verify -- <file>.tableproof` prints one line per
   check (✓, ✗, or `-` for not checked), then VERIFIED or NOT VERIFIED. Exit codes: 0 verified,
   1 failed, 2 unreadable. It prints the key anchor and the known limit (`KEY_ANCHOR`,
   `KNOWN_LIMIT`). `table-verify --house <ledger.json> [--head <head.json>]... [--pin
   <release.json>]` checks the house seller's public record offline instead (8 checks in
   `crates/table-verify/src/house.rs`; see [pairing-relay-house.md](./pairing-relay-house.md)).
   The verifier reads files only and never uses the network.
6. **Hostile-agent gauntlet.** `crates/table-app/tests/gauntlet.rs` plays seeded sessions
   (SplitMix64) against two real wallets. Agent calls go through the real `table_mcp::Server`
   router in process. Money goes through the real `Pipeline` and `table_paypal::Client` over a
   recording in-memory transport. Moves include out-of-band offers, 16 off-catalogue tool names
   (capture, void, refund …), malformed and extra-field arguments, wrong roles and deals, and
   counterparty NOTEs carrying injection text and a unique tag. Replays, tampering and owner
   decisions emulated as the approval window makes them are mixed in, with ticks up to 73 h.
   - **After every agent call:** no new `paypal_calls` row or transport request, no outbound
     envelope on a refusal, and exactly one `intent.refused` row per refused call.
   - **After every session:** a whole-ledger predicate runs over both wallets' exported proofs.
     `SafeDefault` only voids. `Policy` acts only under clause 6 on a haggle. `Human` acts only
     after an `owner.decision` row. Seller and house mandates act seller-side only, and only
     after APPROVED. Invoices run only on `Human` for a rescue. No stored call contains a note or
     the session tag. `verify_bundle` passes.

   CI runs 64 fixed seeds (`CI_SESSIONS`). `TABLE_GAUNTLET_SESSIONS=n` runs more, and
   `TABLE_GAUNTLET_SEED` replays one.
7. **Acceptance matrix.** `crates/table-verify/src/acceptance.rs` with the ID list in
   `src/acceptance-ids.txt` (40 IDs from design §13 and window-duality §7, 17 marked never-cut).
   The `acceptance-matrix` binary reads `cargo test --workspace -- --list` on stdin, prints a
   markdown matrix, and exits 1 when a never-cut ID has no test.
8. **CI safety dossier** (`.github/workflows/ci.yml`, ubuntu leg). `cargo test` runs with
   `TABLE_EVIDENCE_DIR` set, so the H6 golden run writes `h6-house-deal-buyer.tableproof` and the
   gauntlet writes its summary. CI then writes the acceptance matrix into the job summary, runs
   `table-verify` over every `.tableproof`, and uploads the `safety-dossier` artifact.

## Safety properties

| Property | Where |
| --- | --- |
| Export never copies an unverified chain | `Ledger::export_proof` re-verifies transcript and audit first |
| A file cannot be edited after signing | `evidence` check over the agent-signed evidence head; format string is the commitment domain |
| Every PayPal money call names its authority | `authority` check; unclassified money POSTs fail (`operation_of`, test `rescue_invoices_are_money_steps_and_the_search_is_a_read`) |
| No second request id for one operation | `one_request` check; resolver test `no_path_sends_one_operation_under_two_request_ids` |
| The owner saw what they approved | `owner_saw` check against `owner.decision` rows written by runtime `decide()` |
| The in-app check is the CLI check | both call `table_verify::verify_bundle`; `check_proof_file` is pure |
| No counterparty prose is interpreted | the verifier never prints or parses NOTE text; v2 adds no free-text field |
| Hostile agents leave only lawful money rows | gauntlet predicate, plus mutation tests proving the predicate catches misfits |

## Where it lives

| Layer | Path | Key items |
| --- | --- | --- |
| Format | `crates/table-proto/src/proof.rs` | `ProofBundle`, `PROOF_FORMAT`, `PROOF_FORMAT_V1`, `ProofGroup`, `ProofHouse` |
| Export | `crates/table-ledger/src/bundle.rs`, `crates/table-runtime/src/proof.rs` | `Ledger::export_proof`, `Runtime::sign_proof` |
| Verifier | `crates/table-verify/src/lib.rs`, `v2.rs`, `house.rs`, `main.rs` | `verify_bundle`, `Report::verified`, `Check`, `verify_house`, CLI `table-verify` |
| Acceptance | `crates/table-verify/src/acceptance.rs`, `acceptance_main.rs`, `acceptance-ids.txt` | bin `acceptance-matrix` |
| Gauntlet | `crates/table-app/tests/gauntlet.rs` | `h1_h2_f1_s2_hostile_agent_gauntlet_leaves_only_lawful_money_rows` |
| IPC glue | `crates/table-client/src/lib.rs` | `check_proof_file`, `PROOF_FILE_LIMIT`, `ProofReport`, `ProofCheckLine` |
| Client | `windows/main/deal/Evidence.tsx`, `windows/main/modules/book/ProofCheck.tsx`, `shared/ownerKey.tsx`, `lib/words.ts` | Save signed proof, Check a proof file, owner key |
| CI | `.github/workflows/ci.yml` | safety dossier steps |

IPC commands (from `crates/table-client/src/authority_table.rs`):

| Command | Windows | Tier | Enforcer |
| --- | --- | --- | --- |
| `deal_export_proof` | main, approval | read | runtime |
| `proof_check` | main | read | shell |
| `audit_page` | main | read | runtime |
| `owner_facts` (carries `owner_key_id`) | main, approval | read | runtime |

## Tests that pin it

- `crates/table-runtime/src/proof_tests.rs`:
  `a_v2_proof_shows_the_checklist_behind_each_owner_decision_and_one_request_per_step`.
- `crates/table-runtime/src/relay_tests.rs`:
  `two_wallet_actors_negotiate_and_settle_through_in_process_relay_without_buyer_api_access`
  exports both sides and forges bundles that must each fail their named check.
  `h6_fresh_wallet_pairs_house_and_closes_through_in_process_relay_with_mock_paypal` is the golden run.
- `crates/table-runtime/src/tests.rs`: `assert_proof_verifies`, used by forecast, ladder and other tests.
- `crates/table-app/tests/gauntlet.rs`: `h1_h2_f1_s2_hostile_agent_gauntlet_leaves_only_lawful_money_rows`,
  `the_predicate_names_an_authority_less_capture_and_every_misfit_authority`,
  `the_predicate_names_counterparty_text_at_paypal_and_calls_on_a_refused_deal`,
  `f2_a_purchase_authorizes_after_approval_captures_after_its_countersign_or_voids`.
- `crates/table-verify/src/acceptance.rs`:
  `the_list_holds_every_section_13_and_window_id_and_the_never_cut_set`,
  `every_listed_id_is_stated_in_the_design_documents`.
- `crates/table-verify/src/lib.rs`: `rescue_invoices_are_money_steps_and_the_search_is_a_read`.
- Client: `windows/main/modules/book/proofV2.test.tsx`, `shared/ownerKey.test.tsx`.

## Known gaps and UNVERIFIED

- **What a file cannot prove.**
  - An owner decision (`DecidedBy::Human`) is the wallet's record, not an owner signature. Owner
    ACCEPT proofs are signatures and are checked.
  - Removal of the newest rows from the end of the wallet's audit log cannot be seen from the
    file alone (`KNOWN_LIMIT`). External anchoring is deferred.
  - The checks trust the keys inside the file, so a person must compare the owner key
    (`KEY_ANCHOR`).
- A deal owner-decided before the T5 checklist has no `owner.decision` row, so its v2 file fails
  `owner_saw`. An order record saved before migration 0007 reads "not checked" and holds the file
  back.
- Since inbound NOTE envelopes are committed to the transcript, a bundle can carry the other
  side's note text inside a signed message. It is never printed or parsed. Selective disclosure
  (T13) is not built.
- UNVERIFIED (STATUS T1): that PayPal's authorize answer carries `custom_id`, `invoice_id`, payee
  and amount for every purchase unit. If not, `Order::verify` refuses the order and a bundle
  recording such a call fails `paypal_order`. Sandbox spike 3 collects the evidence.
- The native save and open dialogs have not been run (no GUI harness). There is no no-install
  checker for v2 files. The CLI prints the fingerprint without a same-version verdict.
- The gauntlet emulates the approval window inside `table-app` (no runtime-level gauntlet with
  paused agents or the resolver). The dossier carries the buyer's file only. CI runs 64 seeds,
  not thousands, and the dossier steps have not yet run on GitHub.
- The acceptance matrix (STATUS, 2026-10-08) covers 27 of 40 IDs, all 17 never-cut. Still without
  a Rust test: F5, M1, M2, C2, R2, U1–U4, W1, W2, W7, W9.

## Related

- [money-pipeline.md](./money-pipeline.md): the operations, request ids and authorities the checks read.
- [approval-window.md](./approval-window.md): where `owner.decision` and `checks_hash` come from.
- [book.md](./book.md): the Book's audit trail and proof-file check.
- [pairing-relay-house.md](./pairing-relay-house.md): the house seller's public record and heads.
- [ipc-and-authority.md](./ipc-and-authority.md): the permissions fingerprint.
- Design: [the-table.html](../design/the-table.html) §9 (trust model), §13 (acceptance);
  [window-duality.md](../design/window-duality.md) §7; [STATUS.md](../build/STATUS.md)
  "T1 proof bundle", "Proof bundle v2", "Hostile-agent gauntlet and acceptance matrix".
