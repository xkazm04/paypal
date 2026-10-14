# UX guide: The Table for people who are not developers

Owner: UX/CX. Applies to every user-facing string and surface in `apps/desktop/client`.
Read this before adding or changing UI. Companion: `UX-AUDIT.md` (what was wrong, what was fixed).
Vocabulary in code: `apps/desktop/client/src/lib/words.ts` - use it, extend it, never re-spell a term.
Since the console rebuild (2026-10-14, DECISIONS section 40) each console area has its own words
file, `src/lib/words/<area>.ts` (`tables`, `spend`, `counter`, `book`, `shield`, `rescue`, `deal`,
`rewind`, `rules`, `connections`, `settings`, `safety`, `setup`, `framework`, `approval`), re-exported
by `words.ts`; prefix an export with its area, and never rename an existing export.

## Who we design for

**Maya** runs a small refurbished-electronics shop. She uses PayPal every day, knows what a
refund, an invoice and a hold are, and has never opened a terminal. She lets AI agents buy, sell
and haggle for her because it saves her hours, and she will stop if the app ever makes her feel
she does not know where her money is.

She must be able to answer three questions on any screen within two seconds, **without reading a
paragraph**:

1. **Is my money safe right now?** (moving / held / paid / stopped)
2. **Does anything need me?** (gold, with a time left)
3. **What happens if I do nothing?** (silence never sends money out, and the card says which it is: nothing moves, a hold is released, or a payment the buyer already approved comes in)

## Principles

1. **The design explains, not the caption.** If a component needs a sentence underneath to be
   understood, fix the component: a better label, an icon, a shape, an order, a colour with a word.
   Explanations go one layer down (an ⓘ popover or the inspector), never as a permanent hint.
2. **Plain words first, proof one click away.** Layer 1 speaks Maya's language ("Paid",
   "Most you'll pay", "Approved shops"). Identifiers, hashes, clause numbers, protocol verbs and
   PayPal ids live in Layer 2 ("Details" / "Proof"), where a dispute or an accountant needs them.
3. **Never name the machinery.** No "Rust", "backend", "P3", "projection", "envelope", command
   names (`book_query`, `mandate_list`), error codes (`UNAVAILABLE`) or file/crate names in any
   user-facing string, `title` or `aria-label`. Say what it means for Maya instead.
4. **Honest, calmly.** Unknown stays unknown (dashed, never green, never zero) and unbuilt stays
   unbuilt, but say it once, softly ("Not connected yet"), not as a red disclaimer per cell.
   Collapse repeated unknowns into one line.
5. **One decision per screen, and it looks like one.** The gold button is the only thing that
   needs Maya. Everything else is quieter. Never two gold buttons in one view.
6. **Numbers are the interface.** Money is large, sans-serif with tabular figures, and coloured by
   what it is doing (held gold, paid green, struck-through when it never moved).
7. **Shortcuts are a bonus, not a lesson.** Keyboard hints live in tooltips and the `?` sheet,
   never as a permanent footer line.

## The console (main window, since 2026-10-14)

The main window is one console: a **decision centre** ("What needs you") with a stack of nested
**layers** above it. Every surface below is one of them; the approval window is the only other
window that can approve, and the Tumbler stays on the desk.

- **The centre** shows one decision at a time, in the wallet's order: kicker, the sentence with the
  amount, who and what, the **If you do nothing** line with its countdown chip, ONE gold action
  (it only opens the approval window), **Later**, **Open the deal**, **Why?**, and the facts strip.
  The **seal** says the wallet's state in a word (Quiet, Watching, A deal needs you, Holding, Paid,
  Stopped; `SEAL_WORD`); "Paid" only after PayPal confirmed it. The small Dial is the **bead strip**
  beside it (one bead per deal, needs first; a bead opens its deal). "Next in the stack" fills the
  row below with the next decisions, then "While you were away", then "Watching".
- **Tabs**: the six module tabs sit on the stack's top edge, with counts (99+ above 99) and a gold
  badge for what waits. One tab stop; arrow keys move along them; keys 1 to 6 open them.
