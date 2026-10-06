# PayPal Agentic Wallet - Landscape & Stack Research

Researched 2026-10-02 for the PayPal AI Hackathon (Devpost, submissions close 2026-11-12, 2:00 PM PT).
Designers should treat this file as the factual floor: build on [S] facts, treat [R] facts as hypotheses until a spike confirms them.

Markers:
- **[S]** the page was actually fetched and read during this research (some fetches went through a summarizing reader; exact field names that a build depends on should still be eyeballed once in the source).
- **[R]** recalled, search-snippet or secondary-press only; unverified.
- **UNCERTAIN** sources conflict or are weak.
- **[inference]** our reasoning, not a sourced fact.

---

## 10 most decision-relevant facts

1. **The hackathon gate is "PayPal central + AI meaningful", judged pass/fail first.** Stage 1 checks theme fit and actual PayPal API/SDK use (sandbox is fine); Stage 2 weights five criteria equally (Tech, Design, Impact, Innovation, Presentation). Submission needs a public repo **with an OSS license file**, a **<3 min** public YouTube video, and either a hosted URL or full setup instructions plus test credentials. One project can win at most **one Grand prize + one Sponsor prize**. https://paypalaihackathon.devpost.com/rules [S]
2. **The AG Grid prize ($5k/$2k/$1k x3, the biggest sponsor pot) is really about AG Studio + its "Studio Agent Framework"**, not the plain grid: "Entries should demonstrate the Studio Agent Framework capability." The framework is bring-your-own-model; `clientToolRunner` lets *our* backend stream the model, so the local Claude Code/Codex engine fits. https://paypalaihackathon.devpost.com/details/aggrid [S], https://www.ag-grid.com/studio/react/ai-agents/ [S]
3. **PayPal pages must not be shown in a WebView.** PayPal's security guidelines: "Your application must not use a WebView or similar custom browser mechanism to display PayPal web pages"; use the system browser. All approval/login UX happens outside the app window; the app gets control back via deep link, loopback, or polling. https://developer.paypal.com/api/rest/reference/info-security-guidelines/ [S]
4. **PayPal's token endpoint needs the client secret** (`token_endpoint_auth_methods_supported: ["client_secret_basic"]` only). A desktop binary must not ship it, so OAuth code exchange and client-credentials calls need either a thin backend (Render fits) or a user-supplied sandbox app credential stored in the OS keychain (acceptable for a hackathon BYO-sandbox story [inference]). https://www.paypal.com/.well-known/openid-configuration [S]
5. **Running the user's own Claude Code is allowed; intermediating their login is not.** Anthropic: developers may not "offer Claude.ai login", "route requests through Free, Pro, or Max plan credentials on behalf of their users", or "collect, store, or intermediate Claude.ai credentials" - "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription." Do not name the product/features "Claude Code"; "Powered by Claude" is OK. https://code.claude.com/docs/en/legal-and-compliance [S], https://code.claude.com/docs/en/agent-sdk/overview [S]
6. **Both CLIs can be fenced to one MCP server, but the CLI fence is advisory - enforce policy inside the wallet's MCP server.** Claude: `--tools "" --strict-mcp-config --mcp-config ... --permission-mode dontAsk --allowedTools "mcp__wallet__*"`; Codex: `-c features.shell_tool=false -c web_search="disabled"` + `-c mcp_servers.wallet...`. Claude Code "mods" can override deny rules on non-managed machines. https://code.claude.com/docs/en/cli-reference [S], https://code.claude.com/docs/en/permissions [S], https://learn.chatgpt.com/docs/config-file/config-reference [S]
7. **`codex exec` auto-rejects MCP tool calls by default** (approval policy `never` + closed stdin = rejection) unless the server is set `default_tools_approval_mode = "approve"`. Third-party confirmed on Codex 0.153.4; upstream issue open. Spike on day 1. https://github.com/LeonJoeeee/papervault/issues/116 [S], https://github.com/openai/codex/issues/24135 [S]
8. **The industry has converged on one "allowance" shape that our spend firewall can mirror:** single seller/merchant binding + `max_amount` + currency + `expires_at` + single-use + revocable + lifecycle events - Stripe Shared Payment Tokens, OpenAI/Stripe ACP `allowance`, and PayPal/Braintree's ACP nonce (`max_amount`, `expires_at`, merchant-bound). Google AP2 v0.2 adds **open (policy, user-signed) vs closed (one transaction) mandates** - the exact split between "wallet policy" and "this payment". https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens.md [S], https://developers.openai.com/commerce/specs/payment [S], https://developer.paypal.com/agent-ready/agentic-commerce-protocol [S], https://ap2-protocol.org/ap2/specification/ [S]
9. **PayPal's agentic stack is merchant-side; the consumer-side policy/consent gap is open.** PayPal ships remote MCP (`mcp.paypal.com`, `mcp.sandbox.paypal.com`), Agent Toolkit (orders, refunds, disputes, invoices, subscriptions, transactions - merchant ops), Agent Ready (Braintree, ACP/UCP), Store Sync (Cymbio). Its Seller Protection page says "PayPal does not assess AI intent or behavior. Instead, it reviews transaction outcomes." No public consumer agent-permission API found (UNCERTAIN). https://developer.paypal.com/ai-tools/mcp-server [S], https://www.paypal.com/us/brc/article/seller-protection-agentic-commerce [S]
10. **Real failures argue for "LLM proposes, deterministic policy disposes".** Guardio "Scamlexity": Perplexity Comet bought from a fake Walmart store with autofilled card, no confirmation; Zscaler (2026-07): hidden CSS/JSON-LD injections got 4 of 26 LLMs to pay a scam wallet; Anthropic Project Vend: Claudius told customers to pay a hallucinated Venmo account; Anthropic Project Deal: weaker agents lost money in agent-to-agent haggling and their humans didn't notice. https://guard.io/labs/scamlexity-we-put-agentic-ai-browsers-to-the-test-they-clicked-they-paid-they-failed [S], https://cryptobriefing.com/zscaler-prompt-injection-ai-agents-crypto/ [S], https://www.anthropic.com/research/project-vend-1 [S], https://www.anthropic.com/features/project-deal [S]

---

## 0. Hackathon ground truth

- URL https://paypalaihackathon.devpost.com/ ; ~668 registrants on 2026-10-02. [S]
- Timeline: submissions 2026-10-01 09:00 PT -> **2026-11-12 14:00 PT**; judging 11-13 -> 12-15; winners ~12-21. [S] https://paypalaihackathon.devpost.com/rules
- Required: "meaningfully integrate at least one PayPal technology, API, SDK, product, or developer capability" AND "meaningfully incorporate AI"; "Any AI tool works, as long as PayPal integration is central". Venmo, Braintree, Xoom, Honey, Zettle count as PayPal. Project must be new or significantly updated after Oct 1. [S]
- Eligibility exclusions: Brazil, Quebec, Russia, Crimea, Cuba, Iran, North Korea residents; PayPal/Devpost staff. [S]
- Submission: working demo (hosted URL, OR repo setup instructions + test credentials), description, tools list, public repo with OSS license, video <3 min on YouTube, English. [S]
- Judging: Stage 1 pass/fail (theme + real PayPal API/SDK use); Stage 2 equal weight: Technological Implementation, Design, Potential Impact, Innovation/Idea, Presentation. [S]
- Prizes [S]: Grand $12k / $8k / $5k; $5k each for Most Creative, Most Impactful, Best Demo Delivery, **Best Use of PayPal + AI**, **Best Use of Agentic Commerce**. Sponsors: **AG Grid** $5k/$2k/$1k x3; **APIMatic** $1k x3 + 6 mo Business tier; **Bryntum** $1k x3; **Channel3** $1.5k x1; **Render** credits $1k/$750/$500. Total "$67,500+" on page (snippets say $69,750 [R]).
- Stacking: max **one Grand + one Sponsor prize**, or one Honorable Mention + one Sponsor. [S] -> pick ONE primary sponsor prize to design for.
- Partner tools without cash prize: Astropods, Elastic, KERNEL, Postman, Zapier; partners have judges on the panel. [S]
- IP: entrant keeps ownership; sponsor gets non-exclusive judging + 3 years promo license. [S]
- Official resources page lists developer.paypal.com, JS SDK v6, REST API, sandbox guide, github.com/paypal/AI-Toolkit. **docs.paypal.ai links redirect to developer.paypal.com/docsai/... and some returned 404** (MCP quickstart, agent-tools-ref) - use GitHub READMEs. https://paypalaihackathon.devpost.com/resources [S]
- PayPal AI Toolkit repo (hackathon-linked): npm `@paypal/agent-toolkit`, `@paypal/mcp`; Claude Code plugin `/plugin install paypal@claude-plugins-official`; Codex `codex plugin marketplace add paypal/AI-Toolkit`; env `PAYPAL_SANDBOX_ACCESS_TOKEN`. Tool groups: Orders/Payments (create, capture, refund), Invoices (+QR), Subscriptions, **Disputes**, Catalog, Shipment, Reporting/transactions. **No Payouts.** https://github.com/paypal/AI-Toolkit [S] (Note: also referenced as github.com/paypal/agent-toolkit with env `PAYPAL_ACCESS_TOKEN` + `PAYPAL_ENVIRONMENT` [S] - likely same project renamed/mirrored; UNCERTAIN which name is canonical.)
- PayPal Server SDK `@paypal/paypal-server-sdk` 2.5.0 (APIMatic-generated) covers only **5 controllers: Orders v2, Payments v2, Vault v3 (US only), Transaction Search v1, Subscriptions v1**. **Disputes, Payouts, Invoicing are NOT in the SDK** -> raw REST or MCP toolkit. https://github.com/paypal/PayPal-TypeScript-Server-SDK [S]
- Official AG Grid boilerplate (Next.js + server SDK + AG Grid: /transactions, /subscriptions, /balances; ships AGENTS.md/CLAUDE.md): https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate [S]
- Sponsor support everywhere routes via PayPal Discord. [S]

---

