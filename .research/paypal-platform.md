# PayPal platform facts for "PayPal Agentic Wallet" (Tauri desktop)

Researched 2026-10-02 for the "Build What's Next with PayPal and AI" hackathon (Devpost, deadline 2026-11-12).

**Markers**
- **[S]**: sourced from a page or file I actually fetched in this session. URLs are given.
- **[S-spec]**: quoted from PayPal's official OpenAPI spec files at `github.com/paypal/paypal-rest-api-specifications/openapi/*.json`, fetched 2026-10-02. These files generate the developer.paypal.com API reference, so they count as primary sources.
- **[R]**: recalled or inferred, not verified in this session. Treat it as a hypothesis and confirm it in sandbox before you design around it.
- **[CONFLICT]**: two official PayPal sources disagree.

Base URLs: sandbox `https://api-m.sandbox.paypal.com`, live `https://api-m.paypal.com` [S-spec].

---

## 0. The 10 most decision-relevant facts

1. **No developer API lets one consumer send money to another (P2P).** In PayPal, P2P ("Send Money to Friends and Family") exists only in the PayPal and Venmo consumer UIs. In sandbox, personal accounts can use **Send and Request** on `sandbox.paypal.com`, but only by hand [S]. Venmo's developer and payouts APIs are retired for new businesses [R, secondary source]. Every programmatic money movement is either (a) a buyer paying a **merchant** (Orders), with the buyer's approval or a vaulted token, or (b) a **business** paying out from its balance (Payouts).
2. **An agent spending from a user's own PayPal account needs that user's approval in a PayPal-hosted flow at least once.**
   - Per transaction: the buyer opens the Orders `approve` link and the order goes CREATED → APPROVED.
   - Once: the buyer approves a vault setup token, which saves the wallet like a billing agreement. After that, the merchant can charge `payment_source.paypal.vault_id` without the buyer present [S].
   - Vaulting PayPal wallets in **live** needs approval ("must be approved and have your account configured for billing agreements") [S].
3. **Authorize-then-capture is the natural "human approval before capture" primitive.** An authorization is valid for 29 days. Its honor period is 3 days. A void works until the authorization is fully captured. Reauthorization is allowed on days 4–29, up to 115% or +$75 in the US [S-spec]. An order's `approve` link has a 6-hour window by default (configurable to 24, 48 or 72 hours by your account manager) [S-spec].
4. **Payouts work in sandbox but are gated in live.**
   - Live requires a business account, a request for Payouts access, and PayPal's email approval [S].
   - Limits: up to 15,000 items per call; $20,000 per item by default [S]. Unclaimed items return after 30 days [S-spec].
   - Sandbox does **not** support the `PHONE` recipient type, per the spec. The integration guide shows a PHONE example **[CONFLICT]**.
5. **PayPal's AI tooling is merchant-side only.**
   - Agent Toolkit `@paypal/agent-toolkit` is v1.11.0 (2026-09-01) on npm and PyPI. It has 46 tools covering invoices, orders, refunds, disputes, catalog, subscriptions, tracking and reporting [S].
   - It has **no tools for Payouts, Vault, authorize, void or reauthorize, or webhooks** [S, from the source code].
   - The remote MCP server is `https://mcp.sandbox.paypal.com` (sandbox) or `https://mcp.paypal.com` (live), using OAuth login as the merchant [S].
6. **Agent Ready, Store Sync and WebMCP checkout are gated programs, not sandbox APIs.**
   - Access is by request through a form to PayPal's AI team [S].
   - Store Sync covers only physical goods, US customers and USD [S]. Agent Ready's ACP path is **Braintree merchants only** [S]. WebMCP via the JS SDK is "currently limited to Store Sync merchants" [S].
   - Feature (3), the "agent-ready merchant", must therefore be self-built: your own catalog, plus an MCP or HTTP tool surface that creates Orders v2.
7. **The Catalog Products API has no price, inventory or variants.** Fields are id, name, description, type, category, image_url and home_url [S-spec]. It exists mainly to anchor subscription plans. Prices for an agent-callable storefront must live in your own data.
8. **Reporting is laggy and windowed.** `GET /v1/reporting/transactions`: data takes up to 3 hours to appear, the maximum range is 31 days, history goes back 3 years, and `page_size` is at most 500 [S-spec]. The REST app needs the "Transaction Search" permission [R, community sources]. Build the ops cockpit (5) on your own ledger plus webhooks or polling, and use Transaction Search only for after-the-fact reconciliation.
9. **Webhooks need a public HTTPS listener**: 2xx response, port 443, up to 25 retries over 3 days, at most 10 webhook URLs per app [S].
   - Events from the simulator **cannot** be verified with `verify-webhook-signature` [S].
   - A desktop app cannot receive webhooks directly. Use a relay (Render is a hackathon sponsor), a tunnel, or poll `GET /v1/notifications/webhooks-events` [S-spec, endpoint exists].
10. **Sandbox can simulate most of what demos need.**
    - Disputes: buyers open them in the sandbox Resolution Center. `adjudicate` and `require-evidence` are sandbox-only API calls [S].
    - Card declines: put `CCREJECT-*` in the card name [S].
    - API errors: `PayPal-Mock-Response` header with negative testing switched on for Orders and Payments v2 [S].
    - Subscription payment failures have **no documented simulation** [R]. The dunning demo (8) needs a fallback plan.

---

## 1. REST APIs: endpoints, abilities, limits

### 1.1 Orders v2 (`/v2/checkout/orders`), spec v2.32 [S-spec]

| Method | Path | Purpose |
|---|---|---|
| POST | `/v2/checkout/orders` | Create order |
| GET | `/v2/checkout/orders/{id}` | Show order |
| PATCH | `/v2/checkout/orders/{id}` | Update (only `CREATED` or `APPROVED`; not `COMPLETED`) |
| POST | `/v2/checkout/orders/{id}/confirm-payment-source` | Payer confirms intent with a given payment source |
| POST | `/v2/checkout/orders/{id}/authorize` | Authorize (intent=AUTHORIZE) |
| POST | `/v2/checkout/orders/{id}/capture` | Capture (intent=CAPTURE) |
| POST | `/v2/checkout/orders/{id}/track` | Add tracking |
| PATCH | `/v2/checkout/orders/{id}/trackers/{tracker_id}` | Update or cancel tracking |
| POST | `/v2/checkout/orders/order-update-callback` | Shipping or order-update callback |

Source: https://developer.paypal.com/docs/api/orders/v2/ and `checkout_orders_v2.json`.

**Intent and payment source**
- `intent` enum: `CAPTURE` | `AUTHORIZE`, described as "The intent to either capture payment immediately or authorize a payment for an order after order creation." [S-spec]
- Mixing the two fails. Calling `/capture` on an AUTHORIZE order returns 422 `ACTION_DOES_NOT_MATCH_INTENT` [S-spec].
- Order `status` enum: `CREATED, SAVED, APPROVED, VOIDED, COMPLETED, PAYER_ACTION_REQUIRED` [S-spec].
- `payment_source` keys: `card, token, paypal, bancontact, blik, eps, giropay, ideal, mybank, p24, sofort, trustly, apple_pay, google_pay, venmo, crypto` [S-spec].
- `purchase_units`: minimum 1, **maximum 10** per order [S-spec].

**Approval window**, quoted from the spec: "The API caller has 6 hours (default setting, this which can be changed by your account manager to 24/48/72 hours …) from the time the order is created, to redirect your payer. Once redirected, the API caller has 6 hours for the payer to approve the order and either authorize or capture the order." [S-spec]
- Design implication: an approval queue item expires after about 6 hours. Show a countdown.
- Without the JS SDK you must set `return_url`, or the payer sees an error after approving [S-spec].

**Idempotency (`PayPal-Request-Id`)**: "The server stores keys for 6 hours" (up to 72 hours via your account manager). The header is **mandatory for single-step create-order calls**, for example a create with `paypal.vault_id` or a card [S-spec].

**`invoice_id`**: unique per merchant account by default. A duplicate triggers `DUPLICATE_INVOICE_ID` [S-spec]. This gives you a free double-spend guard for the firewall.

**Pay another account**: put `purchase_units[].payee.email_address` (or `merchant_id`) to send funds to a different PayPal account than the app owner. Example from the docs [S]:

