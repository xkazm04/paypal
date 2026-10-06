# UX round 2: bolder moves on the approved screens

Owner verdict on round 1 (2026-10-06):

- **Approved, round 2 applies:** Shield, Rescue, Book, Connections, the whole approval window
  (wallet setup, accept an offer, mismatch, pay a held purchase, unpause a payment, approve a fix),
  Tumbler.
- **Frozen, "needs work":** Home, Tables, Spend, Counter, Deal detail (all kinds), Settings,
  Agent rules. They stay exactly as round 1 left them. No new variants, no edits, until the owner reopens them.

Experiments that only touched frozen screens are dropped: Today (Home), Three places (navigation),
Agents as staff (Agent rules), First-run walkthrough (Settings), Deal timeline (Deal detail).

Every round-2 change ships **behind a switch** (`useExperiment(<key>)`, default on). The `?` sheet in
the main window lists the switches; the approval window reads the same per-machine setting. With a
switch off, the screen renders exactly as round 1 did, so the owner can roll back any of them.

## Shared pieces (lead builds them; workers use them)

- `HoldButton` (`shared/ui/hold.tsx`): press and hold for 1.2 s; a ring fills, then the action runs.
  It runs on pointer hold, or on holding Space while focused. Enter never runs it, and releasing early cancels.
  Screen readers get "Hold to …" plus the progress. Only for actions that release or pay money.
- `Why` (`shared/ui/why.tsx`): a small "Why?" link that opens a popover with a two-sentence answer the
  caller writes from facts on screen. Deterministic text only: no model, no guess, no number that is
  not already in the data.
- `useExperiment(key)` / `EXPERIMENTS` (`shared/ui/experiments.ts`): the switches.

## Per screen

| Screen | Switch | The bolder move |
| --- | --- | --- |
| Approval window: every money action | `r2-hold` | Approve, Pay, Unpause, Approve fix become **hold to confirm**. Withdraw, Cancel and Close stay single click. |
| Approval window: every review | `r2-next` | Under the answer, **What happens next**: the 2-3 steps after this decision as a small horizontal path, e.g. "You approve here → Dan sends a PayPal request → You pay on PayPal". It is built from the deal kind and state, so approving visibly differs from paying. |
| Approval window: checks | `r2-why` | A **Why?** on the answer and on each check exception. |
| Shield | `r2-shield` | **What's normal vs this payment**: for each paused payment, two columns. What's normal (typical price, payees you know, deals before) against this payment ($70.00 each, new payee, first deal today), with the differences highlighted. Three **check lights** (Fixed checks · Price check · AI second opinion) show which tripped. A week strip of three large tiles: checked · paused · blocked. **Why?** on each reason. |
| Rescue | `r2-rescue` | Each fix card shows **what the subscriber would get**: a small mock of the PayPal invoice line or email subject, built only from known facts (amount, plan name, retry date). Unknown amounts read "you choose it in the approval window". **Why?** on each fix and on "Do nothing". A one-line strip: money at risk · in progress · recovered. |
| Book | `r2-book` | **Where the money went**: horizontal bars by kind (haggles, purchases, shop orders, rescues), split into paid, on hold and stopped, per currency. A **PayPal agrees** meter (4 of 5 on statement). The Ask box becomes **question chips** in plain words that map to the existing quick views ("Did PayPal record everything?"). **Why?** on each total. |
| Connections | `r2-connect` | A **mirror** of the other person's screen beside yours. The four words are tiles Maya ticks one by one ("I see this too"). "All four match" only enables after four ticks; pinning still happens only in the approval window. |
| Tumbler | `r2-tumbler` | The card's countdown becomes a thin ring around the amount; **Why?** sits in the ⓘ popover. Form sizes unchanged. |

## Invariants (unchanged)

- Gating logic is untouched. A hold button never runs on Enter, and a release still lands focus on the heading.
- MISMATCH has no pay button and BLOCK has no release. Unlock rules, type-to-confirm on unpause, and
  "counterparty text only through Quarantine, never in the Tumbler" all stay.
- `Why` answers and previews never invent a number, a prediction or a promise.

## Verdict

Owner review of round 2:

- **Approved and promoted to permanent code** (the switch and the round-1 rendering are gone):
  Hold to approve (`r2-hold`), What happens next (`r2-next`), Why? answers (`r2-why`), Shield
  (`r2-shield`), Rescue (`r2-rescue`), Connections (`r2-connect`), Tumbler (`r2-tumbler`).
  - "Accept an offer" in the approval window: **needs work, kept as is, do not rework.**
- **Not reviewed:** Book (`r2-book`). It is still a switch, default on, listed in the `?` sheet.
- **Round-1 frozen list, unchanged:** Home, Tables, Spend, Counter, Deal detail, Settings, Agent rules.
