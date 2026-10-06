# UX audit: The Table client (2026-10-06)

Lens: a non-technical PayPal merchant ("Maya", see `UX-GUIDE.md`) using the app for the first time.
Method: every surface rendered from the mock backend at the real window sizes (main 1440 x 900,
approval 744 x 660, Tumbler preview), dark and light, plus a source sweep for user-visible strings.
Baseline before the pass: 312 client tests green, typecheck clean.

## Verdict before the pass

The visual foundation was strong: the Dial is a memorable hero, the colour semantics (teal yours,
coral theirs, gold needs-you, green paid) are consistent, the two-layer density is right, and the
honesty rules (default on silence, unknown is dashed, quarantined counterparty text) are real
product strengths. The problem was the **voice**: the interface spoke to the people who built it.

| Finding | Evidence | Severity |
| --- | --- | --- |
| Machinery named on screen | ~80 user-visible strings named "Rust", "P3 backend", `book_query`, `mandate_list`, `rescue_approve`, "projected to this window" | High |
| Protocol states as UI | Raw enum chips in monospace caps (`AWAITING APPROVAL`, `SELLER-ATTESTED`, `RECONCILED`); a 10-step state rail on the deal page | High |
| Identifiers as names | Rules shown as `01JD…JG v3`, keys `kp_47be0d`, hashes `head 9561…83`, clause numbers `CL 1`, `clause 6` on Layer 1 | High |
| Captions instead of design | ~100 `ui-hint` paragraphs, several explaining what a visual means ("✓ follows from…; ◆ is…; ? cannot be said") | High |
| Unknown walls | Shield matrix: 5 of 7 rows "? not exposed" per column; Counter: whole "unknown" columns; Deal: 3 of 7 rules "unknown" | Medium |
| Shortcut legends | Permanent keyboard footers on Home, Tables, Shield, Counter, Rescue | Medium |
| Shortcut digits read as counts | Dial labels "Rescue 6" next to a gold badge "1" | Medium |
| Cryptic silence line | "silent → the offer lapses…" (the principle is excellent; the phrasing is not) | Medium |
| Developer disclaimers | "CATALOG · UNAVAILABLE … until the P3 catalog backend exists", "LEVER DATA · UNAVAILABLE" | Medium |
| Inconsistent layout | Rescue collapses the sidebar to icons and uses its own page head | Medium |
| Approval title focus ring | Programmatic focus drew a yellow box around the window title | Low |
| Monospace numbers | Money in monospace reads as code; PayPal's own UI uses proportional tabular figures | Low |

## Waves

### Wave 1: foundation (shared kit, done)

- `docs/ux/UX-GUIDE.md`: persona, principles, vocabulary, visual language, checklist.
- `src/lib/words.ts`: one vocabulary for every window (`stateWord`, `shieldWord`, `reconWord`,
  `receiptWord`, `modeWord`, `RULE_NAME`/`ruleSentence`/`rulesName`, `marketWords`,
  `MILESTONES`/`milestoneOf`, `headlineWords`, `silenceWords`, `timeLeftWords`).
- `logic.ts`: `stateLabel` speaks plain words (`stateCode` keeps the raw name for Details);
  `moneyNow`, `amountNote`, `decidedBy`, `pairingFact`, `clauseText`, `CLAUSE_NAME`, `spendToday`
  rewritten; "not built yet" notices rewritten calmly.
- Kit: sentence-case status pills with a tone dot (no mono, no caps); `--num` token so money uses
  tabular sans; mode badge as a pill ("Sandbox", "Practice agent"); "Preview · sample data";
  `<Silence>` = hourglass + "If you do nothing:"; `WalletNotice` shows words, code in the tooltip;
  quarantine label "Their words, unchecked"; no focus ring on programmatically focused headings.
- Main frame: Dial digits removed; plain module subtitles ("Agent purchases", "Your shop",
  "All payments", "Scam checks", "Failed renewals"); title bar "spent today" / "AI usage,
  estimate"; sidebar "Agent rules" / "Connections"; attention headlines rewritten at the data
  edge (`world.tsx`): "Countersign" → "Approve", "Capture or void" → "Pay or release".
- `?` opens a keyboard-shortcuts sheet (`windows/main/Shortcuts.tsx`), so pages drop footers.

### Wave 2: per surface (parallel, disjoint files)

| Worker | Surfaces |
| --- | --- |
| A | Tables, Deal detail (five milestones instead of ten states), charts |
| B | Spend (the gate), Shield (the matrix) |
| C | Counter, Rescue (layout parity), Book |
| D | Approval window: deal review, shield release, owner configuration, rules editor, pairing confirm |
| E | Home side panels and footer, Settings / Connections / Agent rules sheets, Find, Tumbler |

Results and leftovers are recorded under "Status" below.

### Wave 3: consistency and verification

Cross-surface review in both themes, the guide's checklist grep, full tests and typecheck.

## Requests outside the client (not done here)

- **table-attention** (`crates/table-attention/src/lib.rs`): headline verbs ("Countersign",
  "Capture or void") and `on_silence` ("authorization auto-voids at the deadline; no capture") are
  rewritten client-side by `headlineWords` / `silenceWords`. Moving the plain wording into the core
  would let the Tumbler, notifications and exports share it.
- Error messages from the core (`WalletError.message`) are shown verbatim and are developer-voiced.
  A short user-facing message per code (with the technical one kept for logs) would finish the job.

