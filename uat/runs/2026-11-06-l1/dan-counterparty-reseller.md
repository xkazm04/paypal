# L1 walk: Dan, reseller across the table (counterparty, floor secrecy)

Level: L1 (code-grounded, no browser). Findings: `dan-counterparty-reseller.findings.json` (DAN-L1-01..12).
Layout note: the brief named `crates/table-wallet`, `domain`, `house-seller`; the real layout is `crates/table-{core,app,proto,runtime,ledger,engine,mcp,relay}` and `services/house-seller`.
Tests run (cheap, shared target): `table-core --lib` mandate+negotiation 21 ok; `table-runtime --lib` relay/house/glass 55 ok; refusal/policy/agent_surface 17 ok.

## Surface model and reachable set
- Dan's windows: `main` (Counter, Tables, deal page), `tumbler`, `approval` on his own wallet (window-duality). Floor edits: Counter draft -> `approval_open` only (CounterLayer.tsx:3-7).
- Wire (what Maya's side can ever receive from Dan): Listing, Counter, Accept, Settle, Receipt, Withdraw(ReasonCode), Note (envelope.rs:144-201); pairing identity (keys, side, payee, expiry; pairing.rs:14-23). No mandate.
- Agent surface: typed `AgentProjection` (floor is shown to Dan's own agent), seven MCP tools, deterministic policy engine only; native engines `available:false` (native.rs:626).
- Reachable for Dan: the owner-side Counter board, Tables, deal records, approval. Not reachable (not built): shop_search/quote/checkout.
- The HOUSE (`services/house-seller`) is the scripted stand-in on a judge's install, not Dan's own wallet.

## Specific checks (verified, not assumed)
1. Floor or mandate disclosed to the buyer side? Wallet seller: no path (DAN-L1-09). HOUSE: yes by design, the mandate and floor travel in every `HouseResponse` and in the public ledger view; the scan's C-14 is still open, with the acceptance rule hardened (DAN-L1-04). One owner-driven path exposes the floor: the proof file Dan chooses to send (warned, DAN-L1-05). One inference channel: counters concede toward the floor and the last counter equals it (inherent), and the silent-reject oracle (DAN-L1-02, plausible).
2. Concession below floor or capture without signed authority? No (DAN-L1-10): clause 4 on offer, accept and every money step; capture needs owner ticket, clause-6 policy (not for purchases), seller mandate on a buyer-approved order, or the pinned HOUSE mandate.
3. Counterparty free text as instructions? No (DAN-L1-11).
4. C-14 status: open and mitigated, not closed. Scan entry has no Status line, cites stale `hosted.rs:311` (now `:668`); mitigation `decide_on_schedule` at `hosted.rs:827,863`, STATUS.md:1702. Floor bid still wins in the final round.

## Journey verdicts
| Journey | Verdict | Why |
|---|---|---|
| haggle-and-watch | **L1-conditional** | Floor never shows and nothing settles below it, but a wallet seller never counters (DAN-L1-01, major), below-floor offers leave no readable step (-03), physical goods wait for Dan's click (-06). |
| attack-the-table | **L1-pass** | Each attack class I traced (over-ceiling/under-floor price, replayed nonce or wrong audience, note injection, wrong payee, capture out of state) is refused before any PayPal call and recorded; open items are info-level (C-14 housekeeping, latent native-seat floor). Counters of $0.00 / 0 asks are L2's to see. |
| counter-shop-and-wallet | **L1-fail** | Job 3 (quote the catalog to other agents) has no affordance: the three catalog tools are absent and per-SKU floors are one mandate per group (DAN-L1-07, major). The owner-side board, floor signing and market-age display are sound. |

## Time saved (if it all worked) and confidence
- Designed upside: about 15-25 min per sale (message haggle plus hand invoice plus capture), confidence low: the docs claim no figure and the manual baseline is an assumption.
- What the code delivers today for a wallet seller: create/authorize automatic, capture automatic for digital only; no autonomous bargaining. Realistic saving about 5-10 min per sale for shipped goods, confidence low. Grounding score: not applicable (no in-product LLM prompt surface; env.md).

## Dan, in voice
"Straight answer. My number is safe: I looked for a way Maya's side reads my floor and there isn't one on a normal table, and nothing I sign can go under it. Good. But what's my agent for? Someone offers under my floor, it says nothing, the table dies. Someone offers my floor, it takes it, first try, no haggle. I'm not asking it to bargain me down, I'm asking it to bargain me up, and it only knows how to say yes. The HOUSE shows the right behaviour; give me that. Monitors ship, so I still click capture on every one; fine, say so. And the shop for other people's agents isn't there at all. I'd run it for the digital stuff and the receipts. I would not yet tell a peer it haggles for them. If I send my proof file somewhere my floor goes with it; the warning is honest, a receipt-only export would be better."

## Ranked findings (impact = frequency x reachability x trust erosion)
1. DAN-L1-01 major: wallet seller never counters; first offer at or above floor accepted.
2. DAN-L1-07 major: catalog shop tools and per-SKU floors absent; not in accepted-gaps.
3. DAN-L1-06 minor: auto-capture only for digital goods.
4. DAN-L1-03 minor: inbound below-floor offers invisible in history.
5. DAN-L1-02 minor (plausible): silent unrounded reject is a floor oracle and a dead table for honest buyers.
6. DAN-L1-05 minor: proof file carries the floor (warned).
7. DAN-L1-04 minor: C-14 open, stale reference, needs a recorded decision.
8. DAN-L1-08 info: floor in a future native seat's context.

Strengths to protect: DAN-L1-09 (no floor on the wire), -10 (one clause-4 gate on every step), -11 (typed projection, notes quarantined), -12 (floors sign only in approval, market age shown).

## Reachability and gaps in the surface model
Every finding is code-only. L2 on the preview server can show the owner-side Counter, deal records and the proof-save sheet, but the preview runs a MOCK backend with a HOUSE recording (D-0205): it cannot exercise a wallet seller's below-floor path (DAN-L1-01/-02/-03). Those need the Rust relay tests or the native shell (not browser-drivable). Nothing here was run against live PayPal (accepted gap).
