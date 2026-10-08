# HOUSE deployment

The root `render.yaml` and `Dockerfile` run **one co-hosted house-seller + rendezvous**
process. The old files under `services/rendezvous/` are compatibility entry points.
Use one Blueprint, not both. Auto-deploy is off. No deployment, container build,
secret provisioning or live PayPal request was performed in this session.

The seller uses a paid single instance with a persistent SQLite disk. Only paths
under the disk mount survive Render restarts; disks cannot be shared by multiple
instances and cause a restart during deployment. The public relay remains volatile.
This intentionally supersedes the former free relay-only deployment: losing a house
financial ledger would lose durable operation reservations. See Render's
[disk documentation](https://render.com/docs/disks) and
[Blueprint reference](https://render.com/docs/blueprint-spec).

## Environment names

| Name | Where | Meaning |
| --- | --- | --- |
| TABLE_HOUSE_RELEASE_JSON | Wallet compile environment; server Docker build argument | **Public only:** owner/agent public keys, payee, mandate commitment and owner signature over the commitment. Identical JSON for both builds. |
| HOUSE_OWNER_KEY_BASE64 | Server runtime; offline owner signing shell | Standard-base64 Ed25519 32-byte private seed. |
| HOUSE_AGENT_KEY_BASE64 | Server runtime; offline owner signing shell | Distinct standard-base64 Ed25519 32-byte private seed. |
| HOUSE_MANDATE_JSON | Server runtime; offline release preparation | Owner-signed OpenMandate JSON. No file fallback. |
| HOUSE_MANDATE_PAYLOAD_JSON | Offline owner signing shell only | Unsigned MandatePayload JSON the owner has reviewed. Never a server override. |
| HOUSE_PAYPAL_CLIENT_ID | Server runtime | Sandbox REST app client id for the signed payee. |
| HOUSE_PAYPAL_CLIENT_SECRET | Server runtime | Matching sandbox REST app secret. |
| HOUSE_LEDGER_PATH | Server runtime | SQLite path under the persistent disk mount configured in the Blueprint. |
| PORT | Server runtime, supplied by Render | Listener port. |
| TABLE_RELAY_URL | Desktop process runtime | Deployment HTTPS origin, without a path, credentials, query or fragment. |

No values belong in source control, `.env` files, fixtures or console transcripts.
Import private seeds and credentials from the owner's secret manager directly into
the environment; do not pass them as Docker build arguments. The Dockerfile declares
only the public release argument. Render supplies declared arguments from service
environment variables; see [Docker on Render](https://render.com/docs/docker).

## Prepare the release offline

1. Provision two distinct cryptographically random 32-byte signing seeds privately.
   Load the owner and agent environment names above. Do not reuse test keys.
2. Obtain the **public** agent key with
   `./scripts/cargo.ps1 -CargoArgs @('run','--quiet','-p','house-seller','--bin','house-public-key')`.
   Prepare the owner-reviewed payload in `HOUSE_MANDATE_PAYLOAD_JSON` using the
   typed MandatePayload contract. It must contain a seller Haggle role, paired
   counterparties, one item, one category, a floor and ceiling/ask in the same
   currency, a round limit, active validity/deadline, per-deal and daily limits,
   clause-6 threshold and exactly one PayPal payee. HOUSE serves quantity one with
   DigitalNow delivery. Amounts are minor integers. The authority still refuses
   amounts above clause 6; sign limits that permit the intended demo.
3. Sign the reviewed payload and capture its output **in memory**, then emit the
   public release commitment in memory:

   ```powershell
   $env:HOUSE_MANDATE_JSON = (& ./scripts/cargo.ps1 -CargoArgs @('run','--quiet','-p','house-seller','--bin','house-sign')) -join "`n"
   if ($LASTEXITCODE -ne 0) { throw 'HOUSE mandate signing failed' }
   $env:TABLE_HOUSE_RELEASE_JSON = (& ./scripts/cargo.ps1 -CargoArgs @('run','--quiet','-p','house-seller','--bin','house-release')) -join "`n"
   if ($LASTEXITCODE -ne 0) { throw 'HOUSE release preparation failed' }
   ```

   These helpers make no network requests, generate no private key files and print
   only public keys, signed policy or public commitment. The build pin is never
   learned from an HTTP response or accepted from IPC. Release compilation requires
   the public argument; debug builds without it report HOUSE unavailable.
4. Build the wallet with that public compile variable. Supply the **same** public
   JSON to the Render build and the matching keys, signed mandate and credentials
   to runtime. Startup verifies signatures, keys, hash and validity before binding
   HTTP; it checks credential presence without requesting an OAuth token. A revoked
   mandate or different pin in an existing ledger fails closed.

## Deploy and exercise, when authorized by the owner

Create/sync the root Blueprint and manually deploy. `sync: false` prompts for values
only on initial creation; on an existing service, add the new names manually.
The entrypoint sets ownership on the mounted directory, then drops to uid/gid 65534
with Debian [setpriv](https://manpages.debian.org/bookworm/util-linux/setpriv.1.en.html).
Retain the disk across redeployments and verify existing ledger-file permissions if
migrating an older installation. Use sandbox credentials only. `/healthz` is available after verified
startup; `/v1/house/tables` accepts a closed HouseRequest and returns a signed
HouseResponse. Invalid requests fail, capacity returns 429, actor failure returns 503.

Public read routes (T9, glass-box HOUSE; read-only, no secrets, no PayPal call, no write):
`GET /v1/house/head` returns the audit-chain head signed by the release agent key (refreshed at
most once a minute; 503 until the first refresh), `GET /v1/house/prefix?rows=N` the signed chain
hash at an earlier row count, `GET /v1/house/ledger?limit=&before=` a typed page of house deals
(newest first, at most 100 per page, 500 held), and `GET /house` the scoreboard page (its own
script and stylesheet only, strict CSP). A new disk starts a new epoch (first-row hash), shown on
the scoreboard and to wallets as "the house started a new record". The judge path: finish a HOUSE
deal, open `<origin>/house`, find the deal number, compare the record mark with the wallet's.

Set the desktop relay origin and call `pairing_join` with code HOUSE, buyer side and
the buyer payee, omitting peer. `get_settings().house` and `settings:changed` expose
`idle`, `waking`, `ready` or `unavailable`: render **House waking** while the HTTPS
request is pending, including restart/cold-start delays. Timeout/failure is retryable
and retains the initiating identity; cancelling the request clears waking. One HOUSE
join is allowed at a time. This is request state, not a claim of Render readiness.

Confirm the four returned words in the privileged approval window. Use
`PairingWords.house_table` to call `deal_join` with the returned deal ULID, category
and initial terms plus the buyer's own signed mandate. Rust retains/verifies that
table and binds its negotiation deadline. Negotiate through the existing agent
intent path. The owner opens the verified PayPal link in the approval window.
The seller polls verified APPROVED, authorizes and captures DigitalNow, then signs
the receipt. Missing market evidence stays absent; the explicit release mandate
handles ASK, while HOLD/BLOCK, all clause limits and defaults remain authoritative.
The buyer labels the receipt SELLER_ATTESTED until own-account reporting matches.

Sessions/routes are bounded at 64 per house ledger; negotiation defaults after five
minutes or the earlier signed band deadline, then the normal six-hour approval and
72-hour authorization defaults apply. A timeout or unknown financial outcome never
creates another order/capture identity. Do not replace a ledger or restart a deal to
work around an unknown outcome. Confirmed-operation SETTLE/RECEIPT crash-gap repair
is still deferred. Rotation/expiry requires an owner-reviewed new release and wallet
build; the existing ledger pin is immutable, so migration of an active house ledger
requires separate reviewed work.

## Offline acceptance

```powershell
./scripts/cargo.ps1 -CargoArgs @('test','-p','table-runtime','house_')
./scripts/check.ps1
```

H6 starts with a fresh buyer and owner-signed mock release, calls the HTTP router in
process, negotiates a below-floor offer to the pure Policy counter and closes through
mocked PayPal. It checks equal seller/buyer transcript heads and capture references,
one create/authorize/capture, zero buyer PayPal calls, no market fabrication and
SELLER_ATTESTED evidence. Other tests cover pending waking with continuing deadlines,
cancellation, malformed/tampered requests/releases, HOLD/BLOCK, genuine fixture market
HOLD, revoke, capacity and disk reopen/mailbox loss. No test opens a network socket.
Real secret provisioning, Linux container/mount permissions, Render restart timing,
sandbox ownership and native client UX remain operator verification.
