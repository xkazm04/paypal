# Owner spike runbook (spikes 1, 2, 3, 4, 5, 7, 8)

The owner's step-by-step script for the live sandbox spikes. Approved by the operator on
2026-10-16 (DECISIONS §44) **for the owner to run, with his own sandbox credentials, when he
chooses**. Builders and the loop never run these and never touch credentials. Spike 6 (version
only) already ran. This file restates `SPIKES.md` (sections 1-8 and "Failure handling and
recording") and adds no step of its own; where `SPIKES.md` is silent it says so under "Open
questions".

## Rules for every spike

- Run from `paypal/` in PowerShell. Set environment values privately in your own shell. Never put a
  value in this file, `SPIKE-RESULTS.md`, STATUS.md, a commit or a pasted transcript.
- Preview any command without launching a CLI or making a request:
  `./scripts/spike.ps1 -Spike N -DryRun`.
- A real run streams instructions to the terminal, writes only the `TABLE_SPIKE_EVIDENCE` JSON to
  `.build/spike-results/spike-N-<UTC>.json` (git-ignored) and appends one index row to
  `docs/build/SPIKE-RESULTS.md` ending in "Owner observations still to record".
- Do not save the whole console output: it contains the temporary PayPal approval link.
- **Exit 0 means the diagnostic finished, not that the integration works.** Read the evidence
  verdict. A failure is useful evidence; never lower an isolation or authority check because of it.
- **The row to append:** replace the placeholder text in the row the runner added. Put only
  non-secret findings: versions, whether ids exist (not their values), pass/fail per expected item,
  account roles, what you saw. Never paste credentials, tokens, raw model output, merchant notes or
  approval URLs. The row texts below are suggestions for the last column.
- After a failed or unknown run, keep the last evidence file; it holds operation request ids even
  if a POST failed. Check the order, authorization, capture or invoice in PayPal before running
  again; a new run allocates a new deal, so repeating blindly is not reconciliation. Unapproved
  orders expire; polling expiry never captures.
- Afterwards, copy the relevant findings into STATUS.md (CLI versions, flags and init ordering,
  account flow, URL behaviour, monitor id and history, invoice access and delivery, and the
  resulting implementation decision). Wallet acceptance stays pending until the native
  actor/UI/authority/relay path is tested separately.

## Ordering

- **Independent of PayPal:** 1 and 2 (engine CLIs only) and 7 (Channel3 only).
- **Share the three PayPal sandbox names but independent of each other:** 3, 4, 5 and 8 each create
  their own orders or invoice. None needs another to pass first.
- **Needs an earlier step:** every PayPal spike (3, 4, 5, 8) needs its sandbox accounts and app set
  up first (see each spike). Spike 2's second phase runs only if its agent phase passes, so repeat
  the complete spike 2 after fixing the agent phase. A passing spike 1 does not enable an engine
  version in Rust.
- Suggested order, least risky first: 1, 2, 7, then 3, 4, 5, 8. `SPIKES.md` sets no order.

## Spike 1: codex-cli HTTP MCP, config isolation and approve mode

- **Prerequisites:** codex-cli installed and logged in with its own login (role: the owner's CLI
  account). No LLM API key is accepted. No PayPal names. Optional decoy: if the CLI's personal
  configuration has any non-wallet MCP server, note its name privately.
- **Command:** `./scripts/spike.ps1 -Spike 1` (sets `TABLE_LIVE_ENGINES`; runs ignored test
  `spike_1_codex_http_inventory_and_approval`).
- **Pass:** inventory accepted before any input, no foreign tools or servers, one successful HTTP
  MCP call (a single `table_view` read), a clean terminal fact.
- **Fail / expected limitation:** codex-cli 0.160.0 may wait for input and show only
  `thread.started`; the adapter withholds stdin and fails after 10 s with
  `inventory_before_input=false`, zero checked calls and a timeout/isolation failure. Record it. Do
  not feed it a prompt to force a pass.
- **Observe by hand:** whether decoy servers (names kept private) appeared in the inventory. With
  none present, the decoy-config experiment stays unverified.
- **Row:** `CLI version; inventory_before_input yes/no; foreign tools none/some; HTTP MCP call ok/not; decoy servers present y/n, excluded y/n`

## Spike 2: claude-code agent and tool-less profiles

- **Prerequisites:** claude-code installed and logged in. No PayPal names. Personal non-wallet MCP
  servers serve as decoys; the runner never edits your config or copies auth files.
- **Command:** `./scripts/spike.ps1 -Spike 2` (`TABLE_LIVE_ENGINES`;
  `spike_2_claude_agent_and_toolless_inventory`). Agent budget 0.50 USD.
- **Pass:** the agent profile exposes only wallet tools and its one wallet server and does one
  checked read; the second process reports zero tools and zero servers, reads deliberately hostile
  data and returns a closed Shield verdict.
- **Fail:** the agent phase may stall before stdin (2.1.287 ordering); then the second phase does
  not run. Record that partial outcome explicitly, fix the ordering, then repeat the whole
  two-profile test.
- **Observe by hand:** decoy server names (private) and that none appeared.
- **Row:** `CLI version; agent phase pass/fail; tool-less phase ran y/n, verdict closed y/n; decoys excluded y/n`

## Spike 3: seller order approved by a second sandbox account

- **Prerequisites:** a sandbox **seller** account with an app (roles: seller app id and secret,
  seller merchant id) and a **different** sandbox **buyer** account; a browser signed in as the
  buyer. Set `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_SECRET`, `PAYPAL_SANDBOX_MERCHANT_ID`
  privately.
- **Command:** `./scripts/spike.ps1 -Spike 3` (`TABLE_LIVE_SANDBOX`;
  `spike_3_seller_second_account_authorize_capture`).
- **By hand:** open the displayed link in the system browser as the buyer and approve (the test
  polls up to ten minutes). Do not copy the link anywhere.
- **Pass:** one AUTHORIZE order of USD 1.00; amount, payee, invoice and custom hash validate;
  authorize then capture; final amount USD 1.00 and COMPLETED. Evidence has each request id plus
  the order, authorization and capture ids.
- **Also record:** whether the authorize response's purchase unit carries `custom_id`,
  `invoice_id`, `payee.merchant_id` and `amount` (the proof checker relies on all four; none
  observed yet), and that the approving buyer was a distinct account (your observation, not
  inferred). Buyer-app API access to the seller's resource is not tested here.
- **Offline companion (no credentials, no network):**
  `./scripts/cargo.ps1 -CargoArgs @('test','-p','table-runtime','two_wallet_actors_negotiate_and_settle_through_in_process_relay_without_buyer_api_access')`.
  It shows nothing about live connectivity or real PayPal behaviour.
- **Row:** `ids present y/n; COMPLETED USD 1.00 y/n; buyer distinct from seller y/n; custom_id, invoice_id, payee.merchant_id, amount on the authorize body y/n each`

## Spike 4: owner app with explicit payee, capture and void

- **Prerequisites:** the **owner app** credentials and the **target merchant's** id (roles: owner
  app, target merchant), the same three names, and a buyer account for the browser.
