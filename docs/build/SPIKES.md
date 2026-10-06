# Day-1 live spike runbook

Run from `paypal/` in PowerShell. Each spike has one command. The runner checks the
required environment names, sets the explicit opt-in gate for that child command,
and restores it afterwards. CLI login belongs to the installed CLI; wallet/API
credentials are never passed to the model. Set environment values privately in your
own shell; no credential values belong in this document, files or console transcripts.

These are **standalone conformance tests**, compiled as ignored integration tests.
They do not create wallet receipts, grant UI authority or mark the backend ready.
Production money execution remains in table-app. The ordinary workspace test command
skips all of them. The author ran only help/version probes and offline tests.

Inspect any command safely without launching a CLI or making an HTTP request:

```powershell
./scripts/spike.ps1 -Spike 3 -DryRun
```

Every real command streams operator instructions to the terminal and stores only
`TABLE_SPIKE_EVIDENCE` JSON under `.build/spike-results/spike-N-<UTC>.json`. It appends
an index row to `docs/build/SPIKE-RESULTS.md`. Record observations there and the final
decision in `docs/build/STATUS.md`. Do not capture the complete console output: it
contains the temporary PayPal approval link. Results may be failures; that is useful
evidence, never permission to lower the isolation/authority checks.

## 1. codex-cli HTTP MCP, config isolation and approve mode

```powershell
./scripts/spike.ps1 -Spike 1
```

Environment: `TABLE_LIVE_ENGINES` (set by runner). Installed/authenticated codex-cli
and its existing login are required; no LLM API key is accepted. This selects ignored
`table-engine::spike_1_codex_http_inventory_and_approval`.

The adapter uses the real Windows resolution, empty cwd, stripped environment,
loopback server and per-session grant. The server advertises only checked wallet
intents; the prompt asks for exactly one table_view read. Expected usable evidence:
pre-input inventory accepted, no foreign tools/servers, one successful HTTP MCP call,
and a clean terminal fact. `default_tools_approval_mode="approve"` and
`env_http_headers` remain unverified until this succeeds. With existing non-wallet
servers in the CLI's personal configuration, record their names privately as decoys
and confirm none appeared in the inventory. If no such server exists, inventory
exclusion is tested, but the decoy-config experiment is still unverified.

**Current expected limitation:** codex-cli 0.160.0 may wait for input and expose only
thread.started rather than a tool inventory. The adapter withholds stdin and fails
after 10 seconds. Evidence then says `inventory_before_input=false`, zero checked
calls and a timeout/isolation failure. Do not feed it a prompt to force a pass. Resolve
the CLI handshake/attestation contract before changing availability in Rust. Even a
successful spike does not automatically enable an engine version.

## 2. claude-code agent and tool-less profiles

```powershell
./scripts/spike.ps1 -Spike 2
```

Environment: `TABLE_LIVE_ENGINES` (runner); installed/authenticated claude-code.
Ignored test: `table-engine::spike_2_claude_agent_and_toolless_inventory`.

The agent profile must expose only wallet tools and its one connected wallet server,
then perform one checked read. The second process must report zero tools and zero
servers before reading deliberately hostile data, and return a closed Shield verdict.
It uses the empty inline MCP config, denies mcp__*, and never combines stream-json
with json-schema. Agent budget is 0.50 USD; both profiles have watchdogs. The current
2.1.287 ordering may also stall before stdin. If the agent phase fails, the second
phase does not run: fix the ordering first, then repeat the complete two-profile test.
Record this partial outcome explicitly. Existing personal non-wallet MCP servers are
the decoy evidence; the runner never edits the user's config or copies auth files.

## 3. Seller order approved by a second sandbox account

```powershell
./scripts/spike.ps1 -Spike 3
```