## 1. Competitive / prior-art landscape (agent payments, as of 2026-10)

### 1.0 What moved since late 2025 (context designers often have wrong)
- OpenAI wound down ChatGPT **Instant Checkout** ~2026-03-20; purchases move "to apps" (discover in ChatGPT, buy in merchant app/ChatGPT App). Weak conversion cited. https://www.cnbc.com/2026/03/20/open-ai-agentic-shopping-etsy-shopify-walmart-amazon.html [R] (403 on fetch). ACP still lives in ChatGPT Apps (see PayPal Agent Ready ACP docs [S]). => Do not pitch "PayPal in ChatGPT Instant Checkout" as current.
- Google launched **UCP (Universal Commerce Protocol)** Jan 2026; AP2 is now its payment extension. https://infoq.com/news/2026/01/google-agentic-commerce-ucp [S] (date 01-11 vs 01-19 UNCERTAIN)
- AP2 v0.2 renamed mandates (Checkout + Payment, each open/closed). https://ap2-protocol.org/ap2/specification/ [S]
- x402 moved to the x402 Foundation (Linux Foundation) 2026-04-02 [R]; PayPal not seen among members (UNCERTAIN).
- Wallet layer crowded: Stripe Link agent wallet (GA Apr 2026), Coinbase Agentic Wallets (Feb 2026), Cloudflare Wallets (Aug 2026), Meta Muse checkout (Sep 2026).

### 1.1 Stripe
- **Sessions 2026 (Apr 29-30)** statuses: Link Agent Wallet GA; Issuing for agents Public Preview; MPP (Machine Payments Protocol, with Tempo) GA; SPTs GA (cards, stablecoins, Klarna, Affirm); Radar Bot Abuse Prevention preview; **Agent Guardrails** preview ("assign agent identities, enforce scope rules, and configure approval flows for sensitive actions" - closest cloud analog to our spend firewall); Agentic Treasury Accounts preview. https://stripe.com/blog/everything-we-announced-at-sessions-2026 [S]
- **Agentic Commerce Suite** (2025-12-11): low-code selling across AI agents on SPT + ACP. https://stripe.com/newsroom/news/agentic-commerce-suite [S]
- **Shared Payment Tokens** https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens.md [S]:
  - `POST /v1/shared_payment/issued_tokens` (`Stripe-Version: 2026-04-22.preview`); params `payment_method`, `seller_details[network_business_profile]` (scoped to ONE seller), `usage_limits[currency|max_amount|expires_at]`, `return_url`.
  - Object `spt_...`, states `active` / `requires_action` (3DS) / `deactivated` (consumed, expired, revoked). Revoke endpoint `.../revoke`. Webhooks `shared_payment.issued_token.{requires_action,active,used,deactivated}`.
  - Reusable: scoped + capped + expiring + revocable credential with a state machine -> our "Spend Permit" object.
- **Issuing for agents** https://docs.stripe.com/issuing/agents [S]: single-use virtual cards; `spending_controls[allowed_categories]` (MCC allowlist), `spending_limits[{amount, interval}]`; card `metadata.agent_id`; **real-time `issuing_authorization.request` webhook, 2 s default timeout** then fallback to card rules; patterns: freeze on anomaly, 80% budget alert, auto-dispute when settled != authorized. Reusable: real-time authorization hook = firewall decision point; authorized-vs-settled reconciliation for the ops cockpit.
- **Link agent wallet**: agent creates a *spend request*, user approves in Link app, agent receives one-time card or SPT, never raw credentials; US-only; "granular agent restrictions" coming soon. https://link.com/agents [S]
- **Stripe MCP** `https://mcp.stripe.com` (OAuth or "Agent" API key; from **2026-10-31** rejects full secret keys). Generic tools `stripe_api_search|details|read|write`. **Server-side human confirmation**: sensitive writes return an approval URL; human approves; agent retries with an approval token; approvals expire after 24 h. Stripe warns about prompt injection when combining MCP servers. https://docs.stripe.com/mcp [S]. Reusable: approve-by-URL + unforgeable approval token.
- **MPP** (Stripe + Tempo, 2026-03-18): HTTP-native machine payments (price discovery, authorize, subscriptions, streaming). https://eco.com/support/en/articles/14845486-stripe-machine-payments-protocol-mpp [R]

### 1.2 OpenAI/Stripe Agentic Commerce Protocol (ACP)
- Repo https://github.com/agentic-commerce-protocol/agentic-commerce-protocol [S]: beta, OpenAI + Stripe maintainers; date versions up to **2026-04-17**; added carts, feeds, order mgmt, MCP integration, capability negotiation, payment handlers.
- Checkout spec https://developers.openai.com/commerce/specs/checkout [S]: `POST /checkout_sessions`, `POST /checkout_sessions/{id}`, `.../complete`, `.../cancel`, `GET`; status `not_ready_for_payment|ready_for_payment|completed|canceled`; `totals` (items_base_amount, subtotal, discount, fulfillment, tax, fee, total); `messages` with JSONPath refs; `payment_data {token, provider: stripe|adyen|braintree, billing_address}` - **Braintree (PayPal) is a first-class provider**.
- Delegated Payment spec `POST /agentic_commerce/delegate_payment` https://developers.openai.com/commerce/specs/payment [S]: `allowance {reason: one_time, max_amount, currency, checkout_session_id, merchant_id, expires_at}`, `risk_signals[{type: card_testing, score, action}]`, `Idempotency-Key`, returns vault token `vt_...`.
- Reusable: a merchant-readiness probe can test for `/checkout_sessions`; the allowance shape = our permit schema.

### 1.3 Google AP2 + UCP
- AP2 launch 2025-09-16 with 60+ partners **incl. PayPal**, Mastercard, Amex, Adyen, Coinbase. v0.1: **Intent Mandate** (user request + constraints), **Cart Mandate** (exact items/price, user-signed), **Payment Mandate** (links payment method to cart), as signed verifiable credentials. **Human-present** (user signs cart) vs **human-not-present** (user pre-signs a detailed Intent Mandate with price limits/timing; agent generates cart when conditions met). A2A x402 extension for stablecoins. https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol [S]
- AP2 v0.2 (current) https://ap2-protocol.org/ap2/specification/ [S]: roles Shopping Agent, Credentials Provider, Merchant Endpoint, Merchant Payment Processor; **Checkout Mandate** (to merchant) + **Payment Mandate** (to credential provider/network); each has **open** stage (constraints + agent public key, user-signed) and **closed** stage (bound to one transaction; agent-signed in autonomous mode, user-signed in direct mode). Encoding **SD-JWT**, schema via `vct` (e.g. `mandate.payment.1`). FIDO Alliance TWGs standardizing. Extension of A2A and UCP.
- UCP: co-developed with Shopify, Etsy, Wayfair, Target, Walmart; REST/MCP/A2A bindings; separates credential providers from PSPs; powers checkout in Gemini / AI Mode. https://infoq.com/news/2026/01/google-agentic-commerce-ucp [S]. PayPal "coming soon" as UCP payment option in Gemini/AI Mode [R].
- Reusable: **open mandate = the user's standing policy in our wallet; closed mandate = the per-payment countersignature** the wallet issues only when the cart fits. Use the vocabulary on screen ("Mandate", "human-present / not-present") to signal standards literacy to judges [inference].