- **Command:** `./scripts/spike.ps1 -Spike 4` (`TABLE_LIVE_SANDBOX`;
  `spike_4_owner_payee_capture_and_void`).
- **By hand:** approve two separate USD 1.00 orders in the browser. Note both account identities (by
  role) and look at the target merchant's sandbox receipt.
- **Pass:** matching payee and amount on both orders; one COMPLETED capture; one void confirmed by a
  GET showing VOIDED. Each order has a distinct deal ULID and stable request ids.
- **Row:** `payee and amount match on both y/n; capture COMPLETED y/n; void VOIDED y/n; merchant receipt seen y/n (does not prove it can read the owner-created order)`

## Spike 5: loopback versus custom-scheme return destination

- **Prerequisites:** the same three PayPal names as spike 3 and a buyer account in the browser.
- **Command:** `./scripts/spike.ps1 -Spike 5` (`TABLE_LIVE_SANDBOX`; `spike_5_return_destinations`).
- **By hand:** approve each accepted order. For the `the-table://paypal/return` order, watch the
  browser/OS prompt and write down what appeared (the desktop has no scheme handler registered yet).
- **Pass:** each API request is explicitly accepted or rejected; for accepted orders a GET order
  shows approval (not the redirect content); loopback callback presence is recorded; nothing is
  authorized or captured. Exit 0 only means the comparison finished.
