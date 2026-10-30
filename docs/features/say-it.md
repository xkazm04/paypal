# Say it, then see it

The owner types (or, where the browser has speech input, says) one sentence, and the wallet shows how it
read it as editable chips and draws what those rules mean on one timeline: last Monday, through a gold
**Now** line, into the next 72 hours. It exists because the two hardest things for a non-technical owner
are setting rules and trusting what they will do.

**No model runs.** The reader is a fixed grammar (pure TypeScript, `lib/say/read.ts`), like the Book's
word list. It can never sign, store or send anything. It ends in a typed draft that the approval window
shows, and Rust re-checks and the owner signs there.

## What the owner sees

- **The Say it panel**, on the Charter's rules line (the gold action of that line) and, compact, above
  the Rewind's timeline. A sentence box, a microphone (only where the browser has a recogniser) and
  "Read it". Four "Try saying" lines show what always reads.
- **Chips.** What the owner said is solid (Item, Most you'll pay, Ask you above, Offers, Ends). What it
  filled in is quiet and marked ("I filled in": a day's limits, who it deals with). What only the owner
  can choose is dashed ("May pay: you choose"). A part it is not sure of is dashed and asks one
  question. Each chip is editable in place, opens a one-sentence "what it allows" and "Change it in the
  form" (opens the approval window pointed at that rule).
- **"In plain words"**: one paragraph of what the rules allow, and "Read it to me" (the browser's own
  voice, feature-checked).
- **The timeline.** The week behind (solid ticks, who decided each money step), the gold **Now** line,
  then the next 72 hours as dashed ticks: one per step the walk-away forecast states, never merged or
  invented. The headline reads "If you walk away: $0 leaves. 2 holds end on their own." A flag marks
  where the new rules end and a teal band shows how far an agent could go alone before then. A
  **Next 72 h** scale zooms in (automatic when a sentence is read). Past the line the hub says what the
  forecast says, and "no money moves".
- **The join.** For an item the owner's wallet knows ("monitor" tied to the 27-inch 4K they are already
  haggling for), each table open now is shown at its latest price against the two numbers the owner
  said: "House seller $312 · your agent could agree to this on its own" / "Dan $329 · above $320, so your
  agent would stop and ask you". It is a preview of the owner's own numbers ("if the price stays"), not
  the wallet's check.
- **Review rules** opens the approval window with every limit filled in ("Filled in from what you said").

## How it works

1. `read(text, ctx, answers)` (`lib/say/read.ts`) normalises the sentence (number words, "2k", currency
   marks) and takes each part by a fixed pattern: the most you'll pay, when to ask (`human_present_over`),
   offers, when it ends (the injected clock), a day's limits, the house seller, the item. Every word is read,
   a filler, or shown back as not read: nothing is dropped silently. A part it is not sure of is a
   **question and stays out of the draft**; the editor then shows it missing, so a miss degrades to the form.
   What was not said is filled with a safe default; "ask me" missing defaults to **ask about every payment**.
2. `chipsOf` / `rulesOf` / `reachOf` (`lib/say/draft.ts`) turn the reading into chips, the typed rules
   draft and the numbers the timeline draws.
3. `ApprovalDraft::Rules` (`crates/table-client/src/approval.rs`): `approval_open` carries the typed draft
   from Main to the approval window. `check_draft` only checks its shape (mandate target, no deal, one
   clause of each kind, a start before the end, a focus of 1 to 9); `validate()` runs when the owner signs.
   The editor seeds a **new** rule set from it (`draftFromRules`).
4. The timeline: `rewind/clock.ts` (`now`, `stop`, `ahead`, hold on Now when playing, `glide`),
   `rewind/future.ts` (ticks, headline, rule line), `rewind/Scrubber.tsx`. The forecast is read from the
   World's existing `AttentionSnapshot.forecast`; the headline is built by `walkHeadline()` in
   `windows/tumbler/logic.ts`, the same function the Tumbler's all-clear ticker uses, so they cannot differ.

## What it does with what it cannot read

- A part it is not sure of is a **question** (one per part, answered by a tap or a typed word) and stays out of the draft.
- Words it did not understand are shown as "Not read" chips with "Leave it out"; **a "not", "never" or "don't" that was not applied
  blocks Review rules until the owner leaves it out** (rules would otherwise allow what the sentence forbade).
- A number followed by a unit ("up to 6 haggles", "under 27 inches") is never money; a currency it does not read ("340 CAD") is asked
  (dollars, euros or pounds) and the hand-over waits; a date just past, a bare hour ("friday at 9") and a year more than a year away
  are asked, never moved on a guess; an item that fits several of the owner's items is asked about ("Which monitor?").
- The reader was red-teamed with about 1,100 adversarial sentences (and 6,000 fuzz strings); every confident wrong value found is pinned
  in `lib/say/regress.test.ts`.

## Safety properties

- No model; the reader never signs, stores credentials, or calls anything but `approval_open`
  (`console/guard.test.ts` keeps the main window from naming a release command).
- Typed money (integer minor units, never floats); the draft is re-checked by Rust.
- The forecast has no line that sends money out, so the headline's "$0 leaves" is what it states; an
  unreadable forecast is dashed, never zero. A rule is an authority under its ask-above threshold
  (AGENTS.md): when the sentence gives one, the headline adds what the agent could agree to alone.
- Speech is only input, behind a feature check; the browser's own service hears it.

## Where it lives

| Part | Files |
|---|---|
| Reader, chips, draft, join, speech, store | `apps/desktop/client/src/lib/say/` (`read.ts`, `draft.ts`, `join.ts`, `speech.ts`, `store.ts`) |
| Words | `lib/words/say.ts`, `lib/words/rewind.ts` (`REWIND_AHEAD`) |
| Panel | `windows/main/setup/SayIt.tsx`, `SayTimeline.tsx`, `useSay.ts`, `say.css` |
| Timeline | `windows/main/console/areas/rewind/` (`clock.ts`, `future.ts`, `Scrubber.tsx`, `useTimeline.ts`), `rewind.css` |
| Hand-off | `crates/table-client/src/approval.rs`, `crates/table-runtime/src/configuration.rs`, `windows/approval/MandateEditor.tsx` (`seedRules`), `mandateDraft.ts` (`draftFromRules`) |
| Director | `director/sayStory.ts` (`?story=say`) |

## Tests

`lib/say/say.test.ts` (about 95 phrasings and a fuzz), `join.test.ts`, `windows/main/setup/sayit.test.tsx`,
`rewind/future.test.ts` (one tick per forecast line, the headline equals the Tumbler's),
`rewind/rewind.layer.test.tsx` (keys, zoom, the join, an unreadable forecast),
`windows/approval/owner/spokenRules.test.tsx`, `director/stories.test.ts`, and in Rust
`approval_open_targets_and_drafts_are_checked_prefill_only_and_never_signed` and
`a_rules_draft_reads_as_the_client_sends_it`.

## Known gaps

- Buying only. Selling ("sell my monitor for at least $200") is not read: a floor-only rule needs a
  per-deal cap a sentence does not give without a guess; it is shown as not read.
- "Start tomorrow" (the rules always start now); quantities ("2 monitors") stay in the item's words.
- The timeline's past side makes no claim about what the draft would have done last week: the wallet's
  what-if (`mandate_simulate`) is approval-window-only.
- The browser's speech service is not tested against a real microphone here; the shell has never been run
  interactively (STATUS), so none of this has run inside it.
