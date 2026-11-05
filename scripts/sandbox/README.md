# PayPal sandbox live runs

Setup: copy `.env.example` to `.env.sandbox` (gitignored by `.env.*`), fill from developer.paypal.com
(Apps & Credentials > Sandbox). Check it with `node scripts/sandbox/preflight.mjs`.
Run: `scripts/sandbox/run-live.ps1` (client test + spikes 3, 4, 5, 8). Spikes 3/4/5 need the sandbox
buyer to sign in and approve each order in a browser within 10 minutes (spike 4 and 5 ask twice).

## Last run (2026-11-05, app "Merchant", US business account)

| Test | Result |
|---|---|
| `client` live (`sandbox_create_authorize_order_spike`) | pass |
| spike 3 authorize + capture | pass |
| spike 4 capture + void | pass |
| spike 5 return destinations | pass |
| spike 8 invoice | FAIL: 403 NOT_AUTHORIZED on invoice create |

Spike 8: the app's **Invoicing** feature was off; it was switched on and saved (persisted after reload),
but the OAuth token's scopes still lacked invoicing and `POST /v2/invoicing/generate-next-invoice-number`
still returned NOT_AUTHORIZED. Next: retry after propagation, else create a fresh app with Invoicing
enabled at creation, or check the business account's invoicing eligibility. Paying the invoice then needs
the buyer (owner step).
