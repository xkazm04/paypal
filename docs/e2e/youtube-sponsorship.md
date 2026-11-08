# E2E runbook: YouTube business cooperation (a creator sells sponsorship)

The owner is a YouTube creator who sells sponsorship. Brands are the counterparties: they buy a
60-second integrated read or short shout-outs. The creator's agent haggles the price at the
creator's **Tables** inside rules the creator signs, and the money goes through **PayPal** (sandbox).
This runbook walks that case from the first launch of a brand-new wallet to the money confirmed, so
the owner can feel every part of the onboarding chore and judge whether it is pleasant.

It is played by a runner, `apps/desktop/client/e2e/youtube/run.mjs` (commands in its
[README](../../apps/desktop/client/e2e/youtube/README.md)), first on the browser preview's mock
world, then, unchanged, against the real desktop app with PayPal sandbox. The runner drives The
Table where that is harmless and **stops at every step only the owner may take** with a "You do
this" card, then watches the app until the step is done. It never approves, signs, pays, pastes keys,
confirms a connection or unlocks.

The first dry-run on the mock and its friction report: [youtube-sponsorship-dryrun-1.md](./youtube-sponsorship-dryrun-1.md).

## How the case maps onto the product

Nothing here is a new feature or a new money path. Each beat is carried by what exists:

| The case needs | Carried by | Feature doc |
|---|---|---|
| a new owner gets ready | the charter (five lines) and the tour | [onboarding](../features/onboarding.md) |
| "never below my rate, ask me above a big number" | seller rules: role sell, price range with a least-you'll-accept, Ask me above | [mandates-and-rules](../features/mandates-and-rules.md), [approval-window](../features/approval-window.md) |
| a brand to deal with | connecting by code and four words (pairing, relay) | [pairing-relay-house](../features/pairing-relay-house.md) |
| a sponsorship slot to haggle over | a seller **table** (`deal_create` from the approval window's table sheet) and its listing code | [tables-haggling](../features/tables-haggling.md) |
| the agent haggles | the practice agent (or `claude-code` / `codex-cli` once available) inside the signed band | [tables-haggling](../features/tables-haggling.md) |
| the brand's messages are untrusted | the note chip ("Their words"), never an agent's input, never in the Tumbler | [shield](../features/shield.md), [tables-haggling](../features/tables-haggling.md) |
| a big price needs the creator | "Ask me above" stops the agent; the owner approves in the approval window | [approval-window](../features/approval-window.md) |
| the brand pays | the seller's wallet creates the PayPal order; the buyer approves on PayPal; the seller collects under its signed rules with no click | [money-pipeline](../features/money-pipeline.md), [counter-shop](../features/counter-shop.md) |
| "did the money arrive" | the Book (Paid in, statement match), the deal's Proof, the safety record | [book](../features/book.md) |
| a rate card for fixed-price orders | the Counter (the shop): lowest prices per item, orders placed by other wallets' agents | [counter-shop](../features/counter-shop.md) (not used for the haggle; see gaps) |
| say the rules in one sentence | Say it (reads buying only today) | [say-it](../features/say-it.md) (gap) |
| try it without installing | the browser preview, `?first_run=1` | [preview-and-director](../features/preview-and-director.md) |

The case's data (the creator's rules, three brand briefs, one hostile message) lives in
`apps/desktop/client/e2e/youtube/briefs.json`.

## The story in twelve beats