```json
{"intent":"CAPTURE","purchase_units":[{"amount":{"currency_code":"USD","value":"15.00"},"payee":{"email_address":"payee@example.com"}}]}
```

Source: https://developer.paypal.com/docs/checkout/standard/customize/pay-another-account/. The page lists no restrictions. Whether refunds, disputes and fees then sit with the payee rather than the app owner is **[R]**; test it.

**`platform_fees`** (marketplace commission) is only for merchants enabled for "PayPal Complete Payments Platform for Marketplaces and Platforms" [S-spec]. You cannot take a cut of an A→B payment in plain sandbox.

**Experience context** (`payment_source.paypal.experience_context`) fields [S-spec]:
- `brand_name`, max 127 characters.
- `shipping_preference`: `GET_FROM_FILE | NO_SHIPPING | SET_PROVIDED_ADDRESS`.
- `return_url` and `cancel_url`.
- `contact_preference`.
- `app_switch_context`, which switches the buyer to the PayPal app.
- `landing_page`.
- `user_action`: PAY_NOW or CONTINUE [R for exact enum].

### 1.2 Authorize → capture / void / reauthorize (Payments v2), spec v2.12 [S-spec]

| Method | Path |
|---|---|
| GET | `/v2/payments/authorizations/{authorization_id}` |
| POST | `/v2/payments/authorizations/{authorization_id}/capture` |
| POST | `/v2/payments/authorizations/{authorization_id}/reauthorize` |
| POST | `/v2/payments/authorizations/{authorization_id}/void` |
| GET | `/v2/payments/captures/{capture_id}` |
| POST | `/v2/payments/captures/{capture_id}/refund` |
| GET | `/v2/payments/refunds/{refund_id}` |
| POST | `/v2/payments/find-eligible-methods` |

Facts, mostly verbatim from the spec or guide:
- **Validity is 29 days and the honor period is 3 days.** "After a successful authorization, capture the payment within the 3-day honor period." [S] https://developer.paypal.com/docs/checkout/standard/customize/authorization/
- After 3 days, capture *may* still succeed within the 29 days, but funds are no longer guaranteed [R; implied by "To ensure that funds are still available, reauthorize…"].
- **Reauthorize**: "Reauthorizes an authorized **PayPal account** payment … after its initial three-day honor period expires … You can reauthorize an authorized payment from 4 to 29 days after the 3-day honor period … in US it is up to 115% of the original authorized amount, not to exceed an increase of $75 USD. Supports only the `amount` request parameter." "If 30 days have transpired … you must create an authorized payment instead." [S-spec]
  - **[CONFLICT]** on how many reauthorizations are allowed. The endpoint description says "you can issue multiple re-authorizations". The `reauthorize_request` schema says "You can reauthorize a payment only once from days four to 29." The guide says multiple, and that each restarts a 3-day honor period [S]. **Design for one reauthorization.**
  - Reauthorize applies to PayPal-account payments. Card authorizations follow different rules [R].
- **Void**: "You cannot void an authorized payment that has been fully captured." [S-spec]
- **Partial or multiple captures**: `final_capture=false` on the capture request allows more captures later [S, WebFetch summary of spec].
- **Refund**: an empty body is a full refund; an `amount` object is a partial refund [S-spec]. A refund time limit (commonly 180 days) is **[R]**.
- **Webhooks**: `PAYMENT.AUTHORIZATION.CREATED` and `PAYMENT.AUTHORIZATION.VOIDED`. VOIDED also fires when the authorization "reaches 30-day validity". There are also `PAYMENT.CAPTURE.COMPLETED/DECLINED/PENDING/REFUNDED/REVERSED` and `PAYMENT.REFUND.PENDING/FAILED` [S] https://developer.paypal.com/api/rest/webhooks/event-names/

**Firewall mapping**
1. The agent creates an AUTHORIZE order.
2. The human approves on PayPal. This is the buyer-side approval.
3. The app authorizes, which places a hold.
4. A **second, local human approval** in the wallet's own UI decides capture or void.
5. The 3-day honor period becomes the SLA for that decision.

### 1.3 Payouts v1, spec v1.9 [S-spec]

| Method | Path |
|---|---|
| POST | `/v1/payments/payouts` (create batch) |
| GET | `/v1/payments/payouts/{id}` |
| GET | `/v1/payments/payouts-item/{payout_item_id}` |
| POST | `/v1/payments/payouts-item/{payout_item_id}/cancel` (only `UNCLAIMED`) |

