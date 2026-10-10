# UX guide: The Table for people who are not developers

Owner: UX/CX. Applies to every user-facing string and surface in `apps/desktop/client`.
Read this before adding or changing UI. Companion: `UX-AUDIT.md` (what was wrong, what was fixed).
Vocabulary in code: `apps/desktop/client/src/lib/words.ts` - use it, extend it, never re-spell a term.

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
| authorization / AUTHORIZED | **On hold at PayPal** | |
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
| unknown / parked money operation | **Checking with PayPal** (dashed); parked: "We couldn’t confirm a payment with PayPal. At the deadline the wallet asks PayPal what happened, and what PayPal shows decides. A hold is released; nothing is collected." | Never "failed", never "paid", never "unknown". Words in `moneyCheckWord()`. |

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
| UNCONFIRMED | Not confirmed by PayPal (the seller said paid; PayPal's statement never showed it; this wallet moved nothing) | bad (coral, never done) |
| WITHDRAWN | Withdrawn | off |
| EXPIRED | Expired | off |
| VOIDED / AUTO_VOIDED | Hold released | off |
| REFUSED | Refused (the rule or check that refused it goes next to it) | bad |
| MISMATCH | Amount didn't match | bad |
| FAILED | Failed (rescue: Renewal failed) | bad / wait |
| REFUNDED | Refunded | off |
| DISPUTED | Disputed | bad |

## Visual language

- **Status pills** (`ui-chip`): sentence case, the UI font, a leading dot in the tone colour.
  No monospace, no uppercase. Mono is for identifiers in Details only.
- **Money**: `font-variant-numeric: tabular-nums` in the UI font (`--num`). Never monospace.
- **Colour meaning is fixed** (tokens.css): teal = your side / moving, coral = the other side /
  alerts, gold = needs you / held at PayPal, green = paid, red = stopped. Always with a word.
- **Unknown** is a dashed outline with the word "unknown" or "not available yet", never a
  question-mark wall: if more than two neighbouring facts are unknown, show one line
  ("3 checks aren't available yet") that expands on click.
- **If you do nothing** (`<Silence>`): hourglass glyph, then the consequence in bold, then the
  countdown. Same look everywhere.
- **Icons over captions**: a lock for held, a check for passed, an × for stopped, an hourglass
  for deadlines, a shield for checks. Every icon has a text label or an `aria-label`.
- **Density**: macOS density stays (13px body, 12px floor). Two layers: one line per item, detail
  in a sheet, popover or the inspector.
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
- [ ] Works in light theme (Home switch) and at 1280 x 800.
- [ ] Keyboard hints only in tooltips / the `?` sheet.