Actors: **script** (the runner), **owner** (the creator, at a "You do this" card), **brand** (the
other wallet's owner; the creator watches). In the mock dry-run every owner step is a **simulated
owner step**, clicked through the mock's own approval window and labelled so; brand steps that need
a second wallet are shown on the preview's sample week as **reference only**.

| # | Beat | Who | Screens | Expected result | Success when |
|---|---|---|---|---|---|
| 1 | Day one: The Table opens on a brand-new wallet | script | The Table: charter (first run); tour coach marks | the charter's five lines (PayPal keys, rules, practice deal, agent app, unlock); PayPal next; the tour walks its stops | charter on screen, line I next; the tour can be walked to the end |
| 2 | Add the PayPal sandbox keys | **owner** | charter line I › approval window wallet setup › Windows credential dialog; Windows Hello | keys saved in the OS keychain | line I signed; approval window "PayPal sandbox keys saved" |
| 3 | Choose the agent app | **owner** | charter line IV | `claude-code` / `codex-cli` if ready, else "Keep the practice agent for now" | line IV signed |
| 4 | Sign the sponsorship selling rules | **owner** | charter line II and its Say it box; approval window rules editor and sign sheet | one rule set: sell, haggle, category service, items `yt-sponsor-60s`, `yt-shoutout-15s`, least you'll accept $1,200, most per deal $3,000, $5,000 and 2 deals a day, ask me above $2,000, payee `creator-studio`, offers 6, until 14 days out | "Signed with your owner key"; line II signed |
| 5 | Practice deal: connect the house seller | **owner** | charter line III › Connections › Connect a wallet › House seller; approval window four words | the house seller connected | line III signed; Home becomes the decision centre |
| 6 | Where sponsorship deals will show | script | Home, Tables, Counter, Rules | nothing open yet; each place says what will appear | each place answers "anything happening, anything for me" |
| 7 | Connect a brand (Northwind Audio) | **owner** (brand gives the code) | Connections › Connect a wallet › I have a code; approval window four words | Northwind connected, words checked on both sides | Connections lists Northwind Audio |
| 8 | Open the sponsorship table, send the listing code | **owner** | "Open a table ↗" › approval window table sheet; listing code | a seller table: Northwind, service, `yt-sponsor-60s`, 1 × $2,400 asking | "Your table is open" with a code; Tables tab counts 1 |
| 9 | The brand joins, the agents haggle; brand notes arrive, one hostile | **brand**; script checks | Tables, deal page, note chip, Watch the haggle; Tumbler | offers inside $1,200 to $3,000; notes only behind the note chip; the hostile note changes nothing | Negotiating with offers; hostile text absent from Tumbler and approval window; price, state and rules unchanged |
| 10 | Above "Ask me above": the owner approves the price | **owner** | Tumbler gate card; decision centre "Review ↗"; approval window review, hold to approve | above $2,000 the agent stops; the owner holds "Approve $X" or lets it lapse | the table reads Agreed (or Withdrawn by its deadline) |
| 11 | The order; the brand pays on PayPal; the wallet collects | **brand** (+ owner if the order needs approval) | approval window order review; brand's PayPal sandbox; Tables / Counter states | order created (by rule under $2,000, else by the owner); brand approves; the wallet authorizes and collects with no click | the deal reads Paid (collected), receipt saved |
| 12 | Money confirmed | script (owner optional) | Book (Paid in, statement), deal Proof, safety record | Paid in $X, "On statement" once PayPal's report catches up (up to 3 h) | Book lists the deal paid in |

### The owner's steps, in order

These are the only things the owner is asked to do (live run). Everything else the runner does or
watches.

1. **Beat 2** · PayPal sandbox keys: The Table › charter line I › "Add PayPal keys ↗"; in the
   approval window unlock with Windows Hello if asked, "Add PayPal keys…", paste Client ID and
   Secret into the Windows dialog.
2. **Beat 3** · Agent app: charter line IV › choose `claude-code` / `codex-cli` if ready, else "Keep
   the practice agent for now".
3. **Beat 4** · Selling rules: the rules editor in the approval window; build the seller rules by
   hand (no seller template), "Review & sign rules…", "Sign with your owner key".
4. **Beat 5** · House seller: Connections › Connect a wallet › House seller › Paid to › "Connect with
   the house"; tick the four words; in the approval window name it and "All four match: connect".
   (Skip with `s` if the build reports the house unavailable.)
5. **Beat 7** · The brand: type the brand's code, Sell, Paid to, Join; compare the four words with the
   brand; in the approval window name them and "All four match: connect".
6. **Beat 8** · The table: "Open a table ↗" › Northwind, your rules, Service, `yt-sponsor-60s`, 1,
   2400.00 › "Open the table"; copy the listing code to the brand.
7. **Beat 9** · Watch (the brand joins with the code and haggles).
8. **Beat 10** · Above $2,000: "Review ↗" › read the checklist › hold "Approve $X", or let it lapse.
9. **Beat 11** · If the decision centre asks, approve the order (hold); the brand approves on PayPal.
10. **Beat 12** · Optional: Book › "Check my PayPal statement".

## Success criteria for the whole run

- Every beat ends **done** (live) or **done (simulated owner step)** / **reference only** (mock),
  with no harness error and no console error.
- Money: the deal reads Paid with a receipt, the Book shows it as Paid in, and PayPal's sandbox
  shows the capture on the creator's business account. No money moved at any step the owner did
  not decide or sign a rule for (the safety record lists who decided each money step).
- Safety: the hostile note never reaches the Tumbler or the approval window, never changes the deal
  or the rules; the agent never offers below $1,200 or above $3,000.
- UX: for each beat the friction log answers "where am I", "what happens next", "did it work", counts
  the clicks, and lists unexplained module words and dead ends. The owner's own notes (`n <text>` at a
  card) sit beside them.