## Status

**2026-10-06, waves 1-3 done.** Typecheck clean, 317 client tests green (312 before; +5 new:
four milestone tests, one Spend regression). Every surface re-shot in dark and light with no page
errors. No contract, command, mock-shape or gating change; display and copy only, except the bug below.

What each surface now does:

- **Home**: "Approve $329.00" in the hub, a plain week panel ("Paid out / On hold / In progress"),
  hourglass silence lines, "Press ? for shortcuts" instead of a key legend, "Agent app not connected".
- **Tables**: offers and asks as readable price chips, a "Most you'll pay $340" handle, and an
  inspector with three steps (Set your limit → Check what changes → Sign it).
- **Deal detail**: five milestones (Talk · Agree · Approve · Pay · Proof) with an explicit "Ended ·"
  marker. Rules are named, unknowns are grouped, the conversation reads "Dan offered $329", and
  proof is shown calmly. Ids, hashes and protocol verbs moved into Details.
- **Spend**: a checkpoint path per purchase across named rule columns, ending in "On hold · 2 d 18 h
  left" / "Refused · PayPal never asked" / "Paid". The legend is in a popover.
- **Shield**: verdict pills ("Paused for you", "Blocked for good"); the question-mark wall is now one
  "Other checks" line; the price check is a bar.
- **Counter**: "Lowest price" column; the catalog note is a single pill; all-unknown columns are hidden.
- **Rescue**: back to the shared layout. Fix cards have icons, and "never" is the only red.
- **Book**: plain status pills and statement words; "Quick views" with no numbers; no engine or
  command jargon.
- **Approval window**:
  - "Most you'll pay $340 ✓ fits Dan asks $329", a plain checklist, and outcome buttons
    ("Approve $329.00", "Pay partsco $64.00").
  - Mismatch: "They asked $339.00, you agreed $329.00. No pay button."
  - Type-to-confirm on release shows ✓ when it matches.
  - The wallet-setup checklist and rules editor are free of internals.
- **Sheets**: Settings is a circuit with plain nodes and "1 thing to fix". Connections is a stepper
  (Share a code → Match 4 words → Confirm). Agent rules rows read "Shopper rules · up to $200 per
  purchase · asks you above $250".
- **Tumbler**: the same vocabulary; counterparty text still never reaches it.

Bug found and fixed on the way: Spend matched the attention item's clause number against the
column position instead of the clause type number, so "Asks you" was missed whenever a mandate
left out a clause (D-0190 showed every rule as passed). Fixed in `spend/gate.ts`, with a regression test.

Other small fixes: `lib/format.ts` `shortId(id, n, 0)` returned the whole id (`slice(-0)`);
`lib/display.ts` shows the house seller as "House seller"; core `unavailable_reason` strings
pass through `reasonWords()`.

Known leftovers (small):

- Catalog items with no title show their raw ref (`dp-cable-2m`): data, not UI.
- The browser-only Tumbler preview controls still say "Rust": dev harness, never shipped.
- The mock's `on_silence` texts are longer than the core's and truncate in single-line rows. The
  core strings are short, so the mock is the outlier.
- Approval header verb "Accept the offer" vs button "Approve $329.00" is deliberate (you accept an
  offer by approving it). Revisit only if testing shows confusion.

## Round 1: structure (2026-10-06)

Owner verdict on the wording pass: every screen accepted, "but the UX is still hostile to non-tech
users ... layout almost identical". Round 1 (spec `ROUND-1.md`) rebuilt every screen around one anatomy:
answer → first-visit explainer → decision cards whose options say what they do → plain list → the
expert instrument behind Simple / Detailed.

- **Shared kit** (`shared/ui/story.tsx`): `AnswerBar`, `DecisionCard`, `Explainer`, `ChecksSummary`
  (unknowns fold when there are two or more), `DetailToggle` / `useDetail`, `Icon`. Sidebar items now
  carry a plain second line ("Tables / Haggling").
- Six Sonnet agents worked in parallel on disjoint files; the lead built the kit and did the
  consistency pass.
- Client tests 317 → 370, typecheck clean. Gating logic is untouched and nothing changes what moves money.
- Accepted-state snapshot before the round: scratchpad `snapshots/accepted-src`.

Round 2 (bolder, switchable experiments) is drafted in `ROUND-2.md`, waiting for the owner's pick.

## Round 2: bolder, approved screens only (2026-10-06)

Owner verdict on round 1:

- **Approved:** Shield, Rescue, Book, Connections, the approval window (all six states), Tumbler.
- **Frozen ("needs work"), no new variants:** Home, Tables, Spend, Counter, Deal detail, Settings, Agent rules.

What was built (spec `ROUND-2.md`, kit `shared/ui/{hold,why,experiments}`):

- **Approval window:** hold to approve, "What happens next", Why? on the summary and exceptions.
- **Shield:** what's normal vs this payment, check lights and a week strip.
- **Rescue:** what the subscriber gets, and a money strip.
- **Book:** where the money went, a PayPal-agrees meter and question chips.
- **Connections:** a mirror of the other screen, plus word ticks.
- **Tumbler:** a countdown ring.

All of it is behind 8 switches in the main window's `?` sheet; off means round 1. The frozen files were
verified byte-identical to the round-1 snapshot. Client tests 370 → 452, typecheck clean, gating untouched.
