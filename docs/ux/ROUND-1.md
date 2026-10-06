# UX round 1: structure for non-technical owners

Read `UX-GUIDE.md` first (persona Maya, vocabulary, checklist). The vocabulary pass is done and
accepted: every screen already speaks plain words. Owner verdict (2026-10-06): "the UX is still
hostile to non-tech users ... component design and layout almost identical, the non-tech user
realistically does not benefit". This round changes **structure**, not only words.

## Why the screens are still hard

1. **A screen opens on a specialist instrument.** Spend opens on a lane-per-rule gate, Shield on a
   check-by-deal matrix, Tables on a price ladder chart, Rescue on a lever matrix, Book on a
   17-column ledger. Each is excellent for an expert, but Maya must learn the instrument before she
   knows whether anything is wrong.
2. **The decision is buried.** The one thing that needs Maya sits beside evidence of equal weight.
   The buttons say what to press, not what will happen.
3. **No orientation.** Nothing tells a first-time user what the screen is for, in pictures.
4. **Evidence is shown flat.** Ten checks are listed when one is the exception.

## The anatomy every screen follows

Top to bottom, in this order:

1. **Page head** (existing `PageHead`): module icon, name, one short plain subtitle.
2. **Answer** (`AnswerBar`): one sentence that answers the screen's question, coloured by state.
   - `need` (gold) when something waits for Maya: "Dan offers $329 for the 4K monitor. Your call."
   - `alert` (red) when something was stopped and she should know: "2 payments were stopped for your safety."
   - `calm` / `done` otherwise: "All quiet. 4 purchases went through on your rules this week."
   One `sub` line may add the second fact. Numbers come from the data; never invent.
3. **First-visit explainer** (`Explainer`, id = module key): three steps, an icon and at most ~6 words
   of title plus one short line each. It is dismissed with "Got it" and later reopened by a small
   "How X works" link. This is the only place an explanation sits on the surface.
4. **Your decisions** (`DecisionCard`, one per needs-you item):
   - The question is a sentence about people and money ("Pay partsco $64.00 for the USB-C dock?").
   - `why` names the rule in plain words ("Partsco isn't on your approved payees.").
   - Each option gives its outcome in `means` ("Opens the approval window to pay. Nothing moves until you confirm there.").
   - The `silence` line is required.
   - Options in Main only hand off to the approval window (`approval_open`), exactly as today.
   - Exactly one gold option per card.
5. **Everything else**: the simple list of the module's deals, one line each (existing `Row`/`Group`).
6. **Detailed view**: the specialist instrument (gate, matrix, ladder, lever matrix, full ledger)
   stays but moves behind `DetailToggle` (`useDetail(<module>)`, Simple by default). In Detailed, the
   instrument appears where the simple list was; the Answer and decisions stay on top.
   - Tables is the exception: its ladder is its decision tool (moving the price limit), so Simple
     shows a compact "price range" control, not the full chart.

Use `ChecksSummary` wherever a list of checks or rules appears: exceptions stay open, passes fold
into a count ("✓ 5 passed · 1 asks you").

The kit is in `apps/desktop/client/src/shared/ui/story.tsx` (exported from `shared/ui`), styled in
`src/design/ui.css` ("story kit"). It includes an `Icon` set; check `IconName` before drawing your own.

## Per screen targets