- **Row:** `loopback accepted y/n, callback seen y/n; custom scheme accepted y/n, OS prompt in words; approval proven by GET y/n`

## Spike 7: Channel3 demo monitor comparables and tracking

- **Prerequisites:** a Channel3 key and a canonical Channel3 demo monitor product id
  (`CHANNEL3_API_KEY`, `CHANNEL3_DEMO_PRODUCT_ID`, set privately). Local catalog SKUs are not
  Channel3 ids. No PayPal names.
- **Command:** `./scripts/spike.ps1 -Spike 7` (`TABLE_LIVE_MARKET`;
  `spike_7_channel3_demo_monitor_tracking`).
- **Pass:** positive median, ordered quartiles, response hash and retrieval time, tracking active,
  and a history count or a recorded history failure. A failed history request leaves history
  unverified; an empty successful history does not invalidate the band.
- **Also record:** the printed `comparables` and `comparables_with_id` counts (the per-product `id`
  field is unverified) and whether the service honoured `limit` 30.
- **Repeat** the same command after history has accumulated.
- **Row:** `median above 0 y/n; quartiles ordered y/n; tracking active y/n; history count or failure; comparables vs comparables_with_id counts`

## Spike 8: sandbox invoice created, sent and paid

- **Prerequisites:** the invoicing merchant's app (the same three names) and a sandbox **personal
  recipient** email in `PAYPAL_SANDBOX_INVOICE_EMAIL`; you can log into sandbox.paypal.com as that
  recipient.
- **Command:** `./scripts/spike.ps1 -Spike 8` (`TABLE_LIVE_SANDBOX`;
  `spike_8_invoice_create_send_paid`).
- **By hand:** log in as the recipient, find the invoice and pay it on the hosted page (the test
  polls up to ten minutes). Note whether an email arrived and the route you used.
- **Pass:** one USD 1.00 invoice in the rescue shape with the deterministic number;
  `invoice_searched` with `search_ok` and `found_by_number`; one send; PAID with total exactly
  USD 1.00. Invoicing POST failures are not retried automatically.
- **Fail meaning:** if `found_by_number` is false, a lost create cannot be resolved automatically
  and parks for the owner (never re-sent). Also note the other UNVERIFIED items from STATUS.md:
  `detail.invoice_number` and its length cap, `detail.note`, the search body field and `items`,
  and `billing_info.outstanding_balance`.
- **Row:** `created y/n; found_by_number y/n; sent y/n; PAID USD 1.00 y/n; email arrived y/n via which route`

## Open questions (SPIKES.md is silent or ambiguous)

1. **Order.** `SPIKES.md` gives no order or dependency between spikes; the suggestion above is this
   file's.
2. **Spikes 1 and 2.** The runner requires no environment names for them; `SPIKES.md` does not say
   what to do when a CLI is not logged in, or which versions are acceptable.
3. **Spikes 3 and 4 accounts.** `SPIKES.md` does not say how the sandbox seller, owner-app, merchant
   and buyer accounts are created or funded, nor whether spike 4's target merchant may be spike 3's
   seller.
4. **Spike 4 buyer.** It says to approve in the browser but not whether the buyer must differ from
   the owner and target merchant.
5. **Spike 5.** No pass rule is given when one destination is rejected beyond "record the outcome".
6. **Spike 7.** Finding the canonical demo monitor id is "an owner setup step" with no
   instructions; "after history has accumulated" has no stated wait.
7. **Spike 8.** No rule for an invoice created but not paid within ten minutes (rerun or check
   first).
8. **Row format.** `SPIKE-RESULTS.md` fixes five columns but no wording for the observations
   column.
9. **Who records.** DECISIONS §44 says a later run records `SPIKE-RESULTS.md` from the owner's
   output; `SPIKES.md` says the owner records. Which applies is for the owner to say.