- **Layers** go at most five deep (centre, module, module view, deal, deal view). The top bar's
  **Back**, **Esc** and the crumbs walk the same chain; going up puts focus back on the control
  that opened the layer. Rules, Wallet limits, Connections, Connect a wallet, Settings, the safety
  record, Rewind and the charter are layers too (no sheets, except the Quit confirm and the
  shortcuts help). A card opens a **view** of its layer; the view is in the address, so Back and a
  reload keep it.
- **A module summary** = the one answer line, "Your call" (count + the first decision's "If you do
  nothing"), at most one gold action, three or four cards, the explanation behind a disclosure, and
  the **Latest strip**: a quiet "Latest: ..." heading, the first 3 to 8 rows of the area's most
  relevant list (as many as fit), each opening its deal, and **See all · N more ›**. No gold in the
  strip, ever. A short place ends with **As it stands now** facts instead.
- **Lists** (`ListEngine`): search, filter chips with counts, sort, "Showing N of M". In a list with
  a pane, a click picks a row and shows it beside the list; Enter opens it (`LIST_TWO_STEP`).
  Escape clears the search first, then goes back.
- **The footer** carries the mode badge, the preview badge, the agents, today's two meters, the
  safe-default line "Waiting never pays · nothing moves without you", calm motion, theme and `?`.
- **One theme, one app**: the main window, the approval window and the Tumbler follow the stored
  theme and the calm choice (Settings > Appearance, or the footer).

## Vocabulary (Layer 1)

| Internal | Say | Notes |
| --- | --- | --- |
| mandate | **rules** ("Shopper rules", "your signed rules") | Name a mandate by its agent role, never by its id. Version only as "updated 3 Oct". |
| clause N | the rule's name (table below) | Clause numbers only in Details. |
| band / ceiling / floor | **price range** / **most you'll pay** / **least you'll accept** | |
| rounds | **offers left** / "round 5 of 6" | |
| countersign / owner accept | **Approve** | |
| capture | **Pay** (buyer) / **Collect** (seller) | "Capture" only in Details. |
| void / auto-void | **Cancel and release the hold** / **releases by itself** | |
| authorization / AUTHORIZED | **On hold at PayPal** | A payment being checked with PayPal is not on hold: see the "On hold, on Home and in the Book" row (DECISIONS section 34). `amountNote` (`windows/main/logic.ts`) still returns 'on hold at PayPal' for every AUTHORIZED deal, with no check of `money_check`; that is an open item of DECISIONS section 36. |
| counterparty | their name; "the other side" when generic | |
| pairing / words confirmed | **connect** / **verified** | "Pair" is fine as a verb (like a headset). |
| HOUSE seller | **House seller** (a demo shop that is always open) | Never all-caps. |
| engine (claude-code, codex-cli) | **agent app**; keep the product id as the value | Never vendor names (AGENTS.md). |
| silent → X | **If you do nothing:** X (with the hourglass) | Use `<Silence>`. |
| shield CLEAR / ASK / HOLD / BLOCK | **Looks safe / Check with you / Paused for you / Blocked** | |
| reconciled / statement | **On PayPal statement / Not on statement yet / Statement differs** | |
| p65 (percentile) | **typical / a bit above typical / well above typical** | Use `marketWords()`; percentile in the tooltip. |
| refused at clause 3 | **Over the per-purchase limit** | Name the rule, then the number. |
| Unlocked / LOCKED | **Unlocked** / **Locked, unlock with Windows Hello** | |
| sandbox / replay / scripted engine | **Sandbox / Replay / Practice agent** | The mode badge is mandatory (design §10.1); case is not. |
| unknown / parked money operation | **Checking with PayPal** (dashed); parked: "We couldn’t confirm a payment with PayPal. At the deadline the wallet asks PayPal what happened, and what PayPal shows decides. A payment PayPal already took stays paid. A hold PayPal shows is released at its own deadline, unless it is paid first: by you, or by your rules when it is a sale delivered at once. If PayPal shows no payment, no money moves." | The words never say this payment failed or was paid; they may say a payment PayPal already took stays paid (r3 value-2). Never "unknown". Words in `moneyCheckWord()`. Once the deal has ended the pill reads **Not shown by PayPal** (`moneyCheckPill(check, isTerminal(deal))`); while the payment is being checked the Money line reads "not confirmed yet · PayPal is being asked" (`MONEY_CHECK_NOW`, via `moneyCheckNow`). |
| a parked step whose deal ended (EXPIRED) | card: **Look at $X in PayPal**; its Why? reads `MONEY_CHECK_ENDED`, then "The deal has ended and the wallet sends nothing more: look at this payment in PayPal."; deal page: "PayPal never showed what happened to this payment, so the wallet stopped asking and the deal ended. Look at the payment in PayPal: the wallet sends nothing more." | `MONEY_CHECK_ENDED_SILENCE`, `MONEY_CHECK_ENDED`. No clock on the card, and no "If you do nothing" frame: the deal has already ended and nothing waits on the owner's silence (DECISIONS section 32). The pill reads **Not shown by PayPal** and the Money line "PayPal never showed what happened · look at this payment in PayPal" (`MONEY_CHECK_ENDED_NOW`). No surface says no money moved for such a deal: the Rewind, Who decided, What you were shown and the away card word it from `endedBeforePayPalShowed` or, when the steps cannot tell, from the deal's own record (`windows/main/unshown.ts`; DECISIONS section 34). |
| a parked step still being checked (the card) | **Checking** chip; the card's Why? ends "If you do nothing, at the deadline the wallet asks PayPal what happened, and what PayPal shows decides: a payment PayPal already took stays paid." | `MONEY_CHECK_SILENCE`, byte-identical in `table-attention` and `lib/words.ts`; `cardWhy` in `windows/tumbler/logic.ts`. |
| a held payment at its deadline (an authorized order) | seller's card asks **Collect or release $X**; its Why? ends "If you do nothing, the hold releases itself at the deadline; nothing is taken." Buyer's card asks **Pay or release $X** | `SELLER_AUTHORIZED_SILENCE` (`table-attention`, byte-identical copy in `lib/words.ts`); the buyer's Rust headline "Capture or void" is rewritten by `headlineWords()`. A forecast line replaces the seller's silence when the wallet would collect. |
| UNCONFIRMED, by whether a statement read happened | read came back unmatched: "The seller said it was paid, but PayPal’s statement did not show the payment. This wallet moved nothing."; no read: "…but this wallet did not check PayPal’s statement. It moved nothing."; not known: "…but this wallet has no match for it on PayPal’s statement. It moved nothing." | `unconfirmedMeans(read)`. Never "a delay, not a doubt". The proof card, the Statement rows (7bb3c6a), the Book tip and the state's means all use it; the Evidence sheet has no separate "Ended" row. |
| statement check on UNCONFIRMED | **Check my PayPal statement**; without PayPal keys: "Checking your PayPal statement needs your PayPal keys. Add them in your wallet setup first. The check only reads; it never pays." | `STATEMENT_CHECK_NEEDS_KEYS`. |
| UNCONFIRMED in the Book | bucket **Not confirmed** (an end, apart from In progress; tip "ended: the seller said it was paid, but your wallet has no match for it on PayPal’s statement"); statement chip **no match** (dashed); 'PayPal agrees' legend **Not confirmed N**; the statement filter has **No match** and the lens table a dashed chip (`statementKey` keys an UNCONFIRMED end apart from Not yet; the CSV keeps its values) | `UNCONFIRMED_STATEMENT_WORD`; the reading guide says "paid, on hold, in progress, not confirmed and stopped each have their own column and total". |
| On hold, on Home and in the Book | a payment being checked with PayPal is **not** on hold: Home's On hold and the Book's On hold figures (the tile, the week answer, the grid totals, the lens table) leave it out, and it shows as **Checking with PayPal** (**Not shown by PayPal** once the deal ended). The live bead tip shows the check's pill and Money line | `heldAtPayPal(held, checking)` and `sums(deals, checking)`; `moneyCheckPill`, `moneyCheckNow` (DECISIONS section 34). A checked deal's Book row still shows its amount in its column. |
| an ending whose record could not be read | pill **Not available yet** (`ENDING_UNREAD_PILL`); Money line "not available yet · this deal’s record could not be read" (`ENDING_UNREAD_NOW`) | `useEndedUnshown` returns `unshown`, `unread` and `pending`; an ending whose `deal_evidence` read was rejected, timed out or lies past the read cap is `unread`. The Rewind narrates `endingUnreadSentence` and the away card words it with `endingUnreadLine`. No surface words such an ending as "no money moved" (DECISIONS section 36, deb1002). |
| a Rewind bead whose payment outcome is not known; a busy week | a dashed bead, never on hold; its legend reads "not known yet" (`BEAD_UNKNOWN_LEGEND`). A busy week reads "A lot happened this week, so only the latest steps are here. Older steps are in Book’s record." (`REWIND_TRUNCATED`) | `beadLook.ts` (`liveLook`, `pastLook`) holds the mapping (662286b). `REWIND_TRUNCATED` shows when `deal_history` sets `truncated` (b8625d3). DECISIONS section 36. |
| UNCONFIRMED in While you were away | "N deals ended as not confirmed by PayPal: the seller said they were paid, but your wallet has no match for it on PayPal’s statement (this wallet moved nothing)"; the tail changes with the read, as above | `home/away.ts`. The summary no longer opens with "No money moved." when this line is present. |
| walk-away forecast, UNCONFIRMED | "D-0189 ends as not confirmed by PayPal" | Tumbler, `windows/tumbler/logic.ts:557`. It no longer says "unless PayPal’s statement shows it first". |
| first-run deals started by the path | **Under way** (section), **Open ›** ("Open this practice deal") | `START_UNDERWAY`. |
| house seller already connected | **Open a new practice table** (sub: "The house seller is already connected. You check its four words once more. No money moves."); first time: **Connect with the house seller** | `connect` stays for first pairing only; `windows/main/setup/pairing.ts`. |
| paid_today / out_today (the footer and Wallet limits) | footer **Paid out today** = money PayPal collected today (never a hold, an agreed payment, a payment being checked, a refund or an unconfirmed one); Wallet limits **Budget used today** = every payment the agents agreed to today, paid or not | The two sit side by side in Wallet limits with a note; never call the budget "paid out" (`LIMITS_PLACE.budget*`, `RULES_CARD.limitsBudgetNote`; DECISIONS section 40). |
| the week's lists | **Recent purchases** (Spend), **Closed orders** (Counter), **This week** only where the list is the week | A list of every deal is never titled by the week (scale finding 10). |
| set up / onboarding page | **Your wallet’s charter** (five lines, I to V) | `CHARTER_*`. Lines that need the approval window say so and hand off. |
| the approval window, from the console | **Approvals · the one place money is approved**; its close button **Back to The Table** | `APPROVAL_FRAME` (`lib/words/approval.ts`). "Authorised" stays internal. |
| a deferred decision | **Later** (moves it to the back of the centre's queue; nothing is decided) | `LATER`, `LATER_TOAST`. |

Rule names (mandate clauses):

| Clause | Name | Sentence form |
| --- | --- | --- |
| 1 roles | What agents may do | "may buy and haggle" |
| 2 counterparties | Who they deal with | "only shops you connected" |
| 3 per_deal | Limit per deal | "up to $200 each" |
| 4 band | Price range | "most you'll pay $340" |
| 5 velocity | Daily limit | "up to 5 deals and $900 a day" |
| 6 human_present_over | Ask me above | "asks you above $250" |
| 7 payees | Approved payees | "only packrite-supply, cablehaus" |

Deal states (`stateWord()`):

| State | Word | Tone |
| --- | --- | --- |
| PAIRING | Connecting | live |
| LISTED | Listed | live |
| NEGOTIATING | Negotiating | live |
| AGREED | Agreed | live |
| SETTLING | Preparing payment | live |
| AWAITING_APPROVAL | Waiting for approval (seller: Waiting for buyer) | wait |
| APPROVED | Approved on PayPal | wait |
| AUTHORIZED | On hold | held |
| CAPTURED | Paid | done |
| RECEIPTED | Paid, receipt saved (buyer haggle or shop order, on the seller's receipt alone: Seller says paid) | done (seller says: wait) |
| RECONCILED | Paid, on statement | done |
| UNCONFIRMED | Not confirmed by PayPal (the seller said paid; the means line says whether a statement read found nothing, see the rows above; this wallet moved nothing) | bad (coral, never done) |
| WITHDRAWN | Withdrawn | off |
| EXPIRED | Expired | off |
| VOIDED / AUTO_VOIDED | Hold released | off |
| REFUSED | Refused (the rule or check that refused it goes next to it) | bad |
| MISMATCH | Amount didn't match | bad |
| FAILED | Failed (rescue: Renewal failed) | bad / wait |
| REFUNDED | Refunded | off |
| DISPUTED | Disputed | bad |

## Visual language

- **Theme**: the Calibre tokens (`design/tokens.css`, night default, day): blue-black slate, cool
  steel inks, hairline graticule decoration, machined radii. UI face Archivo, figures Sofia Sans
  (both bundled, OFL). Decoration (seal, mark, graticule, module plates) is never the only carrier
  of a meaning and stops under reduced motion and the in-app calm switch.
- **Status pills** (`ui-chip`): sentence case, the UI font, a leading square LED in the tone colour.
  No monospace. Uppercase only for small tracked labels (kickers, facts-strip labels), never for a
  pill or a sentence. Mono is for identifiers in Details only.
- **Money**: tabular lining figures in the numeric face (`--num`, Sofia Sans). Never monospace.
- **Colour meaning is fixed** (tokens.css): teal = your side / moving, coral = the other side /
  alerts, gold = needs you / held at PayPal, green = paid, red = stopped. Always with a word.
- **Unknown** is a dashed outline with the word "unknown" or "not available yet", never a
  question-mark wall: if more than two neighbouring facts are unknown, show one line
  ("3 checks aren't available yet") that expands on click. For a money outcome the word is
  never "unknown": a payment being checked reads "Checking with PayPal", and an ending whose
  record could not be read reads "Not available yet" (DECISIONS sections 34 and 36).
- **If you do nothing** (`<Silence>`): hourglass glyph, then the consequence in bold, then the
  countdown. Same look everywhere.
- **Icons over captions**: a lock for held, a check for passed, an × for stopped, an hourglass
  for deadlines, a shield for checks. Every icon has a text label or an `aria-label`.
- **Density**: 14px body in the main and approval windows, 13px in the Tumbler's fixed forms, 12px
  floor everywhere (`design/tokens.test.ts`). Two layers: one line per item, detail one layer down
  (a card's view, the pane beside a list, or a disclosure).
- **Focus**: visible for keyboard users (`:focus-visible`), never a ring around a heading that
  received programmatic focus.

## Copy rules

- Sentence case for everything: buttons, headings, pills, column headers.
- Buttons say the outcome: "Approve $329.00", "Cancel and release hold", not "Submit" / "OK".
- Lead with the subject Maya cares about: "Dan offers $329" before "#11 COUNTER".
- At most one line of supporting text under a heading. If you need two, it belongs in an ⓘ.
- Numbers: "$64.00", "2 days 18 h left", "today 14:45". No "2 d 18 h" in sentences.
- Never write a sentence that only a developer could verify ("projected to this window").
  Replace it with what Maya can do or should expect.

## Checklist for a new or changed surface

- [ ] Can Maya answer the three questions without reading a hint line?
- [ ] No internal word from the vocabulary table on Layer 1 (grep: `Rust|P3|clause \d|UNAVAILABLE|_list|_query`).
- [ ] State pills come from `stateWord()` / `shieldWord()`; money uses `--num`.
- [ ] Every needs-you item has `<Silence>`; exactly one gold action.
- [ ] Unknowns are dashed and grouped; nothing unknown looks green or zero.
- [ ] Works in light theme (footer or Settings > Appearance) and at 1280 x 800 and 1920 x 1080, on
      `?scale=small` and `?scale=large`; no dead band over about 120 px (use the Latest strip).
- [ ] Keyboard hints only in tooltips / the `?` sheet.
- [ ] A console layer: one h1 (the answer line), Back only from the top bar, Esc goes one layer up,
      focus returns to the opener; a long list is a `ListEngine` (windowed, counts via `formatCount`).
- [ ] Strings live in `lib/words.ts` or the area's `lib/words/<area>.ts`, and the area's words
      guard passes (PayPal is the only vendor name; no ids, deal labels, clause numbers, raw states).