### 1.4 Visa
- **Visa Intelligent Commerce**: agent-specific tokens (VTS), **Payment Instructions** (agent actions must match the user's authenticated instruction), passkey step-up, **Commerce Signals**, Visa MCP server; free sandbox; "in the process of development and deployment". https://developer.visa.com/capabilities/visa-intelligent-commerce [S]
- **Trusted Agent Protocol** (2025-10-14, with Cloudflare): Agent Intent, Consumer Recognition, optional Payment Info. https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.21716.html [S]. Wire format = RFC 9421 HTTP Message Signatures with `Signature-Input` params `created, expires, keyid, alg, nonce, tag` where **`tag` = `agent-browser-auth` | `agent-payer-auth`**. https://github.com/visa/trusted-agent-protocol [S]
- Cloudflare **Web Bot Auth**: Ed25519 signatures, keys in network-hosted directories; same tags used by Visa TAP and Mastercard Agent Pay; Cloudflare validates (nonce uniqueness etc.). https://blog.cloudflare.com/secure-agentic-commerce/ [S]
- **Visa Intelligent Commerce Connect** (2026-04-22, pilot): one connection supporting TAP, MPP, ACP, UCP. https://thepaypers.com/payments/news/visa-launches-intelligent-commerce-connect-for-agentic-payments [S]
- Reusable: agent identity = a keypair per agent held in the OS keychain; readiness probe can check whether a merchant edge verifies these signatures (hard to probe from outside - UNCERTAIN feasibility).

### 1.5 Mastercard
- **Agent Pay** (announced 2025-04-29; all US cardholders ~Nov 2025): **Agentic Tokens** = dynamic network tokens tied to a registered agent; Agent Pay Acceptance Framework requires agent registration + Web Bot Auth verification at CDN. https://eco.com/support/en/articles/14846277-know-your-agent-kya-identity-for-agent-payments [R]
- **Mastercard + PayPal (2025-10-27)**: Agent Pay integrated into the PayPal wallet; PayPal pilots the Acceptance Framework. https://newsroom.paypal-corp.com/2025-10-27-Mastercard-and-PayPal-Join-Forces-To-Accelerate-Secure-Global-Agentic-Commerce [S]
- **Verifiable Intent** (2026-03-05, open source, with Google, Fiserv, IBM, Checkout.com...): tamper-resistant chain consumer identity -> instruction -> outcome; selective disclosure; AP2-compatible. https://www.pymnts.com/mastercard/2026/mastercard-unveils-open-standard-to-verify-ai-agent-transactions/ [S]
- **Agent Pay for Machines** (2026-06-10): micropayments, programmatic permissions and limits, x402/MPP compatible. https://investor.mastercard.com/investor-news/investor-news-details/2026/Mastercard-Launches-Agent-Pay-for-Machines-to-Unlock-Super-Fast-Always-On-Payments/default.aspx [S]
- **"Know Your Agent" (KYA)**: coined by Skyfire (2024) [R]; PayPal used "KYA" at Ai4 (2026-08-10) as extension of KYC/KYB. https://newsroom.paypal-corp.com/2026-08-10-PayPal-Takes-Center-Stage-at-Ai4-2026 [S]
- Reusable: the "did the consumer authorize / did the agent follow instructions / can anyone prove it" triad = our evidence/audit trail screen.

### 1.6 Crypto-native rails and startups
- **x402** (Coinbase -> x402 Foundation): server returns HTTP 402 + `PAYMENT-REQUIRED` (base64 requirements: scheme, price, network, payTo); client retries with `PAYMENT-SIGNATURE`; server returns `PAYMENT-RESPONSE`. (v1 used `X-PAYMENT`/`X-PAYMENT-RESPONSE` [R].) Schemes `exact` (live), `upto`. EVM/Solana/Stellar. https://github.com/coinbase/x402 [S]. CDP facilitator `/verify`, `/settle` https://docs.cdp.coinbase.com/x402/welcome [S]. Reality check: TRM Labs estimated only 0.6-7.5% of x402 value is truly agentic [R] https://www.pymnts.com/news/artificial-intelligence/2026/agentic-payments-are-growing-most-x402-payments-are-not-from-ai-agents
- **Coinbase Agentic Wallets** (2026-02-11): MPC/TEE keys kept away from LLM prompt; session caps, per-tx limits, declarative policies (address allowlists, value caps) enforced on every signature; `npx awal` / MCP. [R]
- **Skyfire KYAPay**: JWT types `kya+JWT`, `pay+JWT`, `kya+pay+JWT`; claims `spr`, `sps`, `amount`, `cur`, `aud` (seller, anti-replay), `bid`/`aid` (buyer/agent identity); JWKS verification. https://kyapay.org/whitepaper [S]. Reusable for **signed haggling offers** between two wallets.
- **Payman**: agents pay humans under policies (per-tx max, daily limit, payee whitelist, approval threshold) [R]; 2026 status UNCERTAIN.
- **Nekuda**: previously "Secure Agent Wallet" + "Agentic Mandates" (VIC pilot) [R]; **current docs only describe "WebMCP Kit"** (`@nekuda/webmcp-sdk`) https://docs.nekuda.ai/introduction [S] -> apparent pivot (UNCERTAIN).
- **Crossmint**: agent wallets (fiat + stablecoin), Visa/Mastercard-derived virtual cards, headless checkout (Amazon/Shopify, Crossmint as merchant of record); guardrails: spend limits, merchant whitelists, approval above threshold; x402 + AP2. https://www.crossmint.com/solutions/agentic-payments [S]
- **Cloudflare Wallets** (2026-08-04): Account Wallets (humans) + Virtual Wallets (agents); caps, allowlists, max tx size, "unexpectedly fast spending" -> human review; purchasing "coming soon". https://blog.cloudflare.com/wallets/ [S]
- **1Password Secure Agentic Autofill** (Oct 2025 early access, via Browserbase): credentials injected only after human approval on 1Password app; LLM never sees them [R]. Closest existing "local approval broker" pattern.
- **Desktop/local "agent wallet" products**: none found that are local-first, cross-agent, and PayPal-based. Nearest: 1Password approval broker (credentials, not money) and Coinbase `awal` CLI/MCP (crypto). [inference from search; absence not proven]

### 1.7 PayPal's own agentic offerings (chronological)
- 2025-04-29 Dev Days: "industry's first remote MCP server" + **PayPal Agent Toolkit**. https://newsroom.paypal-corp.com/2025-04-29-PayPal-Brings-Together-Developers,-AI-Leaders-to-Power-Agentic-Commerce-at-Dev-Days [S]
- 2025-05-14 Perplexity: checkout with PayPal/Venmo in Perplexity (account linking, tokenized wallet, passkeys). [R]
- 2025-08-04 dev blog "Enabling agentic payments": scenarios with **preconfigured agent tokens** for wallet users; concept only, no API. https://developer.paypal.com/community/blog/enabling-agentic-payments/ [S]
- 2025-09 AP2 launch partner [S]; Google multiyear deal [R].
- 2025-10-27 Mastercard Agent Pay into PayPal wallet [S].
- 2025-10-28 **Agentic Commerce Services**: "agent ready" (existing merchants accept AI-surface payments, "no additional technical lift"), "store sync" (catalog discoverable in AI channels). Sign-up PayPal.ai. https://newsroom.paypal-corp.com/2025-10-28-PayPal-Launches-Agentic-Commerce-Services-to-Power-AI-Driven-Shopping [S]
- 2025-10-28 **OpenAI**: PayPal adopts ACP; PayPal wallet in ChatGPT Instant Checkout; "PayPal ACP server" for merchant catalogs. https://newsroom.paypal-corp.com/2025-10-28-OpenAI-and-PayPal-Team-Up-to-Power-Instant-Checkout-and-Agentic-Commerce-in-ChatGPT [S] (superseded in part by Instant Checkout wind-down [R])
- 2026-01-08 Microsoft Copilot Checkout powered by PayPal [R]; 2026-01-11 PayPal supports Google UCP [R].
- 2026-01-22 PayPal's protocol taxonomy (commerce: ACP, UCP; payment/trust: AP2, Visa TAP, MC Agent Pay; infra: A2A, MCP); stance "protocol-agnostic". https://newsroom.paypal-corp.com/2026-01-22-Making-Sense-of-the-AI-Shopping-Protocol-Moment [S]
- 2026-01-22 Cymbio acquisition (closed 02-05) - powers Store Sync. [S]
- 2026-04-29 reorg under CEO Enrique Lores (Checkout Solutions & PayPal; Consumer Financial Services & Venmo; Payment Services & Crypto). [S]
- 2026-06-10 **Agent Ready docs**: Braintree merchants; ACP path (delegated tokens via Braintree, ChatGPT Apps) and UCP path (Google Pay handler via Braintree). https://developer.paypal.com/agent-ready/overview [S]. ACP token = Braintree **single-use nonce bound to merchant, with `expires_at` and `max_amount`**; errors `91565` (expired/unknown), `915266` (amount over max), `915267` (currency mismatch); response `facilitator_details` identifies ChatGPT as initiator. https://developer.paypal.com/agent-ready/agentic-commerce-protocol [S]
- 2026-08-10 Ai4: **Merchant AI Integration Agent** (reads merchant codebase, upgrades/certifies PayPal integration), "Know Your Agent", one-tap in-feed purchasing. [S]
- 2026-09-22 **Meta Muse** checkout with PayPal; Muse may issue a single-use virtual card; user approves total in chat. https://www.pymnts.com/news/artificial-intelligence/2026/meta-adds-paypal-muse-ai-assistant-global-checkout/ [S]
- Agentic Commerce Services access is **gated** (merchant form at paypal.com/us/business/ai). https://developer.paypal.com/docsai/growth/agentic-commerce/overview [S] -> do not design a demo that depends on Agent Ready/Store Sync onboarding.
- **PayPal MCP server** https://developer.paypal.com/ai-tools/mcp-server [S]: remote `https://mcp.paypal.com` / `https://mcp.sandbox.paypal.com`, transports `/sse` and `/http`; auth via access token Bearer (cached in `~/.mcp-auth`) [S] (another source says connecting starts an OAuth flow [R] - UNCERTAIN); local `npx @paypal/mcp --tools=all` (Node 18+) with `PAYPAL_ACCESS_TOKEN`. Remote "token-based tool visibility" (LLM sees only tools its token allows) [R].
- **Agent Toolkit tools** (names [R] from snippet): `create_invoice, list_invoices, get_invoice, send_invoice, create_order, get_order, pay_order, create_refund, list_disputes, get_dispute, accept_dispute_claim, create_shipment_tracking, ..., create_subscription_plan, list_subscription_plans, create_subscription, show_subscription_details, update_subscription, cancel_subscription, list_transactions, get_merchant_insights`. Merchant-ops oriented; no consumer spend tool, no payouts.
- No public PayPal API found for a *consumer* to list/cancel their own "automatic payments" (UNCERTAIN) -> subscription rescue must be framed around (a) merchant-side subscriptions the user owns as a seller, (b) detection from transaction history + guided cancellation, or (c) a per-renewal capped allowance.

### 1.8 Failure / fraud evidence (for Scam Shield + firewall copy)
- **Guardio "Scamlexity" (2025-08-20)**: Comet completed a purchase on a fake Walmart store with autofilled card/address, no confirmation; followed a phishing Wells Fargo email; **PromptFix** fake CAPTCHA with hidden prompt -> drive-by download. https://guard.io/labs/scamlexity-we-put-agentic-ai-browsers-to-the-test-they-clicked-they-paid-they-failed [S]
- Brave: indirect injection via hidden Reddit text in Comet exfiltrated email + OTP (2025-08). https://www.theregister.com/2025/08/20/perplexity_comet_browser_prompt_injection/ [R]
- OpenAI CISO: "prompt injection remains a frontier, unsolved security problem". [R]
- **Zscaler (2026-07-02)**: real campaigns using hidden CSS, **JSON-LD structured data**, SEO poisoning, typosquats to make agents send crypto; 4 of 26 LLMs paid. https://cryptobriefing.com/zscaler-prompt-injection-ai-agents-crypto/ [S]
- Grok/Bankrbot (2026-05-04): Morse-encoded prompt -> ~$150-200k token transfer (returned). https://oecd.ai/en/incidents/2026-05-04-4a73 [R]
- Freysa (Nov 2024): player redefined `approveTransfer` semantics, drained 13.19 ETH. [R]
- **Anthropic Project Vend 1**: sold below cost, talked into discounts, **told customers to pay a hallucinated Venmo account**. https://www.anthropic.com/research/project-vend-1 [S]. **Vend 2** (2025-12-18): onion-futures contract approved by two agents, impostor-CEO; fixes: hard margin rule (cut discounts ~80%), procedures, role separation. https://www.anthropic.com/research/project-vend-2 [S]
- **Anthropic Project Deal** (published 2026-04-24): 69 employees, Claude agents haggled in Slack, 186 deals ~$4k; Opus beat Haiku (same broken bike $38 vs $65); **losers didn't notice** (fairness ~4/7 both sides); duplicate purchase; confabulation. https://www.anthropic.com/features/project-deal [S] -> direct prior art for our A2A haggling; design must show the user *how the deal compared to market*.
- **OWASP LLM06:2025 Excessive Agency** - mitigations: minimal tools, least privilege, human approval for high-impact actions, "authorization checks in downstream systems rather than relying on LLM judgment". https://genai.owasp.org/llmrisk/llm062025-excessive-agency/ [S]. OWASP Agentic Top 10 2026: ASI01 Goal Hijack, ASI02 Tool Misuse. [R]
- Amazon v. Perplexity: injunction against Comet shopping agent (2026-03-10) vacated by Ninth Circuit 2026-08-04 [R].
- Liability for "my agent wasn't authorized for that purchase" disputes unsettled [R]. A "CFPB Jan 2026 Reg Z advisory on agent purchases" appears in blogs but **no primary source found - do not cite**.

### 1.9 The gap a local-first PayPal agent wallet fills [inference, grounded in the above]
- Every policy layer found is **cloud- and rail-specific** (Stripe Guardrails/Issuing, Link approvals, Coinbase TEE policies, Cloudflare Virtual Wallets, Crossmint). Nothing on the user's own machine enforces **one policy across all their agents** (Claude Code, Codex, browser agents) and all rails.
- PayPal's agentic stack is merchant-side and says it does not assess AI intent -> room for **consumer consent + evidence**: signed open mandate, per-payment closed approval, audit trail usable in Buyer Protection disputes.
- Firewall = one internal **Allowance** model (max_amount, currency, merchant binding, expires_at, single-use, revocable, lifecycle events) that maps to ACP allowance / Stripe SPT / Braintree nonce / AP2 open mandate; decision hook modeled on Stripe Issuing real-time auth (budget, category, velocity); approvals modeled on Stripe MCP approve-by-URL tokens.
- Readiness probe: ACP `/checkout_sessions`, UCP, PayPal checkout presence, x402/MPP 402 responses, structured product data (via Channel3 `/lookup-product`), bot walls (via KERNEL).
- Haggling: floors/ceilings from the mandate, concession log, market reference price (Channel3), signed offers (KYAPay/AP2 style), closed list of deal types (Vend lesson).
- Thesis risks: weak agentic checkout conversion (Instant Checkout retreat), most x402 not agentic, PayPal Agent Ready gated - pitch as **consent, evidence, control**, not "agents buy more".

---

## 2. Driving the local LLM engine headless (Claude Code CLI / Codex CLI)

Design premise: the wallet never holds an LLM key. It spawns the user's own CLI as a child process, gives it exactly one MCP server (the wallet's local policy-gated tool server), strips every other tool, and parses a JSON event stream for the UI (agent "thinking" feed, cost meter, tool-call timeline).