Environment: `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_SECRET`,
`PAYPAL_SANDBOX_MERCHANT_ID`; `TABLE_LIVE_SANDBOX` is runner-set. Use the seller's app
credentials and its own merchant id. Open the displayed, host-checked link in the
system browser as a **different sandbox buyer**. Ignored test:
`table-paypal::spike_3_seller_second_account_authorize_capture`.

The test creates one AUTHORIZE order for USD 1.00, polls up to ten minutes, validates
amount/payee/invoice/custom hash, authorizes, captures, and validates the final amount
and COMPLETED status. Evidence records every operation's request id before the call,
then order/authorization/capture ids. Confirm the distinct buyer account in
SPIKE-RESULTS.md; it is an operator observation, not inferred from success. Buyer-app
API access to the seller's resource is **not tested** by this command and remains a
separate asymmetry/reconciliation question. No wallet-side buyer receipt is fabricated.

The P4 backend now accepts seller-signed receipts atomically as SELLER_ATTESTED,
and tests both actors through the relay HTTP router in process, starting from
code-only pairing, signed identity/reply exchange and both owners' privileged word
confirmation. Run that **offline companion** without credentials or network access:

```powershell
./scripts/cargo.ps1 -CargoArgs @('test','-p','table-runtime','two_wallet_actors_negotiate_and_settle_through_in_process_relay_without_buyer_api_access')
```

It uses in-memory vaults, recording PayPal HTTP and the in-process relay Router;
it copies only the pairing code between the actors. It verifies equal final heads,
SELLER_ATTESTED buyer evidence, zero buyer PayPal calls and exactly one seller create/
capture after relay mailbox loss/redelivery. Additional ordinary pairing tests cover
expiry, reply commitment, conflicting identities, retries, pre-confirmation relay
loss and continuing deadline defaults while transport IO is pending. These tests do
not establish live connectivity, native word-display UX, hosted HOUSE, cold-start
timing or real PayPal behavior. This standalone live spike still does not exercise
that actor/relay path. Own-account reporting
reconciliation is implemented offline, but the buyer debit sign and use of the
seller capture id as transaction_id remain UNVERIFIED and fail closed if different.
Neither this command nor a seller's successful capture proves that buyer-account
reporting mapping, permission or lag; record those separately when the owner runs
a complete native two-account flow.

## 4. Owner app with explicit payee: capture and void

```powershell
./scripts/spike.ps1 -Spike 4
```

Environment: `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_SECRET`,
`PAYPAL_SANDBOX_MERCHANT_ID`; runner gate `TABLE_LIVE_SANDBOX`. Use the **owner app**
credentials and the **target merchant's** id. Ignored test:
`table-paypal::spike_4_owner_payee_capture_and_void`.

Approve two separate USD 1.00 orders in the browser. The first authorizes/captures;
the second authorizes/voids and GETs the authorization to confirm VOIDED. Each has a
distinct deal ULID and stable operation request ids. Expected evidence is matching
payee/amount on both orders, one COMPLETED capture and one verified void. Record both
account identities and the merchant's sandbox receipt separately; the target merchant
receiving funds does not imply it can read the owner-created order.

## 5. Loopback versus custom-scheme return destination

```powershell
./scripts/spike.ps1 -Spike 5
```

Environment: the same three PayPal names and runner gate as spike 3. Ignored test:
`table-paypal::spike_5_return_destinations`.

Creates one order with an ephemeral 127.0.0.1 HTTP listener and another with
`the-table://paypal/return`, using the sourced
payment_source.paypal.experience_context fields. The buyer approves each accepted
order; GET order, rather than redirect content, proves approval. It **never authorizes
or captures**. Evidence records API rejection or acceptance plus loopback callback
presence. The callback body is neither stored nor trusted as approval.

The desktop currently has no registered custom-scheme handler. Observe the browser/OS
prompt and record it; scheme acceptance is distinct from a packaged-app round trip.
If either API request is rejected, that outcome is recorded explicitly; exit 0 means
the comparison finished, not that both destinations work. URL acceptance and Windows
scheme delivery remain unverified until the corresponding evidence is reviewed.