| Screen | Answer asks | Simple shows | Detailed keeps |
| --- | --- | --- | --- |
| Tables | "Is a deal waiting for me, and is it inside my limit?" | Decision card per needs-you table. Each live table as a card: their latest offer vs your limit as a one-line horizontal "where it stands" bar (your offers, their offers, your limit). "Change price range" opens the existing inspector steps. | Price ladder chart and tabs as today |
| Spend | "Did my agents buy anything I need to look at?" | Decision card for the held purchase. Then this week's purchases as rows: item, amount, outcome pill, and a one-line "checked by your rules: ✓ all passed" / "✕ over the per-deal limit". | The gate lanes and rule columns |
| Shield | "Did anything suspicious happen?" | Decision card for the paused payment: why it was paused ("59% above the usual price" and "New payee: first deal today"), as two plain reasons with icons. Then stopped payments as rows ("Blocked for good: deal-hub-22, $460"). | The evidence matrix |
| Counter | "Is anyone buying from my shop?" | Live orders as cards (who, what, amount, status, time left). The catalog as a simple price list: item, lowest price (editable as today), "orders now". | Filters, vs-market column, and the bottom draft bar as today |
| Rescue | "Did any renewals fail, and what should I do?" | Decision card per failed renewal: options as cards ("Do nothing: PayPal retries in 3 days", "Offer a discount", "Pause for a while"…), with unavailable fixes plainly disabled. Then fixes in progress and recovered money. | The lever matrix |
| Book | "Where is my money this week?" | Four plain totals (paid out, paid in, on hold, stopped) as large figures, then "needs attention" (on hold, links open, renewals failing), then recent payments as simple rows (date, who, what, amount, status). Ask box stays on top. | The full ledger grid, Quick views, audit trail, export |
| Deal detail | "What happened in this deal and what can I do?" | A **story**: milestone strip, then the decision card (if any), then three tabs or sections in plain order: "What happened" (conversation as a chat-like thread, newest at the bottom), "Your rules" (`ChecksSummary`), "Who you're dealing with", "Proof from PayPal". No three equal columns. | Not needed; the tabs hold everything. Details popover keeps ids |
| Home | Unchanged hero (the Dial is decided). | First-run explainer over the hub (3 steps: agents work, rules protect, you decide). The left week panel's numbers as words where helpful. | n/a |
| Settings sheet | "Is my wallet ready, and what's missing?" | A setup **checklist** first ("Connect PayPal ✓, Sign your agents' rules ✓, Choose an agent app ✕ Fix"), each step with one action. | The circuit diagram under "How your money is protected" (Detailed) |
| Connections sheet | "How do I connect with someone?" | Three large step panels, one active at a time (wizard), big code and words. | n/a |
| Agent rules sheet | "What may my agents do?" | One card per agent: their icon, name, three limits as big readable lines, "active until 2 Nov", "Change". | All rules list as today |
| Approval window | "What exactly am I approving, and is it safe?" | One plain summary sentence above the comparison ("Dan agreed to sell the 4K monitor for $329. Approving accepts that price; you pay later on PayPal."). The checklist becomes `ChecksSummary` (exceptions open). The buttons stay. | The full row-by-row comparison behind "Show all checks" |
| Tumbler | Unchanged form sizes. | The card: question sentence + one gold action + silence line; nothing else competing. | n/a |

## Invariants (unchanged, enforced in review)

- Main never releases money: decision options hand off with `approval_open` only; Enter never
  releases money (headings take focus, never a money button).
- In the approval window, a MISMATCH has no pay button, a BLOCK has no release, and privileged
  actions need an unlock. Gating logic (`gating.ts`) is not touched, only presentation.
- Unknown stays dashed, never green or zero. Counterparty text only through `Quarantine` / `NoteChip`,
  never in the Tumbler.
- Every needs-you item shows `<Silence>` (the DecisionCard `silence` prop counts).
- The mode badge stays in the title bar. The two spend meters stay separate.
- No contract, command or mock-shape change. Display only.

## Verify (each worker)

- `cd apps/desktop/client && npx tsc --noEmit -p tsconfig.json` clean.
- `npx vitest run <your folders>` green. Update expectations only where wording or structure changed
  on purpose; never weaken a safety or gating assertion.
- Screenshots: a dev server on http://127.0.0.1:1431 (start one with `npx vite --port 1431 --host 127.0.0.1`
  from `apps/desktop/client` if it is not running) and the Playwright script in the round's brief.
  Look at your screens in dark and light at 1440 x 900 (approval: 744 x 660). Iterate until a
  first-time user would understand each screen in 5 seconds.