### 2.1 Claude Code `claude -p` (print / headless mode)

Source for all flag facts below unless noted: https://code.claude.com/docs/en/cli-reference [S] and https://code.claude.com/docs/en/headless [S] (fetched 2026-10-02; docs reference CLI versions up to ~v2.1.28x).

Core flags (verbatim semantics):
- `-p, --print` non-interactive; exit code 0 on success, non-zero on failure; failures inside the run (e.g. missing auth) are printed as the *result on stdout*, invalid flags go to stderr. [S]
- `--output-format text|json|stream-json`. `json` = single object with `result`, `session_id`, usage metadata, `total_cost_usd` + per-model cost breakdown. `stream-json` = NDJSON events; last line is a `result` message. Streaming tokens require `--output-format stream-json --verbose --include-partial-messages` (events of `type:"stream_event"` with `event.delta.type=="text_delta"`). [S]
- `--input-format text|stream-json` -> keep one long-lived process and push user turns as NDJSON on stdin (good for haggling sessions; each turn emits its own `result` message). `--replay-user-messages` echoes stdin messages back for ack. [S]
- `--json-schema '<schema>'` + `--output-format json` -> validated output lands in `structured_output` field. Invalid schema = hard error. `format` keyword is annotation only. [S] => use for "agent proposes a payment intent" objects the wallet then validates again itself.
- `--tools ""|"default"|"Bash,Read"` restricts *built-in* tools; `""` disables all. Does NOT affect MCP tools. [S]
- `--allowedTools` = auto-approve (no prompt) rules, NOT an availability list. `--disallowedTools` = deny rules; bare name removes tool from context; `"*"` removes everything, `"mcp__*"` all MCP tools. Scoped MCP rules with parentheses are only honored on the CLI flag, not in settings files. [S]
- Permission rule order: deny -> ask -> allow; first match wins, specificity irrelevant. MCP rules: `mcp__wallet` (whole server), `mcp__wallet__*`, `mcp__wallet__pay_order`. Unanchored allow globs like `mcp__*` are skipped and approve nothing. Source https://code.claude.com/docs/en/permissions [S]
- `--permission-mode default|acceptEdits|plan|auto|dontAsk|bypassPermissions` (`manual` alias for default). `dontAsk` denies every call that would prompt except those your allow rules cover -> the right mode for a locked-down wallet run. A `-p` run with no explicit mode takes the built-in starting mode, "which can be `auto`" -> ALWAYS pass a mode explicitly. [S]
- `--permission-prompt-tool <mcp tool>` routes would-be prompts to an MCP tool (only consulted when no static rule matched). Tool receives `tool_name`, `input`, `tool_use_id`; returns `{"behavior":"allow"|"deny", "updatedInput"?, "message"?}` (shape per community docs) -> https://github.com/anthropics/claude-code/issues/1175 [R]. It cannot approve a tool flagged `_meta.requiresUserInteraction` (v2.1.199+). [S]
- `--permission-prompts host|none` (v2.1.259+): `none` = deny anything nothing else resolves; denials appear as `permission_denied` system messages and in `permission_denials` on the result. [S]
- MCP `_meta: {"requiresUserInteraction": true}` on a tool in `tools/list` forces approval even in `auto`/`bypassPermissions`. https://code.claude.com/docs/en/mcp [S] (useful as belt-and-braces, but in headless `-p` it means the tool is effectively unusable -> keep the human approval inside the wallet UI, not in Claude Code).
- `--mcp-config <file-or-json ...>` + `--strict-mcp-config` = only the wallet's server is loaded, ignoring user/project `.mcp.json`. With `-p`, Claude waits for pending servers up to `MCP_TIMEOUT` (30 s default) before turn 1 (v2.1.221+). Invalid entries are skipped silently when stderr is captured; check `mcp_servers` / `mcp_server_errors` in the `system/init` event. [S]
- MCP config JSON: `{"mcpServers":{"wallet":{"type":"stdio"|"http"|"sse"|"ws","command","args","env" | "url","headers"}}}`; `${VAR}` / `${VAR:-default}` expansion; per-server `timeout` ms. Tool names become `mcp__<server>__<tool>`. `MAX_MCP_OUTPUT_TOKENS` default 25,000. Windows: `npx` needs `"command":"cmd","args":["/c","npx",...]`. https://code.claude.com/docs/en/mcp [S]
- `--append-system-prompt[-file]` keeps Claude Code's default prompt (coding-assistant identity + safety); `--system-prompt[-file]` replaces it entirely (you own all safety text). For a wallet agent persona, replacement is defensible; the docs explicitly frame replacement as right when "the surface, identity, or permission model differs from Claude Code's". [S]
- `--max-turns N` (error on limit), `--max-budget-usd X` (LLM spend cap, counts subagents; subtype `error_max_budget_usd`). [S] Name collision warning: this is *LLM token spend*, not the wallet's payment budget - keep the two meters visually distinct.
- `--model <alias|id>` (aliases `sonnet`, `opus`, `haiku`, `fable`), `--fallback-model a,b`, `--effort low..max`. [S]
- Sessions: `--resume <id|name|path.jsonl>`, `--continue`, `--session-id <uuid>` (pre-assign so the wallet can key its own DB rows), `--fork-session`, `--no-session-persistence`. Resume finds IDs across all projects (v2.1.223+). [S]
- Isolation from the user's personal Claude config: `--bare` skips hooks/skills/plugins/MCP/CLAUDE.md/auto-memory BUT "never reads OAuth credentials or the system keychain" -> needs `ANTHROPIC_API_KEY`; unusable for subscription users. Alternatives: `--setting-sources` (choose user/project/local), `--strict-mcp-config`, `--disable-slash-commands`, `--safe-mode` (disables CLAUDE.md, skills, plugins, hooks, MCP servers, while auth works) - whether `--safe-mode` still loads `--mcp-config` servers is NOT documented -> spike. [S]/[unverified combo]
- Without `--bare`, a `-p` session runs the hooks in the cwd's `.claude/settings.json` and connects its `.mcp.json` with no trust dialog -> always spawn with cwd = an app-owned empty sandbox dir (e.g. `%APPDATA%/wallet/agents/<agent-id>/`). [S]
- Installed "mods" (`tool.check` handlers) can override deny rules on non-managed machines -> the CLI permission layer is advisory; the wallet's MCP server must re-enforce policy server-side. https://code.claude.com/docs/en/permissions [S]
- `system/init` event lists `model`, `tools`, `mcp_servers` (+status), `plugins`, optional `capabilities` array -> render as the "engine handshake" card in the UI and refuse to proceed if any tool outside the allowlist is present. [S]
- `system/api_retry` events (attempt, retry_delay_ms, error category e.g. `rate_limit`, `billing_error`, `authentication_failed`) -> drive an engine-health indicator. [S]
- SIGTERM -> exit 143, turn unfinished; send SIGINT (or SDK `interrupt()`) to end a turn cleanly. Background subagents keep `-p` alive up to 10 min idle (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`). Piped stdin cap 10 MB. [S]
- `claude auth status` -> JSON, exit 0 if logged in; `authMethod` in `none|claude.ai|oauth_token|api_key|api_key_helper|third_party` -> use for onboarding "engine detected" step. [S]

Cost/usage fields (https://code.claude.com/docs/en/agent-sdk/cost-tracking [S]):
- Result message: `total_cost_usd`, `usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`; main loop only), `modelUsage` map per model (`costUSD`, `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `costBasis`), `duration_api_ms`, `session_id`, `subtype` (`success`, `error_max_turns`, `error_max_budget_usd`, `error_during_execution`, ...). [S]
- `total_cost_usd` is a *client-side estimate*; "Do not bill end users or trigger financial decisions from these fields." For subscription users it is notional. On resumed sessions totals include earlier spend (v2.1.277+): read latest, don't sum. Per-step `output_tokens` on assistant messages is a placeholder. [S]