## 6. Windows executable and npm-shim resolution

```powershell
./scripts/spike.ps1 -Spike 6
```

Environment: `TABLE_CLI_PROBE` (runner); installed CLIs and node for npm installs.
Ignored test: `table-engine::spike_6_windows_binary_resolution`.

Runs only --version after Rust resolves a direct .exe or the recognized npm
node.exe + script layout. It does not execute batch/PowerShell shim text or send
model input. Evidence must include both parsed versions and resolution kinds.
The offline suite separately proves shim metacharacters stay inert, stdin argument
safety, CREATE_NO_WINDOW job lifecycle and descendant cancellation. Inspect console
visibility on the native machine; version output alone cannot prove no window flash.
Help probes in this build found claude-code 2.1.287 / codex-cli 0.160.0.
The same versions pass this command after the Node script-path fix; both attempts
are recorded in SPIKE-RESULTS.md. It establishes resolution/version output only.

## 7. Channel3 demo monitor comparables and tracking

```powershell
./scripts/spike.ps1 -Spike 7
```

Environment: `CHANNEL3_API_KEY`, `CHANNEL3_DEMO_PRODUCT_ID`; runner gate
`TABLE_LIVE_MARKET`. The product id must already be a real canonical Channel3 demo
monitor id. Ignored test: `table-market::spike_7_channel3_demo_monitor_tracking`.

Fetches /v1/similar comparables, computes exact USD quartiles in Rust, explicitly
starts /v0/price-tracking/start, then checks one-day history. Expected evidence:
positive median, ordered quartiles, response hash/retrieval time, tracking active,
and history count or a recorded history failure. A failed history request leaves
history support unverified; an empty successful history does not invalidate a
comparable band. This command needs no PayPal credentials and transmits no titles or
merchant prose to an engine. Repeat the same command after history has accumulated.
Finding the canonical demo product is an owner setup step; this runner does not
pretend local catalog SKUs are Channel3 product ids.

## 8. Sandbox invoice created, sent and paid

```powershell
./scripts/spike.ps1 -Spike 8
```

Environment: `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_SECRET`,
`PAYPAL_SANDBOX_MERCHANT_ID`, `PAYPAL_SANDBOX_INVOICE_EMAIL`; runner gate
`TABLE_LIVE_SANDBOX`. Use the invoicing merchant's app and a sandbox personal
recipient's email. Ignored test: `table-paypal::spike_8_invoice_create_send_paid`.

Creates one USD 1.00 invoice with a fresh deal reference, sends it once, then polls
up to ten minutes. Log into sandbox.paypal.com as that recipient, locate the invoice
and pay it on the hosted page. Expected automated evidence: invoice id/reference,
send operation, PAID status and exactly USD 1.00 total. Record whether email actually
arrived and the route the recipient used; the API cannot prove delivery to an inbox.
No email credentials are loaded and no wallet-to-subscriber email is sent.
Invoicing POST failures are not automatically retried. This confirms the rail;
rescue detection, owner-bound lever execution, double-billing prevention and invoice
recovery accounting remain separate P3 work.

## Failure handling and recording

Keep the last evidence file. It includes operation ids even if the POST failed.
An unknown create/authorize/capture/invoice outcome requires checking those resource
ids/references in PayPal before another run; a new spike invocation allocates a new
deal, so blindly repeating it is not financial reconciliation. Unapproved orders
are left to expire; approved-but-unauthorized return-url orders do not capture.
Expired polling never causes a capture. These direct client conformance fixtures
have no crash recovery beyond their evidence log; do not use them for wallet business.

Update STATUS.md with CLI versions, supported flags/init ordering, the final account
flow, URL behavior, canonical monitor id/history, invoice access/delivery, and the
resulting implementation decision. Keep wallet acceptance criteria pending until
the native actor/UI/authority/relay path is tested independently.