Facts:
- "You can send up to 15,000 payments per call." [S-spec]
- `recipient_type`: `EMAIL`, `PHONE`, `PAYPAL_ID`, `USER_HANDLE` (a Venmo handle) [S-spec].
  - Spec: "**The PayPal sandbox does not support the `PHONE` recipient type.**"
  - **[CONFLICT]**: the integrate-API guide shows PHONE in its example (https://developer.paypal.com/docs/payouts/standard/integrate-api/). **Use EMAIL in sandbox.**
- `recipient_wallet`: `PAYPAL` (default) | `VENMO`. Venmo payouts are "US using USD only" [S].
- Batch status: `DENIED, PENDING, PROCESSING, SUCCESS, CANCELED`. Item status: `SUCCESS, FAILED, PENDING, UNCLAIMED, RETURNED, ONHOLD, BLOCKED, REFUNDED, REVERSED` [S-spec].
- Payouts are **asynchronous**: "PayPal may process the batch immediately or later. If the status is `PENDING`, check again later." [S]
- **Idempotency**: a `sender_batch_id` reused within 30 days is rejected. After a 5xx you can retry safely with the same `sender_batch_id` [S-spec]. `PayPal-Request-Id` keys are kept 30 days [S-spec].
- **Unclaimed**: if a recipient has no account they get a sign-up link, and funds return after 30 days if unclaimed [S-spec].
- **Limits**: "Each individual payment can be no more than $20,000.00 USD … by default"; "There is no limit on the total amount of the payout". "Payouts are supported in over 156 countries in over 23 currencies." [S] https://developer.paypal.com/payouts/faqs
  - The overview page says "96 countries", "24 currencies" **[CONFLICT, minor]**.
- **Fees**: the sender pays a capped percentage and recipients pay nothing [S, FAQ].
- **Eligibility in live**: needs a business account with confirmed identity, email and linked bank. You "Request access to PayPal Payouts" and "PayPal will email you the decision." [S] https://developer.paypal.com/docs/payouts/standard/
- **Sandbox**: needs a funded sandbox business account [S]. Whether the sandbox app needs a "Payouts" feature toggle is **[R]**.
- **Negative testing**: put an error code such as `ERRPYO002` in the item `note` [S].
- **Webhooks**: `PAYMENT.PAYOUTSBATCH.DENIED/PROCESSING/SUCCESS` and `PAYMENT.PAYOUTS-ITEM.BLOCKED/CANCELED/FAILED/HELD/REFUNDED/RETURNED/SUCCEEDED/UNCLAIMED` [S].

### 1.4 Invoicing v2, spec v2.6 [S-spec]

Endpoints:
- Invoices: `POST/GET /v2/invoicing/invoices`; `GET/PUT/DELETE /v2/invoicing/invoices/{invoice_id}`.
- Invoice actions: `/send`, `/remind`, `/cancel`, `/payments` (record an external payment), `DELETE …/payments/{transaction_id}`, `/refunds`, `DELETE …/refunds/{transaction_id}`, `/generate-qr-code`.
- Utilities: `POST /v2/invoicing/generate-next-invoice-number`; `POST /v2/invoicing/search-invoices`.
- Templates: `GET/POST /v2/invoicing/templates` and `…/{template_id}`, up to 50 templates.
- Accounting sync: `GET /v2/invoicing/accounting-sync/merchant/connections`.

The Agent Toolkit also calls `/v2/invoicing/recurring-invoices…`, `/v2/invoicing/setup-reminders`, `/v2/invoicing/reminders/{id}`, `/v2/invoicing/invoices/{id}/cancel-reminders` and `/v2/invoicing/invoices/{id}/conditional-rules`. These are **not in the public spec file** [S, from toolkit source]. They may be newer or private; verify in sandbox.

Limits [S-spec]:
- "API caller can send only 2 reminders in a day."
- The recipient can be changed "only 2 times in 72 hours".
- Partial payment via `allow_partial_payment` and `minimum_amount_due`.

Statuses include DRAFT, SENT, SCHEDULED, PAID, PARTIALLY_PAID, REFUNDED, PARTIALLY_REFUNDED, CANCELLED [S-spec, approximate list].

Webhooks: `INVOICING.INVOICE.CREATED/UPDATED/SCHEDULED/CANCELLED/PAID/REFUNDED` [S].

**Why it matters:** an invoice is the only built-in "request money" primitive. A merchant (user B) asks a payer (user A) by email, and A pays through a PayPal-hosted page with a human in the loop. It is useful for the haggling-settlement path (9).

### 1.5 Subscriptions (Billing plans and subscriptions v1), spec v1.8 [S-spec]

Plans:
- `POST/GET /v1/billing/plans`
- `GET/PATCH /v1/billing/plans/{id}`
- `POST …/{id}/activate`, `POST …/{id}/deactivate`
- `POST …/{id}/update-pricing-schemes`

Subscriptions:
- `POST /v1/billing/subscriptions`
- `GET/PATCH /v1/billing/subscriptions/{id}`
- `POST …/{id}/revise` (plan or quantity), `POST …/{id}/suspend`, `POST …/{id}/cancel`, `POST …/{id}/activate`
- `POST …/{id}/capture`
- `GET …/{id}/transactions`

Statuses: `APPROVAL_PENDING, APPROVED, ACTIVE, SUSPENDED, CANCELLED, EXPIRED` [S-spec]. A new subscription needs the **subscriber's approval** on PayPal; `approve` is a HATEOAS link [R for exact link name].

Dunning facts:
- **Retries**: failed payments are retried "every 5 days", "up to twice per billing cycle" [S] https://developer.paypal.com/docs/subscriptions/customize/payment-failure-retry/
- **Threshold**: `payment_preferences.payment_failure_threshold`. "if `payment_failure_threshold` is `2`, the subscription automatically updates to the `SUSPEND` state if two consecutive payments fail." [S-spec]
- `billing_info.failed_payments_count` holds "consecutive payment failures. Resets to `0` after a successful payment." [S-spec]
- `failed_payment_details.next_payment_retry_time` is exposed [S-spec].
- `auto_bill_outstanding` decides whether "to automatically bill the outstanding amount in the next billing cycle" [S-spec].
- **Collecting the balance**: `POST /v1/billing/subscriptions/{id}/capture` with `capture_type: "OUTSTANDING_BALANCE"`. The amount cannot exceed the current outstanding balance [S-spec, S].
- **Price changes**: "Any price update will not impact billing cycles within next 10 days (Applicable only for subscriptions funded by PayPal account)." [S-spec]

Webhooks [S]:
- `BILLING.SUBSCRIPTION.CREATED/ACTIVATED/UPDATED/EXPIRED/CANCELLED/SUSPENDED/PAYMENT.FAILED`
- `PAYMENT.SALE.COMPLETED/DENIED/PENDING/REFUNDED/REVERSED`. Recurring charges arrive as v1 "sale" events, not v2 captures [R; the event list is S].
- `BILLING.PLAN.CREATED/UPDATED/ACTIVATED/DEACTIVATED/PRICING-CHANGE.ACTIVATED`

**Perspective gotcha:** this API manages subscriptions **you sell as a merchant**. No API lets a consumer list or cancel their automatic payments to *other* merchants. Consumers do that in the PayPal UI. They may cancel "3 Business Days or more before the date of the next scheduled payment" [S, User Agreement]. Feature (8) is therefore merchant-side dunning for the small merchant's own subscribers. A consumer-side "find and rescue my subscriptions" cannot be built on PayPal APIs.

### 1.6 Disputes v1, spec v1.11 [S-spec]

Endpoints:
- `GET /v1/customer/disputes` (list); `GET` and `PATCH /v1/customer/disputes/{id}`
- `POST /v1/customer/disputes/{id}/` followed by one of: `provide-evidence`, `appeal`, `accept-claim`, `escalate`, `send-message`, `make-offer`, `accept-offer`, `deny-offer`, `acknowledge-return-item`, `provide-supporting-info`
- **Sandbox only**: `adjudicate` and `require-evidence`

Facts:
- `adjudicate` is "for sandbox use only … Settles a dispute in either the customer's or merchant's favor". It requires status `UNDER_REVIEW` and the link in HATEOAS [S-spec].
- `require-evidence` is sandbox only. It moves a dispute from `UNDER_REVIEW` to `WAITING_FOR_BUYER_RESPONSE` or `WAITING_FOR_SELLER_RESPONSE` [S-spec].
- `send-message` works only in the `INQUIRY` stage. `provide-supporting-info` works only in `CHARGEBACK`, `PRE_ARBITRATION` or `ARBITRATION` [S-spec].
- "In the live environment, merchants cannot create disputes … merchants can create disputes in the sandbox environment. When you create an app, enable Disputes in the App feature options section." [S-spec]
- **Creating a dispute in sandbox through the API** (`POST /v1/customer/disputes`, multipart) needs the `DISPUTE_CREATE` scope enabled **by your account manager**, plus a `PayPal-Auth-Assertion` JWT and buyer consent via Log in with PayPal [S] https://developer.paypal.com/platforms/disputes/test-go-live. This is not realistic for a hackathon.
- **Practical sandbox path** [S, same page]:
  1. Log in as the sandbox **personal** buyer.
  2. Open the Resolution Center at `https://www.sandbox.paypal.com/disputes/dashboard/`.
  3. Open an INR or SNAD case.
  4. Then use list, show, provide-evidence, accept-claim, require-evidence and adjudicate from the app.
- For a transaction eligible for **chargeback**, the buyer must fund it with a credit card [S].
- **Timelines** [S] https://developer.paypal.com/docs/disputes/integration-guide/
  - The buyer has 180 days from payment to dispute.
  - The inquiry stage lasts 20 days.
  - PayPal adjudicates within 10 days of escalation.
  - The page also says merchants can "issue a refund within 20 hours without fulfilling the order to avoid the chargeback".
- **Stages**: INQUIRY → CHARGEBACK / PRE_ARBITRATION / ARBITRATION. **Statuses**: OPEN, UNDER_REVIEW, RESOLVED, WAITING_FOR_BUYER_RESPONSE, WAITING_FOR_SELLER_RESPONSE [S] https://developer.paypal.com/docs/disputes/disputes-reference/
- **Webhooks**: `CUSTOMER.DISPUTE.CREATED/UPDATED/RESOLVED` [S].
- The seller's response deadline (`seller_response_due_date`, about 10 days) is **[R]**.

### 1.7 Transaction Search / Reporting v1, spec v1.9 [S-spec]

Endpoints: `GET /v1/reporting/transactions` and `GET /v1/reporting/balances`. The reference page also lists `GET /v1/reporting/get-balance-net-summary` and `GET /v1/reporting/get-daily-summary`, which are **not in the spec file** [S, reference page].

Facts, quoted verbatim from the spec:
- "It takes a maximum of three hours for executed transactions to appear in the list transactions call."
- "This call lists transaction for the previous three years."
- "The maximum supported range is 31 days."
- `page_size` maximum is 500.
- `fields` takes `transaction_info, payer_info, shipping_info, auction_info, cart_info, incentive_info, store_info` or `all`.
- Balances: "It takes a maximum of three hours for balances to appear"; `as_of_time` is supported.

Permissions [R, community and troubleshooting sources]:
- The REST app needs the **Transaction Search** feature enabled in the dashboard.
- The OAuth scope is `https://uri.paypal.com/services/reporting/search/read`.
- The cached token must be refreshed after enabling, because tokens live about 8.8–9 hours.

Sandbox behaviour [R]: sandbox reporting is often slower or less complete than live. **Never make the demo depend on a just-made transaction appearing here.**

The Agent Toolkit's `list_transactions` tool works around the 31-day cap by looping back month by month, up to 12 months, to find a transaction ID [S, toolkit source]. That costs N API calls, and rate limits apply.

### 1.8 Catalog Products v1, spec v1.0 [S-spec]

Endpoints: `POST/GET /v1/catalogs/products`; `GET/PATCH /v1/catalogs/products/{product_id}`. There is **no DELETE**.

Fields: `id, name, description, type (PHYSICAL|DIGITAL|SERVICE, default PHYSICAL), category, image_url, home_url, create_time, update_time`. There is **no price, stock, SKU variants or currency** [S-spec].

Purpose: anchoring billing plans. It is **not a storefront catalog.**

### 1.9 Vault v3 (payment method tokens), spec v3.4 [S-spec]

| Method | Path |
|---|---|
| POST | `/v3/vault/setup-tokens` (temporary; payer approves) |
| GET | `/v3/vault/setup-tokens/{id}` |
| POST | `/v3/vault/payment-tokens` (convert to a permanent token) |
| GET | `/v3/vault/payment-tokens?customer_id=…` |
| GET/DELETE | `/v3/vault/payment-tokens/{id}` |

**Save a PayPal wallet without a purchase** [S] https://developer.paypal.com/docs/checkout/save-payment-methods/purchase-later/payment-tokens-api/paypal/
1. Create a setup token with `payment_source.paypal`: `usage_pattern` (e.g. `IMMEDIATE`), `usage_type: MERCHANT`, `customer_type: CONSUMER`, `permit_multiple_payment_tokens` (default false), `description` shown to the payer, and `experience_context.return_url/cancel_url`.
2. The response status is `PAYER_ACTION_REQUIRED`. It includes `customer.id`, and **the setup token expires in 3 days**. It also includes an `approve` link for the payer and a `confirm` link.
3. Convert it to a payment token.
4. **Charge later without the buyer present**: `POST /v2/checkout/orders` with `payment_source.paypal.vault_id`. `PayPal-Request-Id` is mandatory for this single-step call [S-spec].

Other facts:
- **Save during purchase**: add `payment_source.paypal.attributes.vault: {store_in_vault: "ON_SUCCESS", usage_type: "MERCHANT"|"PLATFORM"}` to the order. The response has `vault.id`, `vault.status` (`VAULTED` or `APPROVED`) and `vault.customer.id` [S] https://developer.paypal.com/docs/checkout/save-payment-methods/during-purchase/orders-api/paypal/
- **`usage_pattern` enum**: `IMMEDIATE, DEFERRED, RECURRING_PREPAID, RECURRING_POSTPAID, THRESHOLD_PREPAID, THRESHOLD_POSTPAID, SUBSCRIPTION_PREPAID, SUBSCRIPTION_POSTPAID, UNSCHEDULED_PREPAID, UNSCHEDULED_POSTPAID, INSTALLMENT_PREPAID, INSTALLMENT_POSTPAID`, described as "Expected business/pricing model for the billing agreement" [S-spec].
  - `UNSCHEDULED_*` and `THRESHOLD_*` fit "agent tops up or buys when needed".
- **Stored credential**: `payment_source.paypal.stored_credential.payment_initiator` = `CUSTOMER | MERCHANT`, plus `usage` and `usage_pattern` [S-spec]. Mark agent-triggered charges as `MERCHANT` (merchant-initiated).
- **Eligibility**: 36 countries; PayPal wallets, cards and Venmo [S].
  - Live: "Enable PayPal vaulting in your Developer Dashboard for production" and "You must be approved and have your account configured for billing agreements" [S].
  - Sandbox: tick "Accept payments" and "Vault" in the sandbox app settings [S].
- **Risk data**: "PayPal requires Risk Data Acquisition (RDA) … for all customer-initiated transactions (CIT) that use PayPal and Venmo Payment Tokens", via FraudNet or Magnes [S]. A Tauri webview can probably load FraudNet JS [R].
- **Webhooks**: `VAULT.PAYMENT-TOKEN.CREATED/DELETED/DELETION-INITIATED` [S].

**What vaulting allows an agent to do:** after one human approval, the app (as the merchant that owns the token) can charge the user's PayPal wallet repeatedly, at any amount, with no PayPal-side prompt. The token can only pay **the merchant that vaulted it**: `usage_type: MERCHANT` [S]. Using `PLATFORM` to pay other payees needs partner onboarding [R].

So a vaulted token lets "my wallet app" pull money from the user into **the app owner's** business account. It does not let the agent spend at arbitrary third-party merchants. PayPal enforces no budget on the token, so **the spend firewall must be your own code.** The `description` text shown at approval is the only consent copy PayPal displays.

### 1.10 Webhooks v1, spec v1.11 [S-spec]

Endpoints:
- `POST/GET /v1/notifications/webhooks`; `GET/PATCH/DELETE …/webhooks/{webhook_id}`; `GET …/{webhook_id}/event-types`
- `POST/GET /v1/notifications/webhooks-lookup` and `…/{id}`
- `POST /v1/notifications/verify-webhook-signature`
- `GET /v1/notifications/webhooks-event-types`
- **`GET /v1/notifications/webhooks-events`**, filterable by `start_time/end_time/transaction_id/event_type/page_size`; `GET …/webhooks-events/{event_id}`; `POST …/{event_id}/resend` ("Any pending notifications are not resent")
- `POST /v1/notifications/simulate-event`

Facts [S] https://developer.paypal.com/api/rest/webhooks/ and https://developer.paypal.com/api/rest/webhooks/rest/
- "Up to 10 webhook URLs may be subscribed per app." `*` subscribes a URL to all events.
- PayPal retries "up to 25 times over the course of 3 days" until it gets a 2xx. The listener must be HTTPS on port 443.
- **Verification**, two options:
  - Postback to `verify-webhook-signature` with `auth_algo, cert_url, transmission_id, transmission_sig, transmission_time, webhook_id, webhook_event`.
  - Self-verify: CRC32 of the body, then message `transmissionId|timeStamp|webhookId|crc32`, checked with SHA256 against the cert from `PAYPAL-CERT-URL`.
- **Simulator**: "Postback verification … is not supported for mock events". Mock events use webhook id `WEBHOOK_ID`.
- Webhook `url` is format `uri`, max 2048 characters [S-spec]. Whether `http://localhost` is accepted at registration is **[R]**. PayPal cannot reach it anyway.

### 1.11 Shipment tracking v1, spec v1.9 [S-spec]

Endpoints:
- `POST /v1/shipping/trackers-batch`
- `POST /v1/shipping/trackers`
- `GET /v1/shipping/trackers` (by `transaction_id`)
- `GET/PUT /v1/shipping/trackers/{id}`

On Orders v2 integrations, prefer `POST /v2/checkout/orders/{id}/track` [S-spec]. Tracking data helps win INR disputes [R].

### 1.12 Auth and rate limits

- **OAuth**: `POST /v1/oauth2/token` with `grant_type=client_credentials` and Basic(client_id:secret). The example response has `expires_in: 31668`, about 8.8 hours [S] https://developer.paypal.com/api/rest/authentication/
- "Client secrets should not be embedded in client-side applications" [S]. This is directly relevant to a Tauri app (see §6).
- **Rate limits**: "While we do not publish a rate limiting policy, we might temporarily rate limit if we identify traffic that appears to be abusive." The error is HTTP 429 `RATE_LIMIT_REACHED`. PayPal recommends webhooks over polling and caching OAuth tokens [S] https://developer.paypal.com/api/rest/reference/rate-limiting/
- **Log in with PayPal** (OIDC) shares "basic, non-financial account information … name, email, and address", plus payer_id and verified status. It grants **no payment permissions** [S] https://developer.paypal.com/docs/log-in-with-paypal/
  - Use it to bind a wallet user to their PayPal email or payer_id, for example to set them as `payee`.

---

## 2. The money-direction question: how can a user's agent spend?

A REST app (client_id/secret) **is a merchant account**. Its credentials act on the app owner's business account. Options for an end user's agent to move the user's money:

| # | Mechanism | Human in loop? | Who receives | Sandbox | Live gating |
|---|---|---|---|---|---|
| A | Orders v2 + `approve` link or JS SDK popup (CAPTURE or AUTHORIZE) | **Yes, per payment** | App owner, or any account via `payee` | Yes [S] | None beyond a standard business account |
| B | Vault v3 PayPal wallet (setup token → payment token → orders with `vault_id`) | **Once**, at vaulting | Only the merchant that vaulted (`usage_type: MERCHANT`) | Yes, with Vault ticked in the app [S] | Approval for billing agreements and vaulting [S] |
| C | Subscriptions | Once per subscription | The plan's merchant | Yes | Standard |
| D | Payouts from a **business** balance | No | Any email or PayPal ID; Venmo is US-only | Yes, with a funded sandbox business account [S] | Access request and approval [S]; use-case review [R] |
| E | Invoicing (B invoices A) | Yes; A pays on a PayPal page | The invoicing merchant | Yes | Standard |
| F | Consumer "Send Money" (F&F or G&S) | Yes; manual UI only | Any account | Manual on sandbox.paypal.com [S] | **No API** |

**Is there any P2P send-money API for developers?** **No.**
- The PayPal Send Money feature is a consumer UI feature [S, User Agreement describes it as "the Send Money feature in your PayPal account"]. No REST endpoint exists in the public spec set (13 spec files checked: subscriptions, catalog, orders, disputes, partner-referrals, invoicing, webhooks, web-experience, payments, payouts, reporting, tracking, vault) [S-spec].
- Venmo developer and payouts APIs are retired for new businesses. Venmo is reachable only as (a) a checkout payment source and (b) a Payouts `recipient_wallet: VENMO` (US/USD) [S for (b); R for the retirement, from vorplabs.com and secondary search].

**What is realistic in sandbox for two independent users (A and B) of the same desktop app paying each other?**

- **Option 1: "Each user is a merchant". This is the most honest model.**
  - Each user creates or uses their own sandbox **business** account and REST app, and pastes the client_id/secret into their local wallet. Each wallet is then a merchant in its own right.
  - When A's agent pays B: **B's** app creates an order (B as merchant) or an invoice. A's wallet opens the approve link. A's human or policy approves by logging in to PayPal as A. B captures.
  - Business accounts can act as buyers [R]. In sandbox you can also give each user a *personal* account for paying.
  - The human is in the loop on every payment, unless A has previously vaulted their wallet **with B as the merchant**, which is a per-counterparty billing agreement.
- **Option 2: "Platform app pays another account".**
  - One shared app (the hackathon project's own sandbox credentials, held on a relay server, not in the desktop binary) creates the order with `payee.email_address = B` and A approves.
  - It is simple and demoable, but money flows A → B *through the platform's app*, and live use needs platform or marketplace onboarding [R].
- **Option 3: "Business balance push" via Payouts.**
  - A's agent sends funds from A's **business** sandbox balance to B's email. It is fully programmatic with no per-payment approval, which makes it the best "agent settles autonomously" demo.
  - Caveats: in live this is gated, it is meant for commissions, rebates, rewards and disbursements [S-spec description], and it carries no buyer protection [R].
  - Running consumer-to-consumer flows through it is a money-service-business pattern; see §5.

**Recommended framing for (9), haggling:**
1. The agents negotiate locally.
2. The settlement is an **AUTHORIZE order or invoice that B issues and A's human approves**. In sandbox this means logging in as A.
3. Optionally, use Payouts for "seller refunds the haggled difference" or business-to-business settlement.

Present it as "agents negotiate, PayPal settles with a human approval", not "agents move money P2P".

---

## 3. PayPal AI and agent offerings (as of 2026-10-02)

### 3.1 Agent Toolkit

- npm `@paypal/agent-toolkit` is **v1.11.0, published 2026-09-01**. It was first published 2025-04-02 [S, npm registry].
- PyPI `paypal-agent-toolkit` is **v1.11.0** [S].
- Repo: https://github.com/paypal/agent-toolkit (about 195 stars; last push 2026-09-01) [S].
- Framework adapters in `typescript/src/`: `ai-sdk` (Vercel), `openai` (Agents SDK), `langchain`, `bedrock` (AWS), `modelcontextprotocol` [S, repo tree]. The README also mentions CrewAI for Python [R].
- Requires Node 18+. It takes `clientId` and `clientSecret`, or `PAYPAL_ACCESS_TOKEN`. The environment is `SANDBOX` by default or `PRODUCTION` [S].
- Configuration: `actions: { [product]: { [action]: boolean } }` gates which tools are exposed. Context accepts `sandbox`, `merchant_id`, `access_token`, `request_id`, `tenant_context` and `debug` [S, configuration.ts].
- Disclaimer: "AI-generated content may be inaccurate or incomplete." [S]

**Complete tool list in v1.11.0 source (46 methods)** [S, `typescript/src/shared/tools.ts`]:
- **Invoices (22)**: `create_invoice, create_recurring_series, activate_recurring_series, get_recurring_series, cancel_recurring_series, delete_recurring_series, list_invoices, get_invoice, send_invoice, send_invoice_reminder, cancel_sent_invoice, delete_invoice, setup_invoice_auto_reminders, update_invoice_auto_reminder, search_invoicing, update_invoicing, cancel_invoice_auto_reminder, generate_invoice_qr_code, generate_invoice_number, record_payment_for_invoice, record_refund_for_invoice, create_conditional_rules_for_invoice`
- **Products (4)**: `create_product, list_products, update_product, show_product_details`
- **Subscriptions (8)**: `create_subscription_plan, list_subscription_plans, show_subscription_plan_details, update_plan, create_subscription, show_subscription_details, cancel_subscription, update_subscription`
- **Tracking (2)**: `create_shipment_tracking, get_shipment_tracking`. The docs page also lists `update_shipment_tracking` [S, docs]; it is absent from the source list.
- **Orders and payments (5)**: `create_order, get_order, pay_order` (this **captures** an already approved order; there is no authorize), `create_refund, get_refund`
- **Disputes (3)**: `list_disputes, get_dispute, accept_dispute_claim`. There is **no provide_evidence**.
- **Reporting (2)**: `list_transactions`, and `get_merchant_insights`, which calls `/v1/merchant/insights`, an endpoint not in the public spec [S, source]. Sandbox behaviour is **[R]**.

**Not covered**: Payouts, Vault, authorize/void/reauthorize, webhooks, provide-evidence, subscription suspend/activate/capture-outstanding. **You must call REST directly for the firewall, payouts and dunning features.** The toolkit is fine for the merchant cockpit.

### 3.2 PayPal MCP servers

Source: https://developer.paypal.com/ai-tools/mcp-server and https://developer.paypal.com/tools/mcp-server/ [S]
- **Remote**: `https://mcp.sandbox.paypal.com` (sandbox) and `https://mcp.paypal.com` (live). Transports are SSE at `/sse` and Streamable HTTP at `/http`. Auth is **OAuth: the merchant logs in to PayPal and authorizes the client**. Claude, Cursor and Cline are named as clients. Known issue: Windows plus Cursor can fail to connect remotely.
- **Local**: `npx -y @paypal/mcp --tools=all` with `PAYPAL_ACCESS_TOKEN` and `PAYPAL_ENVIRONMENT=SANDBOX|PRODUCTION`, or `--access-token`. npm `@paypal/mcp` is **v1.8.1, last published 2025-10-28** [S, npm], so it is stale relative to the toolkit.
  - **Gotcha** [R, from the token lifetime fact]: the token is a raw OAuth access token lasting about 9 hours, so a long-running local MCP needs a refresher.
- **Tools**: the same catalog as the toolkit, listed at https://developer.paypal.com/ai-tools/agent-tools/ [S].
- **Remote-only "commerce" tools**: `search_product` (gift cards), `create_cart` and `checkout_cart`. They require the header `x-feature-flags: commerce:true`. Added 2025-07-02: "Starting with gift cards…" [S] https://developer.paypal.com/community/blog/expanding-paypal-mcp-capabilities/
  - Whether they work in sandbox is **[R]**, and their availability in 2026 is unconfirmed.

### 3.3 Agentic Commerce Services: Agent Ready, Store Sync, WebMCP

- **Overview** [S] https://developer.paypal.com/agentic-commerce-services/about
  - Components: Agent Ready, plus Store Sync (catalog and cart operations).
  - Partners: Wix, Cymbio, Commerce (BigCommerce & Feedonomics), Shopware.
  - **Access**: "complete this form to contact the AI team at PayPal and request access" (https://www.paypal.com/us/business/ai#form).
- **Agent Ready** [S] https://developer.paypal.com/agent-ready/overview: "helps **Braintree merchants** accept payments from AI shopping assistants across major platforms, including ChatGPT, Google AI Mode, and Gemini". It supports two protocols:
  - **ACP** (OpenAI Agentic Commerce Protocol). ChatGPT Instant Checkout returns a delegated, single-use payment token "bound to your merchant ID and includes amount and time restrictions" (`max_amount`, `expires_at`). Your MCP server's `complete_checkout` tool receives it and charges via Braintree `transaction.sale()`. "Only Braintree merchants can currently use ACP." Testing uses `payment_mode: "test"` and ChatGPT developer mode [S] https://developer.paypal.com/agent-ready/agentic-commerce-protocol
  - **UCP** (Google Universal Commerce Protocol). It goes through the Google Pay handler via Braintree, which returns single-use tokens [S].
  - The press release (2025-10-28) said Agent Ready would be "available in early 2026" for "millions of existing PayPal merchants" [S] https://newsroom.paypal-corp.com/2025-10-28-PayPal-Launches-Agentic-Commerce-Services-to-Power-AI-Driven-Shopping. The 2026 docs scope it to Braintree.
- **Store Sync** [S] https://developer.paypal.com/store-sync/overview
  - It "connects your product catalog and commerce API … enabling AI agents to discover your products, create and manage shopping carts, and complete purchases."
  - Limits: **physical goods only; no digital or subscription products; US customers in USD**.
  - Requires an Orders v2 or Braintree integration.
- **Catalog feed** [S] https://developer.paypal.com/store-sync/create-catalog/
  - Formats: CSV, TSV or PSV, optionally GZ or ZIP containing one file; max 4 GB; UTF-8 with a header row.
  - Three specs: Google Product Feed, OpenAI ACP Product Feed, PayPal Enhanced Shopping Feed.
  - Required fields include id, title, link, image, description (at least 25 characters), price ("19.99 USD") and availability.
  - **Useful as a schema model for the self-built "agent-ready merchant" (3).**
- **WebMCP** [S] https://developer.paypal.com/community/blog/WebMCP_PayPal_Agent_Ready (2026-09-16)
  - Described as "a proposed open web standard" for assistants to call site capabilities. Chrome, Edge and the ChatGPT desktop browser are named as adding support.
  - PayPal extends WebMCP "through the PayPal JavaScript SDK", "currently limited to Store Sync merchants".
  - The flow: the agent searches, builds the cart and initiates checkout, then "the buyer is then handed off to PayPal to sign in". A human approves at the end.
  - Internal benchmark: about 4.6× less inference cost and about 2× faster. The post gives no code.
- **ChatGPT**: PayPal and OpenAI announced on 2025-10-28 that PayPal wallets would be usable in ChatGPT in 2026 via ACP, with PayPal handling merchant routing [S] https://techcrunch.com/2025/10/28/paypal-partners-with-openai-to-let-users-pay-for-their-shopping-within-chatgpt. A secondary source says Instant Checkout launched 2026-02-16 for US users **[R]**.
- **Perplexity**: partnership announced May 2025. "Instant Buy" with PayPal launched Nov 2025 [R, from search results: PayPal newsroom 2025-11 and CNBC 2025-11-19].
- **Microsoft Copilot Checkout** (2026): merchants surface catalogs and check out with PayPal inside Copilot [R, search summary].
- **Google AP2**:
  - PayPal was a launch partner on 2025-09-16.
  - PayPal's blog describes AP2 mandates. A **Cart Mandate** is signed by the merchant and the user. An **Intent Mandate** is a user pre-approval of "budget, product categories, or timing". A **Payment Mandate** is derived and appended to the authorization.
  - PayPal promised "APIs and adapters for mandate creation and storage", but **no public AP2 API from PayPal is documented** [S] https://developer.paypal.com/community/blog/PayPal-Agent-Payments-Protocol/
  - AP2 itself is open source (Apache 2.0, google-agentic-commerce/AP2) [R].
  - **The Intent Mandate is a good vocabulary for the spend-firewall policy object (1)**: implement it locally and cite AP2.
- **"Agent tokens"**: PayPal's blog (2025-08-04) describes "PayPal wallet users with preconfigured agent tokens", "without preconfigured tokens", and "guest users via temporary agents". **No API, docs or sandbox exist for this** [S] https://developer.paypal.com/community/blog/enabling-agentic-payments/. Do not design around PayPal agent tokens.
- **Mastercard Agent Pay** integrates the PayPal wallet [R, secondary source]. It is not developer-accessible.
- **2026 events**: "PayPal Beyond" (2026-04-15) brought an NVIDIA partnership for agentic commerce infrastructure, with no developer API announced [S] https://newsroom.paypal-corp.com/2026-04-15-The-Moment-Is-Now-What-PayPal-Beyond-Revealed-About-the-Future-of-Commerce. I found no "Dev Days 2026" developer announcements. Dev Days 2025 (2025-04-29) launched the remote MCP and Agent Toolkit [S, search results].
- **PayPal developer blog 2026 posts on this topic** [S] https://developer.paypal.com/community/blog/
  - Hackathon (2026-09-30)
  - WebMCP (2026-09-16)
  - Customer Graph knowledge graph (2026-07-22)

### 3.4 Hackathon rules relevant to design [S] https://paypalaihackathon.devpost.com/ and /rules

- You must "integrate the PayPal developer platform (**using the free sandbox environment**) along with an AI tool, model, or platform". Both must be "meaningful": "a working, non-trivial implementation".
- Deadline: **Thu 2026-11-12, 2:00 pm Pacific**. Judging runs 2026-11-13 to 2026-12-15. Winners are announced 2026-12-21 [S, blog].
- Required submissions:
  - A video **under 3 minutes**, on YouTube and public.
  - A **public GitHub repo with an open-source license** file.
  - "a link to a website, functioning demo, or a test build" with "complete setup and run instructions" and **credentials needed for evaluation**.
- Criteria, equally weighted: Technological Implementation, Design, Potential Impact, Innovation/Idea, Presentation.
- Prizes:
  - Overall: $12k, $8k and $5k.
  - Category awards of $5k each, including **"Best Use of Agentic Commerce"** and "Best Use of PayPal + AI".
  - Sponsor awards: AG Grid, APIMatic, Bryntum, Channel3, Elastic, Postman, Render, Zapier.
- There are no tracks.
- **A desktop Tauri app needs a downloadable build or reproducible build instructions.** Judges will use their own sandbox credentials or ones you provide.

---

## 4. Sandbox realities

- **Default accounts**: registering creates "a business account and associated API test credentials" and "a default personal account", with emails `sb-xxxx@business.example.com` and `sb-xxxx@personal.example.com` [S] https://developer.paypal.com/tools/sandbox/accounts/
- **More accounts**: create them under Sandbox → Accounts → Create Account (quick or custom). You can edit the PayPal balance, country, and so on. No maximum count is documented [S].
- **Logins**: log in at `https://www.sandbox.paypal.com` with the generated email and password; you can change the password in the dashboard [S]. Two wallet users means two personal accounts, and two business accounts if each is a merchant.
- **Unsupported in sandbox**: "closing an account, issuing monthly statements, storing shipping preferences, and PayPal Shops support" [S] https://developer.paypal.com/tools/sandbox/
- **Negative testing**:
  - Switch it on per sandbox business account (View/Edit → Settings → Negative Testing). It is sandbox only [S] https://developer.paypal.com/tools/sandbox/negative-testing/
  - Header: `PayPal-Mock-Response: {"mock_application_codes":"DUPLICATE_INVOICE_ID"}` (or `INSTRUMENT_DECLINED` and others [R for the list]).
  - It applies to **Payments v1, Payments v2 (authorize, capture, void, refund) and Orders v2 (create, update, get, authorize, capture)** [S] https://developer.paypal.com/tools/sandbox/negative-testing/request-headers/
  - Payouts use test values in `note`, such as `ERRPYO002` [S].
- **Cards**: the sandbox card generator; name the card `CCREJECT-REFUSED`, `CCREJECT-EC` and so on (case-sensitive) to force declines; 3DS test cards exist [S] https://developer.paypal.com/tools/sandbox/card-testing/
- **Disputes**: the buyer creates them in the sandbox Resolution Center. Sandbox-only `adjudicate` and `require-evidence` drive the lifecycle. Creating disputes through the API needs scope enablement by an account manager (§1.6) [S].
- **Subscriptions failure simulation**: no documented method [R]. Ideas, all unverified:
  - Create the subscription with a sandbox buyer funded by a `CCREJECT` card.
  - Use a 1-DAY billing interval (the minimum interval is a day [R]).
  - Fall back to `simulate-event BILLING.SUBSCRIPTION.PAYMENT.FAILED` (unverifiable mock) or local replay of recorded payloads.
- **Reporting**: up to 3 hours of lag, even in sandbox [S-spec says "maximum of three hours"; sandbox reality R]. Sandbox balances via `/v1/reporting/balances` are similarly delayed [S-spec].
- **Payouts**: work with a funded sandbox business account. Use the EMAIL recipient type (PHONE is unsupported per the spec). The flow is async: poll `GET /v1/payments/payouts/{id}` or subscribe to webhooks [S].
- **Rate limits**: unpublished; 429 `RATE_LIMIT_REACHED` [S].

**Webhook delivery to a desktop app**, since PayPal requires public HTTPS on port 443 [S]:
1. **Relay** (recommended): a tiny service on Render (a hackathon sponsor with a prize) or similar receives the webhook, verifies it (postback or CRC32), and fans it out to the desktop over SSE or WebSocket. The desktop authenticates to the relay. The relay can also hold the platform client_secret (§6).
2. **Tunnel**: ngrok or Cloudflare Tunnel to localhost. The URL changes per run unless you pay or use a named tunnel, and you must PATCH the webhook URL each time (`PATCH /v1/notifications/webhooks/{id}`, `replace /url`) [S-spec].
3. **Polling**: `GET /v1/notifications/webhooks-events?start_time=…&event_type=…` lists event notifications [S-spec]. Whether events are recorded when the registered URL is unreachable is **[R]**; it probably works because delivery status is tracked per event.
   - Alternatively, poll resources directly: `GET /v2/checkout/orders/{id}`, `/v1/payments/payouts/{id}`, `/v1/billing/subscriptions/{id}`, `/v1/customer/disputes?update_time_after=…` [R for the exact filter name].
   - Polling plus no listener is the most robust option for judges running the build locally.

---

## 5. Acceptable Use Policy and User Agreement points relevant to agents and P2P

**AUP**, last updated 2022-10-29 and still current [S] https://www.paypal.com/us/legalhub/paypal/acceptableuse-full

Prohibited activities:
- Transactions "by payment processors to collect payments on behalf of merchants" (prohibited (e)).
- Pyramid or ponzi schemes.
- Items sold "before the seller has control or possession of the item".
- Currency exchanges.
- Bribery.
- Anything requiring pre-approval without having it.

Pre-approval required:
- **#4 Payment Facilitator**: "Providing payment services which would fall under the definition of a **money service business** or an electronic money institution. Services would also include the sale of stored value cards and **escrow services**." A wallet app that holds funds or routes consumer-to-consumer money is in this zone. **Do not hold user funds in an app-owned balance.** Escrow-like "haggle then hold" flows need pre-approval in live.
- **#6 Gambling, gaming, prize draws and contests**. Note this for agent-negotiation "games".
- **#7 Cryptocurrency** (including in-game currencies and NFTs).
- **#11 Online Dating**.
- **#18 Marketplaces**: "an e-commerce solution where third-party sellers can sell their products or services to customers". **A multi-seller agent-ready storefront or two-user trade app counts as a marketplace and needs pre-approval in live.**

**User Agreement**, last updated 2026-09-14 [S] https://www.paypal.com/us/legalhub/paypal/useragreement-full
- **Automatic payments**: "When you store PayPal as a payment method with a specific seller, you agree with the seller that they can use PayPal to request payment for future transactions…". This covers "billing agreement," "subscription," "recurring payment," "reference transaction," "preauthorized transfer," and "preapproved payment".
  - **Variable recurring amounts give the user the right to advance notice "at least 10 days before the transfer"**, unless the user chose range-based notice. This affects agent-initiated variable charges on a vaulted wallet.
  - Users can cancel recurring automatic payments "3 Business Days or more before" the next payment.
- **Friends and Family vs Goods and Services**: "You must not send money as a personal transaction … when you are paying for goods or services." Sellers must "Not ask your buyer to send you money as a personal transaction". The haggling agent must settle goods and services as a **commercial** transaction (Orders or invoice), never as F&F.
- **Business account misuse**: "You may not establish a PayPal business account primarily for personal, family, or household purposes." The "each user is a merchant" model is a sandbox convenience. In live, consumer users would not each have business accounts.
- **Automated access**: "use any robot, spider, other automatic device … to monitor or copy our websites without our prior written permission" is prohibited. **No browser automation of paypal.com by agents.** Use APIs only.
- **Scam list, useful for the scam shield (7)**: "Buyer Scam" (ask the buyer to mark the payment as goods and services), "Accidental Payment", "Phishing", "Relative in Need", "Lottery or Prize", "Debt Collection", "Employment Related". Also: "Only send money for yourself and not for others. Be sure to verify the recipient's identity". Once complete, "there is a danger that your money may not be refunded" [S].
- **Developer license**: "You must comply with the implementation, access and use requirements contained in all documentation" [S].

---

## 6. Gotchas that would break a naive design

1. **"The agent sends money to a friend via API."** No such API exists (§2). Use orders, invoices or payouts and say so on screen.
2. **"A vaulted wallet lets the agent pay any merchant."** No. A vault token pays only the merchant that created it (`usage_type: MERCHANT`). Vault is "my app may charge me", not a general-purpose agent card. Live use needs billing-agreement approval. Variable recurring charges need 10-day advance notice unless a range was agreed (User Agreement).
3. **"The firewall uses PayPal-side spending limits."** PayPal exposes no per-agent budgets, allowlists or velocity limits. Every policy check must run locally before you call create, authorize or capture, and be enforced again at capture.
4. **"Approve later."** The `approve` link has a 6-hour default window. An authorization has a 3-day honor period and 29-day validity. Reauthorize is allowed once (conflicting docs say multiple), is PayPal-account only, and is capped at 115% or +$75 in the US. Approval queues must show expiries.
5. **"Capture on an AUTHORIZE order."** It returns 422 `ACTION_DOES_NOT_MATCH_INTENT`. Choose the intent at create time; PATCH can change `intent` only before approval [R].
6. **"The Catalog API is our storefront."** It has no price or stock and cannot delete products. Keep prices in your own catalog; create orders with explicit `items[]` and `amount.breakdown`.
7. **"We'll plug into Agent Ready, Store Sync or WebMCP."** These require a form request to the PayPal AI team, Braintree for ACP, and physical goods in US/USD only for Store Sync. None is self-serve in sandbox. Build your own agent-callable merchant surface (MCP tools to Orders v2) and model the feed on the Store Sync and ACP feed fields.
8. **"Agent Toolkit covers everything."** It has no Payouts, Vault, authorize, void, reauthorize, provide-evidence or webhooks. `pay_order` = capture. The local `@paypal/mcp` CLI was last published 2025-10. Plan direct REST calls.
9. **"Reconcile in real time with Transaction Search."** It has up to 3 hours of lag, 31-day windows and needs a permission toggle. Reconcile against your own ledger built from API responses and webhooks; Transaction Search is the "bank statement" that arrives later. Show "pending in PayPal reporting" states.
10. **"Webhooks straight into the desktop app."** The listener must be public HTTPS on port 443, and simulator events cannot be postback-verified. Use a relay, a tunnel, or polling `webhooks-events` and resource GETs.
11. **"Ship the client_secret in the Tauri binary."** PayPal says secrets must not be in client apps. Two options:
    - BYO-credentials: each user pastes their own sandbox app credentials, stored in the OS keychain via Tauri's stronghold or keyring. This is fine for judges.
    - A relay or backend holds the platform secret.
    Never commit secrets to the public repo, which the rules require to be public.
12. **"Two wallet users trade P2P through one platform app."** This is a marketplace or money-services pattern (AUP pre-approval #4 and #18). `platform_fees` needs a marketplace-enabled account. In sandbox it works via `payee`. In the pitch, call live use "requires PayPal marketplace onboarding".
13. **"Payouts are an agent's wallet."** Payouts pull from a **business balance**, are approval-gated in live, are async (PENDING), and unclaimed funds return after 30 days. Sandbox does not support PHONE recipients (per the spec). The default per-item cap is $20k.
14. **"Subscription rescue for the user's Netflix."** No consumer-side API lists or cancels a user's automatic payments with third parties. (8) must be merchant-side dunning: retries every 5 days, twice per cycle, a suspension threshold, and capturing `OUTSTANDING_BALANCE`. Failure simulation in sandbox is undocumented, so prepare a fallback.
15. **"Create disputes from the app for the demo."** Merchants cannot create disputes in live. The sandbox API needs account-manager scope enablement. Script the demo with the sandbox Resolution Center (the buyer opens a case), then sandbox `require-evidence` and `adjudicate`.
16. **"Agent browses paypal.com to do things."** The User Agreement forbids robots and automated devices on PayPal sites. Use APIs only. Approval happens in the user's real browser or webview.
17. **JS SDK popup inside a Tauri webview.** The `window.open` popup flow is unreliable in embedded webviews [R]. Prefer opening the `approve` link in the system browser with `return_url` to a loopback or custom-scheme handler. Whether PayPal accepts `http://127.0.0.1:port` or a custom scheme as `return_url` is **[R]**; `http://localhost` is commonly used in sandbox. Test it on day 1.
18. **Idempotency windows differ.** Orders keep `PayPal-Request-Id` for 6 hours; Payouts keep `sender_batch_id` and request IDs for 30 days. Agent retry logic must reuse IDs, or a timeout plus retry double-pays.
19. **`invoice_id` must be unique per merchant** by default. This is good as a firewall dedupe key, and bad if the agent reuses it across retries with different amounts.
20. **Token lifetime is about 8.8–9 hours.** Long-running agents and local MCP with `PAYPAL_ACCESS_TOKEN` need refresh logic. Permission changes, such as enabling Transaction Search, only apply to newly minted tokens [R].
21. **Venmo** appears only as a checkout payment source and US-only payouts. Venmo P2P has no API for new developers [R].
22. **"PayPal agent tokens / AP2 API."** These are marketing and blog-level only, with no developer API or sandbox. Implement AP2-style mandates locally (Intent Mandate = policy, Cart Mandate = signed order) and say "AP2-inspired".

---

## 7. Feature-to-API mapping (what is real)

| Feature | Real PayPal primitives | Human approval point | Main gotchas |
|---|---|---|---|
| (1) Spend firewall | Orders v2 AUTHORIZE → `/v2/payments/authorizations/{id}/capture` or `void`; `PayPal-Request-Id`; `invoice_id` dedupe; optional Vault `vault_id` for pre-approved small spends | PayPal approve page, plus the local capture decision within 3 days | Limits are local only; approval and honor windows apply |
| (3) Agent-ready merchant | Own catalog (Store Sync or ACP feed fields as schema), own MCP server exposing `search/create_cart/checkout` that calls Orders v2; webhooks or polling; tracking `/v2/checkout/orders/{id}/track` | The buyer approves the order | Catalog API has no price; Agent Ready, Store Sync and WebMCP are gated |
| (5) Ops cockpit | Own ledger + `GET /v1/reporting/transactions` (31 days, 3 hours lag) + `/v1/reporting/balances` + disputes list + webhooks-events; Agent Toolkit for NL queries | None | Reporting lag; the permission toggle |
| (7) Scam shield | Local heuristics before approve or capture (payee email age, mismatch with negotiated party, User Agreement scam typologies); `void` instead of capture; for Payouts, cancel only if `UNCLAIMED` | Local block or warn | No PayPal risk-score API for third parties [R]; once captured, only refund or dispute |
| (8) Subscription rescue | Subscriptions v1 + `BILLING.SUBSCRIPTION.PAYMENT.FAILED` and `SUSPENDED` webhooks + `/capture` OUTSTANDING_BALANCE + `revise`/`PATCH` + invoice fallback | The subscriber re-approves or pays the invoice | Merchant-side only; failure simulation undocumented |
| (9) Agents haggle and settle | Local negotiation → B issues an Orders AUTHORIZE (or invoice) to A → A approves → capture; optional Payouts for B2B or partial refunds | A approves on PayPal | No P2P API; marketplace and MSB rules in live; never F&F for goods |

---

## 8. Source index (fetched 2026-10-02)

- Orders v2 reference: https://developer.paypal.com/docs/api/orders/v2/
- Spec files (all used above): https://github.com/paypal/paypal-rest-api-specifications/tree/main/openapi
- Authorization guide: https://developer.paypal.com/docs/checkout/standard/customize/authorization/
- Payments v2: https://developer.paypal.com/docs/api/payments/v2/
- Pay another account: https://developer.paypal.com/docs/checkout/standard/customize/pay-another-account/
- Payouts: https://developer.paypal.com/docs/payouts/standard/ · https://developer.paypal.com/docs/payouts/standard/integrate-api/ · https://developer.paypal.com/payouts/faqs · https://developer.paypal.com/docs/api/payments.payouts-batch/v1/
- Webhook events: https://developer.paypal.com/api/rest/webhooks/event-names/ · https://developer.paypal.com/api/rest/webhooks/ · https://developer.paypal.com/api/rest/webhooks/rest/
- Subscriptions retry: https://developer.paypal.com/docs/subscriptions/customize/payment-failure-retry/
- Disputes: https://developer.paypal.com/docs/api/customer-disputes/v1/ · https://developer.paypal.com/docs/disputes/integration-guide/ · https://developer.paypal.com/docs/disputes/disputes-reference/ · https://developer.paypal.com/platforms/disputes/test-go-live
- Transaction Search: https://developer.paypal.com/docs/api/transaction-search/v1/
- Vault: https://developer.paypal.com/docs/checkout/save-payment-methods/ · https://developer.paypal.com/docs/checkout/save-payment-methods/during-purchase/orders-api/paypal/ · https://developer.paypal.com/docs/checkout/save-payment-methods/purchase-later/payment-tokens-api/paypal/ · https://developer.paypal.com/docs/api/payment-tokens/v3/
- Sandbox: https://developer.paypal.com/tools/sandbox/ · https://developer.paypal.com/tools/sandbox/accounts/ · https://developer.paypal.com/tools/sandbox/negative-testing/ · https://developer.paypal.com/tools/sandbox/negative-testing/request-headers/ · https://developer.paypal.com/tools/sandbox/card-testing/
- Auth and rate limits: https://developer.paypal.com/api/rest/authentication/ · https://developer.paypal.com/api/rest/reference/rate-limiting/ · https://developer.paypal.com/docs/log-in-with-paypal/
- AI tools: https://github.com/paypal/agent-toolkit (source `typescript/src/shared/tools.ts`, `configuration.ts`, `functions.ts`) · https://developer.paypal.com/ai-tools/agent-tools/ · https://developer.paypal.com/ai-tools/mcp-server · https://developer.paypal.com/tools/mcp-server/ · https://developer.paypal.com/ai-tools/get-started/ · npm registry (`@paypal/agent-toolkit`, `@paypal/mcp`) · PyPI `paypal-agent-toolkit`
- Agentic commerce: https://developer.paypal.com/agentic-commerce-services/about · https://developer.paypal.com/agent-ready/overview · https://developer.paypal.com/agent-ready/agentic-commerce-protocol · https://developer.paypal.com/store-sync/overview · https://developer.paypal.com/store-sync/create-catalog/
- Blog and news: https://developer.paypal.com/community/blog/ · …/WebMCP_PayPal_Agent_Ready · …/PayPal_AI_Hackathon · …/PayPal-Agent-Payments-Protocol/ · …/enabling-agentic-payments/ · …/accelerating-agentic-payments/ · …/expanding-paypal-mcp-capabilities/ · https://newsroom.paypal-corp.com/2025-10-28-PayPal-Launches-Agentic-Commerce-Services-to-Power-AI-Driven-Shopping · https://newsroom.paypal-corp.com/2026-01-22-Making-Sense-of-the-AI-Shopping-Protocol-Moment · https://newsroom.paypal-corp.com/2026-04-15-The-Moment-Is-Now-What-PayPal-Beyond-Revealed-About-the-Future-of-Commerce · https://techcrunch.com/2025/10/28/paypal-partners-with-openai-to-let-users-pay-for-their-shopping-within-chatgpt
- Legal: https://www.paypal.com/us/legalhub/paypal/acceptableuse-full · https://www.paypal.com/us/legalhub/paypal/useragreement-full
- Hackathon: https://paypalaihackathon.devpost.com/ · https://paypalaihackathon.devpost.com/rules