Claude Agent SDK alternative (https://code.claude.com/docs/en/agent-sdk/overview [S]):
- Packages `@anthropic-ai/claude-agent-sdk` (TS) and `claude-agent-sdk` (Python); "A library that runs the Claude Code binary". Gives `canUseTool` callback (in-process policy gate), in-process SDK MCP servers, hooks, typed messages. From Rust/Tauri you'd need a Node sidecar to use it; spawning `claude -p` directly from Rust is equivalent and simpler.
- SDK note: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." [S]

Licensing/ToS constraint (https://code.claude.com/docs/en/legal-and-compliance [S]) - decision-relevant:
- Developers building products "should use API key authentication"; may not "offer Claude.ai login into their own applications", "route requests through Free, Pro, or Max plan credentials on behalf of their users", or "collect, store, or intermediate Claude.ai credentials". BUT: "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription". Binary must be unmodified; no removing/restricting its auth methods; usage billed to the end user. [S]
- Naming: you may say the product "runs Claude Code" in plain text; you may NOT use "Claude Code"/Anthropic names or logos in your product/feature name or logo. Agent SDK branding: allowed "Claude Agent", "{YourAgentName} Powered by Claude"; not "Claude Code Agent". [S]
- Context: Anthropic began enforcing against third-party harnesses using subscription OAuth (Feb 19 2026 doc change; subscription coverage for third-party tools ended Apr 4 2026). https://gigazine.net/gsc_news/en/20260220-anthropic-third-party-block/ [R - press, not primary]. Implication: the wallet must *spawn the user's installed, unmodified `claude`* and never read `~/.claude` credentials itself; "Advertised usage limits for Pro and Max plans assume ordinary, individual usage" [S] -> no always-on agent swarms on a subscription; show an "engine budget" honestly.

### 2.2 OpenAI Codex CLI `codex exec`

Sources: https://learn.chatgpt.com/docs/non-interactive-mode [S], https://learn.chatgpt.com/docs/developer-commands?surface=cli [S], https://learn.chatgpt.com/docs/extend/mcp?surface=cli [S], https://learn.chatgpt.com/docs/config-file/config-reference [S] (developers.openai.com/codex/* now 308-redirects to learn.chatgpt.com/docs/*).

- `codex exec "<prompt>"` non-interactive; progress to stderr, final answer to stdout. [S]/[R]
- `--json` (alias `--experimental-json`): NDJSON events `thread.started`, `turn.started`, `turn.completed` (carries `usage`: input / cached / output / reasoning tokens), `item.started|item.completed|item.failed` (items: commands, agent messages, MCP calls, file changes) [S]; additionally `turn.failed`, `item.updated`, `error` and item types reasoning / web_search / todo_list [R]. No USD cost field - compute from tokens yourself or show tokens only.
- `--output-schema <file>` JSON Schema for the final response; `-o, --output-last-message <file>` writes final message to file. [S]
- `--ephemeral` no rollout files persisted; `history.persistence = "save-all"|"none"` in config. [S]
- `--skip-git-repo-check` required when cwd is not a git repo (the wallet's sandbox dir won't be). [S]
- `-c, --config key=value` repeatable, value parsed as TOML -> inject the whole MCP server definition per run without touching the user's `~/.codex/config.toml`: e.g. `-c 'mcp_servers.wallet.url="http://127.0.0.1:47321/mcp"' -c 'mcp_servers.wallet.default_tools_approval_mode="approve"'`. [S] (quoting on Windows must be tested)
- `--ignore-user-config`, `--ignore-rules` skip user/project policy files (isolation analogue of Claude's `--setting-sources`). [S per summarizer; verify flag spelling with `codex exec --help`]
- `-m, --model`, `-p, --profile`, `-C, --cd`, `--oss` (local OSS providers), `-i, --image`. [S]
- `--sandbox read-only|workspace-write|danger-full-access` (exec default read-only); `-a, --ask-for-approval on-request|never` (the old `untrusted`/`on-failure` values appear retired - https://blakecrosley.com/blog/codex-untrusted-approval-policy-retired [R]); `--full-auto` deprecated; `--dangerously-bypass-approvals-and-sandbox` / `--yolo`. [S]
- `codex exec resume [SESSION_ID]` / `--last` continues a thread. [S]
- Restricting tools: `features.shell_tool = false` disables the default shell tool ("stable; on by default"); `web_search = "disabled"` (default `cached`); `sandbox_workspace_write.network_access` bool; `model_instructions_file` replaces built-in instructions. [S] => Codex run for a wallet agent: `-c features.shell_tool=false -c web_search="disabled" --sandbox read-only --ephemeral --skip-git-repo-check`.
- MCP in config.toml: `[mcp_servers.<id>]` stdio keys `command`, `args`, `env`, `env_vars`, `cwd`; streamable HTTP keys `url`, `bearer_token_env_var`, `http_headers`, `auth`; common `enabled`, `required` (fail startup if server can't init), `startup_timeout_sec` (default 10), `tool_timeout_sec` (default 60), `enabled_tools`, `disabled_tools`, `default_tools_approval_mode` (`auto|prompt|writes|approve`), per-tool `[mcp_servers.<id>.tools.<tool>] approval_mode`. [S]
- `codex mcp add|list --json|get|remove|login|logout`; standalone `codex mcp-server` reported removed in favour of the app server. [S]
- SDKs: `@openai/codex-sdk` (TS; startThread/run/runStreamed/resumeThread) and Python `openai-codex` (drives the local `codex app-server` over JSON-RPC, pins a CLI runtime). https://learn.chatgpt.com/docs/codex-sdk [S]
- Docs example model id `gpt-6.1-sol` (config ref) - do not hardcode model ids in the UI; read from config / let user pick. [S]

### 2.3 How to give each engine the wallet's MCP server and fence it in

Recommended topology: the Tauri Rust core runs ONE local MCP server (streamable HTTP on `127.0.0.1:<random port>` with a per-run bearer token, or a stdio shim binary the CLI spawns that talks back to the app over a named pipe/loopback). Every money-moving tool (`propose_payment`, `create_order`, `send_offer`, `cancel_subscription`) only *creates a pending intent*; execution requires the wallet's policy engine + (above threshold) the human in the wallet UI. The LLM never sees PayPal tokens.

Claude Code invocation sketch (all flags [S]):
```
claude -p --output-format stream-json --verbose \
  --tools "" --strict-mcp-config --mcp-config <tmp>/wallet-mcp.json \
  --allowedTools "mcp__wallet__*" --disallowedTools "WebFetch" "WebSearch" "Bash" \
  --permission-mode dontAsk --permission-prompts none \
  --system-prompt-file <tmp>/agent-persona.md --max-turns 12 --max-budget-usd 0.50 \
  --session-id <uuid> --model sonnet "<task>"
```
(cwd = app-owned empty dir; verify `system/init.tools` contains only `mcp__wallet__*` before trusting the run.)

Codex invocation sketch (flags [S], exec MCP approval behavior [R]):
```
codex exec --json --ephemeral --skip-git-repo-check --sandbox read-only \
  -c features.shell_tool=false -c web_search="disabled" \
  -c 'mcp_servers.wallet.url="http://127.0.0.1:PORT/mcp"' \
  -c 'mcp_servers.wallet.bearer_token_env_var="WALLET_MCP_TOKEN"' \
  -c 'mcp_servers.wallet.required=true' \
  -c 'mcp_servers.wallet.default_tools_approval_mode="approve"' \
  --output-schema <tmp>/intent.schema.json "<task>"
```
- GOTCHA: in `codex exec` the approval policy is effectively `never`, which auto-*rejects* MCP tool calls (stdin closed -> EOF read as rejection) unless the server sets `default_tools_approval_mode = "approve"`; confirmed working on Codex CLI 0.153.4 by a third party: https://github.com/LeonJoeeee/papervault/issues/116 [S]; upstream issue still open: https://github.com/openai/codex/issues/24135 [S] (opened 2026-05-22). Spike this on day 1.


---

## 3. Tauri 2 facts

### 3.0 Versions
- Tauri stable **v2.12.1** (2026-09-30); v3 alphas already published (tauri-v3.0.0-alpha.4, 2026-10-01; plugin v3 alphas e.g. stronghold 3.0.0-alpha.2 with MSRV 1.95). **Pin v2.12.x and plugin `2.x`** or resolution may drift. `gh api repos/tauri-apps/tauri/releases` [S], https://github.com/tauri-apps/plugins-workspace/releases/tag/stronghold-v3.0.0-alpha.2 [S]

### 3.1 Sidecars vs spawning a user-installed CLI
- Sidecar: `bundle.externalBin: ["binaries/my-sidecar"]`; each file **must carry the target-triple suffix** (`my-sidecar-x86_64-pc-windows-msvc.exe`, `-aarch64-apple-darwin`; get via `rustc --print host-tuple`). Rust `app.shell().sidecar("my-sidecar")?.spawn()` -> `(rx, child)`; JS `Command.sidecar('binaries/my-sidecar')`. Permission `shell:allow-execute` / `shell:allow-spawn` with `{"name":"binaries/my-sidecar","sidecar":true,"args":[..., {"validator":"\\S+"}]}`. https://v2.tauri.app/develop/sidecar/ [S]
- Non-sidecar commands from JS: scope `{"name":"claude","cmd":"claude","args":[...],"sidecar":false}`; `args: true|false|[fixed | {validator}]`, validators auto-anchored `^...$` unless `raw: true`. Shell plugin default grants only `allow-open`. https://v2.tauri.app/plugin/shell/ [S], plugins-workspace `plugins/shell/src/scope.rs` [S]
- **We should NOT bundle claude/codex as sidecars** (ToS: binary must be unmodified and user-authenticated; also they self-update) [inference + S legal page]. **Spawn them from Rust** (`tokio::process::Command`) inside a narrow `#[tauri::command]` like `run_agent(agent_id, task)`; no shell-plugin ACL applies, so the IPC command *is* the security boundary; the frontend must never assemble argv. [S/inference]
- Our own MCP shim (if stdio) *can* be a proper sidecar since we build it. [inference]
- Windows: Rust `Command::new("claude")` only auto-appends `.exe` - **it will not find an npm `claude.cmd` shim**. https://doc.rust-lang.org/std/process/struct.Command.html [S]. `.cmd` shims run through cmd.exe and re-parse argv (BatBadBut CVE-2024-24576, fixed Rust 1.77.2; follow-up CVE-2024-43402 fixed 1.81.0) [R] -> resolve the real `.exe` (native installer puts `claude.exe` in `%USERPROFILE%\.local\bin\` [R]) and pass the prompt via **stdin**, never argv.
- Windows: the shell plugin always sets `CREATE_NO_WINDOW`; your own Rust spawns must set `creation_flags(0x08000000)` or a console flashes per agent run. plugins-workspace shell `process/mod.rs` [S]; opt-out issue https://github.com/tauri-apps/plugins-workspace/issues/2135 [S]
- macOS GUI apps don't inherit shell PATH (Homebrew, nvm, `~/.local/bin` missing): `tauri-apps/fix-path-env-rs` (`fix_path_env::fix()`; git dep; issue #16 re Tauri 2 still open) https://github.com/tauri-apps/fix-path-env-rs [S], or probe `$SHELL -ilc 'echo $PATH'` once [R]. Always offer a "binary path" override in Settings.
- Windows PATH can be stale after a fresh install (Explorer env snapshot) [R] -> also probe known install dirs; `which` crate honors PATHEXT [R].
- Shell plugin supports non-UTF-8 output decoding (`encoding_rs`) [S]; for our own spawns force UTF-8 / JSON output.

### 3.2 Capabilities / permissions
- Capability files in `src-tauri/capabilities/` (JSON/TOML): `identifier`, `windows` (labels/globs), `webviews`, `permissions`, `platforms`, optional `remote.urls`. "All capabilities inside the capabilities directory are automatically enabled by default. Once capabilities are explicitly enabled in the tauri.conf.json, only these are used." Boundaries by window **label**. https://v2.tauri.app/security/capabilities/ [S]
- Remote URL capabilities: "On Linux and Android, Tauri is unable to distinguish between requests from an embedded <iframe> and the window itself." -> never grant IPC to remote origins. [S]
- `core:default` = app, event, image, menu, path, resources, tray, webview, window defaults; **`core:window:default` is getters only** (setters/close/create need explicit grants). https://v2.tauri.app/reference/acl/core-permissions/ [S], tauri source reference.md [S]
- App commands: use `tauri_build::try_build(Attributes::new().app_manifest(AppManifest::new().commands(&["run_agent", ...])))` to generate `allow-<cmd>`/`deny-<cmd>` and grant per window; without it all registered commands are callable from every window [R]. Design implication: a separate **"approval" window label** that alone can call `approve_intent` (agents' activity view can't). https://v2.tauri.app/security/permissions/ [S], tauri-build `src/acl.rs` [S]

### 3.3 Deep links (PayPal return into the app)
- `plugins.deep-link.desktop.schemes: ["com.yourco.wallet"]`; JS `getCurrent()`, `onOpenUrl(cb)`; Rust `app.deep_link()...`. https://v2.tauri.app/plugin/deep-linking/ [S]
- Windows/Linux: "Deep links are delivered as a command line argument to a new app process" -> register **single-instance first** with `features=["deep-link"]` so the URL is forwarded to the running instance. Single-instance callback `(app, argv, cwd)` does nothing by default (focus the window yourself). https://v2.tauri.app/plugin/single-instance/ [S]
- Dev mode: deep links only fire for installed apps; Windows/Linux dev needs `register_all()`; **macOS cannot register at runtime and cannot be tested in `tauri dev`** (bundle must be installed in /Applications). [S]
- Windows registration writes per-user `HKCU\Software\Classes\<scheme>` - **any other per-user app can claim the same scheme** -> never trust a deep-link payload to confirm a payment; bind with `state` (+ PKCE where applicable) and re-check order status via API. plugin `src/lib.rs` [S]; RFC 8252 recommends reverse-DNS private schemes https://www.rfc-editor.org/rfc/rfc8252 [S]

### 3.4 Secrets
- **Stronghold plugin deprecated** (issue #3494, 2026-07-16): "will not be developed further... The plugin will not be available in Tauri v3"; recommends community keychain plugins. https://github.com/tauri-apps/plugins-workspace/issues/3494 [S]
- Use `keyring` / `keyring-core` crates (open-source-cooperative/keyring-rs, active 2026-09): macOS Keychain, Windows Credential Manager, Linux Secret Service. https://github.com/open-source-cooperative/keyring-rs [S]. Community wrappers (charlesportwoodii/tauri-plugin-keyring, HuakunShen/tauri-plugin-keyring) unvetted [S]. Recommendation: call keyring from Rust only; never expose secret reads to JS.
- Windows Credential Manager blob max ~2.5 KB [R] -> store a data-encryption key in the keychain, ciphertext on disk.
- Store plugin = plaintext JSON; SQL plugin (sqlx) has no documented SQLCipher; `sql:default` is read-only, writes need `sql:allow-execute` (arbitrary SQL from frontend) -> keep the ledger/audit DB Rust-side. https://v2.tauri.app/plugin/store/ [S], https://v2.tauri.app/plugin/sql/ [S]

### 3.5 OAuth / PayPal approval flows on desktop
- RFC 8252: native apps "MUST NOT use embedded user-agents"; public clients MUST use PKCE; loopback `http://127.0.0.1:{port}/`, AS "MUST allow any port". https://www.rfc-editor.org/rfc/rfc8252 [S]
- **PayPal forbids WebViews for PayPal pages** (see Top-10 #3); also: "Session tokens that have at any time been idle for more than 15 minutes must be re-authenticated with a login before processing PayPal transactions." https://developer.paypal.com/api/rest/reference/info-security-guidelines/ [S]
- PayPal OIDC discovery: authorize `https://www.paypal.com/signin/authorize`, token `https://api.paypal.com/v1/oauth2/token`, PKCE S256 listed, **token auth `client_secret_basic` only**. https://www.paypal.com/.well-known/openid-configuration [S]. Sandbox Log in with PayPal authorize `https://www.sandbox.paypal.com/connect?...`; all scopes need PayPal approval before live. https://developer.paypal.com/log-in/build [S]
- PayPal return-URL matching is exact incl. port [R] (contradicts RFC 8252 any-port) -> pre-register fixed loopback ports. Whether a `http://127.0.0.1:port` or custom-scheme Return URL is accepted for Log in with PayPal is **unverified** - test in sandbox dashboard.
- **Orders v2**: `payment_source.paypal.experience_context.return_url/cancel_url` are `format: uri` with no scheme restriction in the schema; `user_action: CONTINUE|PAY_NOW`, `shipping_preference: NO_SHIPPING`, `payment_method_preference: IMMEDIATE_PAYMENT_REQUIRED`; approval link `rel: "payer-action"` (legacy `application_context` -> `rel: "approve"` [R]). https://developer.paypal.com/api/orders/v2/schema.json [S]. PayPal's own samples use `return_url: "http://localhost:3000/..."` (github.com/paypal/ruleshub) [S] and the iOS SDK uses custom scheme `sdk.ios.paypal://` as return/cancel URLs (github.com/paypal/paypal-ios) [S] -> custom-scheme/loopback return is **plausible, unverified for desktop**.
- Robust pattern [inference]: open approval link in system browser via opener; `return_url` = https bounce page we host (Render) that redirects to `com.yourco.wallet://approved?token=...` AND shows "return to app"; in parallel the app **polls `GET /v2/checkout/orders/{id}` until `APPROVED`**, then captures. Deep link is a UX accelerator, not the source of truth.
- `tauri-plugin-oauth` (FabianLars, v2): temporary localhost server, `start_with_config(OauthConfig{ports, response}, cb)`; "you must verify the URL" (validate `state`). https://github.com/FabianLars/tauri-plugin-oauth [S]. Opener plugin `openUrl()` for system browser. https://v2.tauri.app/plugin/opener/ [S]
- Avoid the localhost plugin for serving the app ("considerable security risks"). https://v2.tauri.app/plugin/localhost/ [S]

### 3.6 Updater, notifications, tray, misc
- **Updater**: signing mandatory, cannot be disabled; `tauri signer generate`; `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` as real env vars (".env files don't work"); `bundle.createUpdaterArtifacts: true`; Windows install **exits the app** (persist in-flight intents first); losing key = no updates. https://v2.tauri.app/plugin/updater/ [S]
- **Notifications**: "The Actions API is only available on mobile platforms" -> **no Approve/Deny buttons in desktop toasts**; click-to-focus + in-app approval. Windows: works only for installed apps; shows PowerShell name/icon in dev. https://v2.tauri.app/plugin/notification/ [S]
- **Tray**: `tauri = { features = ["tray-icon"] }`, `TrayIconBuilder` (`.menu()`, `.show_menu_on_left_click(false)`, `.on_tray_icon_event()`); Linux emits no tray icon events. https://v2.tauri.app/learn/system-tray/ [S]. Natural home for "pending approvals" badge + quick popover window.
- Autostart (`MacosLauncher::LaunchAgent`, args `--minimized`) https://v2.tauri.app/plugin/autostart/ [S]; window-state https://v2.tauri.app/plugin/window-state/ [S].
- **CSP** only enabled if set; IPC needs `connect-src ipc: http://ipc.localhost`. https://v2.tauri.app/security/csp/ [S]
- **Isolation pattern** recommended (AES-GCM IPC through sandboxed iframe); on Windows no external scripts / ES modules inside the isolation iframe. https://v2.tauri.app/concept/inter-process-communication/isolation/ [S]
- WebView2 install modes `downloadBootstrapper` (default) / `embedBootstrapper` / `offlineInstaller` / `fixedVersion`; NSIS default per-user install. https://v2.tauri.app/distribute/windows-installer/ [S]

---

## 4. Sponsor tools - what they are and the most meaningful use

Prize reality: you can win only ONE sponsor prize. Expected-value ranking [inference]: AG Grid/AG Studio (5 winners, $5k top) > APIMatic (3 x $1k) ~ Bryntum (3 x $1k) > Channel3 ($1.5k, 1 winner) > Render (credits).

### 4.1 AG Grid / AG Studio (prize $5k / $2k / $1k x3)
- Prize copy: "This award covers both what your dashboard looks like and how you build it"; judges look at custom widgets, theming, layout; "Entries should demonstrate the **Studio Agent Framework** capability." Free **45-day AG Studio trial**. Suggested: storefront analytics, anomaly-alert agent on transaction streams, NL finance agent that generates widgets, unpaid-invoice reminder agent. https://paypalaihackathon.devpost.com/details/aggrid [S]
- AG Studio: embedded analytics/dashboard component, React `ag-studio-react` (docs v3.0.0); `<AgStudio data={{sources:[{id,data}]}} mode="edit"/>`; drag-drop canvas, cross-filtering, saved views; runs fully in-app. https://www.ag-grid.com/studio/react/quick-start/ [S], https://www.ag-grid.com/blog/redefining-embedded-analytics-with-ag-studio/ [S]
- Studio Agent Framework: BYO model via adapter; runners `directLlmRunner({adapter, instructions, tools})`, **`clientToolRunner({run:(input,ctx)=>myServer.stream(...)})`** (our Rust bridge to Claude/Codex streams), or custom; built-in tools `studio.viewSchema()`, `studio.executeQuery()`, `studio.addWidget()`, `studio.configureWidget()`, `tools.delegateTo([...])`; multi-agent `createAiHarness(api, ()=>({agents, primary}))`; AG-UI event vocabulary (RUN_STARTED, TOOL_CALL_START...). No MCP mentioned. https://www.ag-grid.com/studio/react/ai-agents/ [S]
- Custom widgets: `createWidgets({additionalTypes:[AgWidgetDefinition]})` (`id, label, comp, dataMapping, form, ai` metadata), `widgetApi.getData()`; Enterprise grid/charts inside custom widgets need their own Enterprise licence. https://www.ag-grid.com/studio/react/custom-widgets/ [S]. Licence via `AgStudioProvider licenseKey`; no key = watermark + console warnings. https://www.ag-grid.com/studio/react/licence-install/ [S]
- AG Grid v36.2.0 (v36 2026-06-24: formulas/calculated columns, "Show Values As"). Community = MIT; Enterprise (row grouping, pivot, SSRM, Integrated Charts, master/detail, Excel export, clipboard, tool panels; set filter + sparklines [R]) commercial; no key = watermark; 30-day trial. https://www.ag-grid.com/javascript-data-grid/community-vs-enterprise/ [S], https://www.ag-grid.com/blog/whats-new-in-ag-grid-36/ [S]
- **Meaningful use**: the **Payments Ops Cockpit is an AG Studio dashboard** fed by Transaction Search, disputes, subscriptions and the firewall decision log; its agent runs through `clientToolRunner` -> our local engine ("show refunds > $50 by merchant this week" -> `addWidget`). Custom widgets: firewall verdict heatmap (allowed/blocked/escalated per agent), dispute-deadline countdown, haggle price-convergence chart. Multi-agent: "ops lead" delegating to "disputes" and "subscriptions" agents.
- Caveats: trial key ends ~mid-Nov if started now; never commit key (public repo); Studio 3.0 is new (API churn); plain grid alone likely under-scores.

### 4.2 Bryntum (prize $1k x3)
- Prize names only **Gantt, Scheduler, and/or Calendar**: "the cleanest timeline, the smartest resource booking, or an agent that drives the schedule itself"; ideas: subscription revenue tracking, **dispute triage boards**, "agent-driven reschedulers that respond to PayPal payment events". https://paypalaihackathon.devpost.com/details/bryntum [S]
- 45-day full trial; `npm install @bryntum/scheduler@npm:@bryntum/scheduler-trial` https://bryntum.com/download/ [S]; trial = watermark [R]; React wrapper `@bryntum/scheduler-react` `<BryntumScheduler>`, docs v7.3.7 https://bryntum.com/products/scheduler/docs/guide/Scheduler/quick-start/react [S]; pricing per dev: Scheduler/Calendar from $680, Gantt $940, Scheduler Pro $1,100. https://bryntum.com/store/ [S]
- **Meaningful use**: **Subscription Rescue Calendar** (renewals/trial-ends as events; agent places "cancel-before" rescue events), or **Dispute SLA Scheduler** (resources = disputes/agents; events = respond-by / evidence-due windows; agent reschedules on dispute webhooks), or agent budget timeline (per-agent spend windows as policy blocks).
- Caveats: competes with AG Grid for the single sponsor slot; watermark in video; bundle weight.

### 4.3 Channel3 (prize $1.5k x1)
- Must call the Channel3 API/MCP "as a meaningful part of the product experience"; "Projects that only reference Channel3 without calling it will not meet this requirement." Hackathon keys: **20,000 free credits** (+ top-ups via Discord). https://paypalaihackathon.devpost.com/details/channel3 [S]
- "100M+ products from 25,000+ retailers", normalized titles/images/prices/variants/availability/buy links; endpoints `/search`, `/image-search`, `/find-products-in-image`, `/similar-products`, `/product-detail`, **`/lookup-product`** (any product URL -> structured data), `/browse`, `/websites` (site -> id + `best_commission_rate`), reporting clicks/transactions, **price tracking** `/start-tracking`, `/get-price-history`. Access via API, SDK (`@channel3/sdk`, `CHANNEL3_API_KEY` [R]), MCP (`https://mcp.trychannel3.com`, free), CLI. Business model: brands pay commissions (affiliate buy links). https://docs.trychannel3.com/llms.txt [S], https://trychannel3.com/mcp [S], https://docs.trychannel3.com [S]
- **Meaningful use**: haggling grounding (market price band from `/lookup-product` + `/similar-products` becomes the buyer agent's reservation price and on-screen "fair price" evidence); scam shield (`/image-search` on a listing photo finds the real product/price; "paying 40% over market" alert via `/get-price-history`); readiness probe (does the merchant URL resolve to structured product data).
- Caveats: one winner; exact SDK method names [R].

### 4.4 KERNEL (partner, no prize)
- Browsers-as-a-service (kernel.sh / onkernel.com): sandboxed Chromium, CDP/Playwright/computer-use, **live view** URL + MP4 replays, stealth, persistent profiles, **Managed Auth + Vault**, spending caps; MCP server (streamable HTTP/stdio, OAuth 2.1 or API key; `kernel mcp install`). $50 hackathon credits (code KERNELDEVPOST2026); free Developer plan $5/mo credits; headless ~$0.06/h. https://paypalaihackathon.devpost.com/details/kernel [S], https://www.kernel.sh/docs/reference/mcp-server [S], https://www.kernel.sh/docs/info/pricing [S]
- **Meaningful use**: merchant agent-readiness checker (agent walks a merchant checkout in a cloud browser, checks PayPal button, bot walls, structured data; replay stored as evidence; live view embedded); **scam-shield detonation** (open suspicious links in an isolated cloud browser, never the user's machine); human-watched subscription cancellation via live view.
- Caveats: automating real merchant logins may breach merchant ToS - demo on own test store.

### 4.5 Elastic (partner, no prize)
- 14-day Elastic Cloud Serverless trial; "Once your 14-day free trial ends, your project will be deleted."; suggested: multi-step agent with Elasticsearch + **Jina** embeddings, Agent Builder, Workflows, ES|QL, A2A/MCP; local Elasticsearch also OK. https://paypalaihackathon.devpost.com/details/elastic [S]. Agent Builder MCP endpoint `{KIBANA_URL}/api/agent_builder/mcp` (API key, OAuth 2.1 on Serverless), exposes ES|QL tools; GA on Serverless / Stack 9.3+. https://www.elastic.co/docs/explore-analyze/ai-features/agent-builder/mcp-server [S]
- **Meaningful use**: scam-pattern memory (semantic + keyword search over flagged merchants, dispute texts, invoice bodies); ES|QL forensics over the decision log. Prefer **local Docker Elasticsearch** (fits local-first; avoids trial deletion during judging).

### 4.6 Postman (partner, no prize)
- Hackathon page points to PayPal's public workspace (www.postman.com/paypal) [S]; workspace covers Orders, Payments, Invoices, Subscriptions, **Payouts**, Webhooks, Transaction Search, **Disputes**, Payment Links [R]; fork, set client_id/secret, pre-request script mints token https://developer.paypal.com/api/rest/postman/ [S]; spring 2025 update added **error simulation** on Orders/Payments https://developer.paypal.com/community/blog/paypal-postman-spring-2025-update/ [S]. Postman MCP remote `https://mcp.postman.com/minimal|/mcp|/code` https://learning.postman.com/docs/reference/postman-api/postman-mcp-server/postman-mcp-remote-server [S]; Agent Mode generates MCP toolsets https://learning.postman.com/docs/design-apis/toolsets/generate-toolsets [S].
- **Meaningful use**: firewall test harness (collection + PayPal negative-testing/error simulation for INSTRUMENT_DECLINED, disputes) run in CI with Postman CLI; reference for Disputes/Payouts calls missing from the Server SDK. Mostly invisible in demo.

### 4.7 APIMatic (prize $1k x3 + 6 mo Business)
- Prize centers on the **Context Plugin** for PayPal; participants get 1 month Basic free. https://paypalaihackathon.devpost.com/details/apimatic [S]. PayPal Server SDKs are **APIMatic-generated** (TS, Python, Java, C#, PHP, Ruby) [S]. Preview plugin: `npx context-plugins install https://github.com/paypaldev/server-sdk-context-plugin-preview` - works with **Claude Code and Codex**; per-language skills (auth, endpoints, errors, testing); "Experimental... not an official long term supported PayPal product". https://github.com/paypaldev/server-sdk-context-plugin-preview [S]. Context Plugins claim "65% reduced token usage". https://www.apimatic.io/product/context-plugins [S/R]
- **Meaningful use**: install the Context Plugin into the **runtime** engine the wallet spawns (not just dev time) so local agents write correct Server SDK calls; show before/after (failed calls, tokens) in video. Or publish the wallet's local intent API as OpenAPI -> APIMatic SDK + Context Plugin so third-party agents become "wallet-ready".
- Caveat: conflicts with strict tool fencing (a Context Plugin is skills/MCP for the *coding* agent; our wallet agents shouldn't write/run code at runtime) [inference] - likely only fits a "developer mode" / "integrations agent" persona.

### 4.8 Astropods (partner, no prize)
- Real platform: deploy/run AI agents; declarative `astropods.yml`; `ast` CLI; hosted agents in isolated VMs; AI Gateway (OpenAI-compatible, no provider key); MCP support; observability; adapters incl. Claude Agent SDK [R]. https://paypalaihackathon.devpost.com/details/astropods [S], https://docs.astropods.com/welcome [S]
- **Meaningful use**: host the always-on **remote counterparty** (seller/merchant agent) for A2A haggling so the demo isn't two local processes. Caveat: dilutes the local-first story; overlaps Render.

### 4.9 Render (prize: credits $1k / $750 / $500)
- $50 credits; suggests **Render Workflows** to coordinate agents/jobs. https://paypalaihackathon.devpost.com/details/render [S]. Free tier: web services spin down after 15 min idle; **free Postgres expires 30 days after creation**; free Key Value not persistent; **background workers and cron are not free**. https://render.com/docs/free [S]. Workflows: TS/Python `task()`, retries, runs up to 24 h. https://render.com/docs/workflows [S]. MCP `https://mcp.render.com/mcp` [R].
- **Meaningful use (real need)**: (1) **PayPal webhook receiver/relay** - a desktop app cannot receive PAYMENT.CAPTURE / CUSTOMER.DISPUTE.CREATED / BILLING.SUBSCRIPTION webhooks; Render verifies and fans out via SSE/WebSocket; (2) **haggling rendezvous** relay between two wallet users; (3) OAuth/token broker holding the PayPal client secret; (4) https return-URL bounce page. Also yields a hosted URL for judges.

### 4.10 Zapier (partner, no prize)
- Zapier MCP: per-client server URL, streamable HTTP only, 40,000+ actions / "9,000+ apps"; **each successful call costs 2 tasks**; free plan ~100 tasks/mo [R]. https://docs.zapier.com/mcp/home [S]. PayPal on Zapier: 9 triggers (failed payment, refund, sale, subscription events...), 3 actions (Create Invoice, Create Payment, Send Invoice), 8 searches; no dispute triggers. https://zapier.com/apps/paypal/integrations [S]
- **Meaningful use**: out-of-band approval/notification fan-out (Slack/SMS when the firewall escalates), receipt-email search to discover subscriptions, logging settled haggles to Sheets - every Zapier action itself passes the firewall ("policy over 9,000 apps"). Caveat: tiny free budget, OAuth friction for judges.

---

## 5. Gotchas that would break a naive design

PayPal / payments
1. **Embedding PayPal login/approval in a Tauri WebviewWindow** violates PayPal's guidelines and will likely be blocked; use the system browser. [S]
2. **Shipping the PayPal client secret in the binary** - token endpoint only accepts `client_secret_basic`; need a broker backend or BYO sandbox credentials in keychain. [S]
3. **Assuming a custom-scheme / loopback `return_url` works** - schema allows any URI and PayPal's own samples use localhost/custom schemes, but desktop acceptance is unverified; build polling (`GET /v2/checkout/orders/{id}`) as the source of truth. [S]/[R]
4. **Trusting a deep link as payment confirmation** - per-user scheme registration is hijackable on Windows. [S]
5. **Using `@paypal/paypal-server-sdk` for disputes/payouts/invoices** - not in the SDK (5 controllers only). [S]
6. **Expecting webhooks to reach the desktop** - needs a public relay (Render). [S]/[inference]
7. **Designing around Agent Ready / Store Sync / ChatGPT Instant Checkout** - Agent Ready & Store Sync are gated merchant onboarding; Instant Checkout was wound down (Mar 2026). [S]/[R]
8. **A consumer "cancel any subscription" API** - none found publicly (UNCERTAIN); frame rescue as detection + guided cancellation + capped per-renewal allowance.
9. **PayPal idle-session rule**: tokens idle >15 min must re-authenticate before transactions. [S]
10. **docs.paypal.ai / docsai links 404** for some pages - pin GitHub READMEs. [S]

LLM engine
11. **Letting the LLM hold PayPal tokens or call PayPal directly** - all money tools must create pending intents behind deterministic policy (OWASP LLM06). Don't load the PayPal MCP server into the agent unfenced; proxy only whitelisted read tools through the wallet's MCP. [S]/[inference]
12. **Treating CLI permission flags as the security boundary** - user mods/hooks/settings can override; enforce in the MCP server. Also spawn in an app-owned empty cwd (a `-p` session runs a repo's `.claude/settings.json` hooks and `.mcp.json` without trust prompts). [S]
13. **`--allowedTools` is not a whitelist** - it only auto-approves; use `--tools ""` + `--strict-mcp-config` + `--disallowedTools`. `--tools` doesn't affect MCP tools. [S]
14. **Omitting `--permission-mode` in `-p`** - default may be `auto` (classifier). Pass `dontAsk`. [S]
15. **`--bare` for isolation** - breaks subscription users (no OAuth/keychain read; needs `ANTHROPIC_API_KEY`). [S]
16. **Codex exec + MCP without `default_tools_approval_mode="approve"`** - tool calls silently rejected. [S third-party]
17. **Showing `total_cost_usd` as a bill** - client-side estimate; "Do not ... trigger financial decisions from these fields"; notional for subscribers; Codex gives tokens only. Keep "LLM spend" and "wallet spend" visually distinct. [S]
18. **Using "Claude Code" in product/feature names or logos**, or reading `~/.claude` credentials - prohibited. [S]
19. **Always-on agent swarms on a Pro/Max subscription** - limits "assume ordinary, individual usage". [S]
20. **Windows `Command::new("claude")`** fails for `.cmd` shims and is an injection risk via argv; resolve `.exe`, prompt via stdin, set `CREATE_NO_WINDOW`. macOS GUI apps lack shell PATH. [S]
21. **Hard-coding model ids** (docs already show `gpt-6.1-sol`, `claude-sonnet-5`, aliases `fable`) - read from CLI/config. [S]
22. **Prompt-injection via merchant pages/listings** (hidden CSS, JSON-LD, fake CAPTCHAs, encoded text) - any merchant-sourced text reaching the agent is untrusted; the scam shield should sanitize/flag before the LLM sees it. [S]

Tauri
23. **Stronghold** - deprecated, gone in v3; use OS keychain. [S]
24. **Approve/Deny buttons in desktop notifications** - not supported on desktop. [S]
25. **Deep links in `tauri dev` on macOS** - impossible; on Win/Linux need single-instance registered first. [S]
26. **Capabilities**: listing any in tauri.conf.json disables auto-loading the rest; `core:window:default` is getters only; app commands are globally callable unless manifest-restricted. [S]
27. **Windows updater exits the app mid-install** - persist pending intents/agent runs. Updater signing key loss = no updates. [S]
28. **Store/SQL plugins are plaintext**, `sql:allow-execute` hands arbitrary SQL to JS - keep ledger Rust-side. [S]
29. **Unpinned plugin versions** may pull v3 alphas. [S]

Hackathon logistics
30. **Trials expiring during judging (Nov 13-Dec 15)**: AG Studio/Bryntum 45-day, Elastic 14-day (project deleted), Render free Postgres 30-day. Start late or degrade gracefully; the video is the durable artifact. [S]
31. **Committing sponsor license keys** to the required public repo. [S]
32. **Judges must be able to run it**: Tauri desktop + CLI engine + PayPal sandbox + keys is heavy - ship a "demo mode" (recorded engine transcripts / fixture data) and a hosted companion URL. [inference]
33. **Chasing two sponsor prizes** - only one counts. [S]

---

## 6. Spikes to run before design freeze (ordered)
1. `codex exec` + local HTTP MCP with `default_tools_approval_mode="approve"`, `features.shell_tool=false`; confirm tool calls succeed and nothing else is callable (current Codex version).
2. `claude -p --tools "" --strict-mcp-config --permission-mode dontAsk --allowedTools "mcp__wallet__*"` on a subscription login; inspect `system/init.tools`; test whether `--safe-mode` still loads `--mcp-config`.
3. PayPal sandbox: Orders v2 with `return_url` = `http://127.0.0.1:<port>/...` and = `com.yourco.wallet://...`; record what PayPal accepts and what the browser shows.
4. Log in with PayPal (if used): can Return URL be loopback? fixed port required?
5. AG Studio `clientToolRunner` streaming from a Tauri command into the Studio agent (AG-UI events) - latency acceptable?
6. Windows resolution of `claude.exe` / `codex` (npm vs native installs), PATH staleness, `CREATE_NO_WINDOW`.
7. Channel3 `/lookup-product` on 5 real merchant URLs - coverage quality for haggling/scam features.
