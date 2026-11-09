# SDK conformance (PayPal sandbox only)

Checks, on the PayPal **sandbox** and nowhere else, that the fields the Rust client
(`crates/table-paypal`) reads are the fields PayPal returns. It creates orders, reads them back,
authorizes, captures and voids, and prints `PASS` / `FAIL` / `SKIP` per field. It prints names and
verdicts only: no credential, token, id or (by default) approval link.

Built with the APIMatic Context Plugin (the PayPal skills of `paypaldev/server-sdk-context-plugin-preview`)
against `@paypal/paypal-server-sdk` **2.5.0**, pinned exactly. This is its own package, not part of the
pnpm client, and nothing here runs in the app.

## Run

```
cd scripts/sandbox/sdk-conformance
npm install
npm run check                          # authorizes with the sandbox test card, no browser
npm run check -- --refund-control      # also refunds the app's OWN-payee capture (baseline for spike 9)
npm run check -- --approve             # authorizes through the real buyer approval (browser)
npm run check -- --env <file>          # default: ../.env.sandbox
```

Reads `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_SECRET`, `PAYPAL_SANDBOX_MERCHANT_ID` from
`scripts/sandbox/.env.sandbox` (the same file `run-live.ps1` uses; gitignored). The client is built
with `Environment.Sandbox`; there is no production switch. Exit code is 1 if any check fails.

## What it covers

| Stage | Fields and behaviour checked |
|---|---|
| create order | `id`, `status`, `intent`, one purchase unit, `amount`, `invoice_id`, `custom_id`, `payee.merchant_id`; the approve link (`https`, sandbox host, `/checkoutnow`, one pair `token=<order id>`); a replay under the same `PayPal-Request-Id` returns the same order |
| return destinations | an order with `payment_source.paypal.experience_context` loopback and custom-scheme URLs is accepted |
| read back | the same order fields from `GET /v2/checkout/orders/{id}` |
| without a buyer | authorizing an unapproved order is refused (422 `ORDER_NOT_APPROVED`); void and read of a never-issued authorization are 404 |
| authorize, capture, void | `payments.authorizations[]` (`id`, `status` CREATED, `amount`); `GET authorization` CREATED, then CAPTURED after capture, VOIDED after void; capture `id`, `status` COMPLETED, `amount`; capture and void replays under one `PayPal-Request-Id`; the capture listed under `purchase_units[0].payments.captures`; capture of a voided authorization refused |
| invoicing (draft only) | `detail.invoice_number` (accepted, echoed, unique, 25 accepted and 26 refused), `detail.note`, `detail.reference`, `amount`, `search-invoices` body `invoice_number`, `items`. Raw HTTP: SDK 2.5.0 has no Invoicing controller. Drafts are never sent and are deleted afterwards |
| subscription read | `GET /v1/billing/subscriptions/{id}?fields=last_failed_payment` is accepted; `billing_info` on a never-approved subscription |

## What stopped it, and how to complete it

Approval needs a buyer. The default run therefore authorizes with the sandbox's public test card
(`payment_source.card` on `authorize`, which the SDK reference lists as the alternative to buyer
approval, `doc/controllers/orders.md`, Authorize Order). Everything after the authorization is the
same PayPal resource either way. What this route does **not** exercise: the order reaching
`APPROVED` through the wallet page, which the wallet polls for. To check that, run
`npm run check -- --approve`, open the two printed links in a system browser signed in as the
sandbox buyer (a different account from the merchant), approve both, and leave the script polling
(10 minutes). Do not paste the links anywhere; they are single-use approval links.

Two things this sandbox app cannot show, whatever the route:

- **Reporting** (`/v1/reporting/transactions`) answers 403 `NOT_AUTHORIZED`: the app's
  Transaction Search feature is off. Enable it on the app (developer.paypal.com > Apps &
  Credentials > the app > Features), wait for the capture to be indexed (the SDK reference says up
  to three hours), and rerun. The buyer-side negative figure also needs the buyer account's own
  REST app.
- **A failed subscription renewal** (`failed_payments_count`, `outstanding_balance`,
  `last_failed_payment`) cannot be produced on demand. Their names come from the SDK model docs.

## Last run (2026-11-09, sandbox, `--refund-control`)

96 pass, 0 fail, 4 skip. The skips: the browser follow-through of the return destinations, reporting
(403), billing_info on a never-approved subscription, and the failed-renewal values.