## Known gaps (recorded, not faked)

Product support missing for this case, each found in the docs and confirmed by the dry-run where
the mock can show it:

1. **No seller template, and Say it does not read selling.** The three ready-made rule sets all buy;
   a selling sentence is "not read". The creator builds seller rules by hand: roles, per-deal kind,
   category, items by code, payee, four levers. (templates.ts; say-it.md)
2. **The charter asks a seller to practise buying.** Line III is a purchase from the house seller;
   there is no practice buyer. In a debug build the house is unavailable, so the charter cannot
   complete live. (onboarding.md; pairing-relay-house.md)
3. **One price range per rule set.** The sponsorship and the shout-out share one least-you'll-accept;
   a lower floor for shout-outs needs a second rule set. (mandates-and-rules.md)
4. **Items are codes.** `yt-sponsor-60s` is what the creator types and what the brand sees; there is
   no catalog. (counter-shop.md)
5. **The brand needs its own wallet, on another PC or Windows account, and a relay.** One wallet per
   Windows user (`%APPDATA%\dev.thetable.wallet`, no override); the relay attaches only from
   `TABLE_RELAY_URL` at launch. (native.rs; pairing-relay-house.md)
6. **The listing code travels out of band.** No screen shows the creator's open tables to a brand.
   (counter-shop.md)
7. **A wallet seller refuses below-floor offers instead of countering.** Only the house counters, so
   a brand that opens low gets refusals, not a counter. (tables-haggling.md)
8. **No screen sends a note.** The hostile brand message can only come from a wallet built to send
   one; the run checks the receiving side. (pairing-relay-house.md: NOTE)
9. **The Counter is not the haggle.** Fixed-price brand orders would land at the Counter (shop rules,
   role "shop"), but no brand-side screen places such an order; the case uses Tables. (counter-shop.md)
10. **Native agent apps are not connected yet**; the practice agent negotiates. (agents-and-engines.md)
11. **The live money path is unverified in the product itself**: the two-account seller authorize and
    capture has never run against the sandbox. (money-pipeline.md, spike 3)
12. **The mock never moves a new table past Listed**: no counterparty agent runs in the preview, so
    beats 9 to 12 are seen live only, or on the sample week's recorded deals.

## Running it

See the runner's [README](../../apps/desktop/client/e2e/youtube/README.md) for the exact commands:
(a) the mock dry-run, (b) live against the desktop app over CDP, and the observe-only fallback
(desktop screenshots plus a read-only copy of the wallet's ledger). Output goes to
`e2e-out/youtube/<timestamp>/` (gitignored): `results.json`, `friction.md`, `shots/`.
