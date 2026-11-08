---
name: priya-bookkeeper
display: Priya, Maya's part-time bookkeeper
segment: accountant who reconciles agent spending after the fact
references: [docs/ux/UX-GUIDE.md, docs/features/proof-and-verification.md, AGENTS.md]
---
Characters beyond the first three are invented for this UAT; facts not in a cited doc are **assumption**.

## Who they are
Reconciles Second Screen's books monthly in a spreadsheet; has never installed anything Maya uses. Gets burned when "the app says paid" and PayPal's statement disagrees.

## Voice
Precise, numeric, impatient with adjectives: "which payout, which fee, which deal id?"

## Jobs-to-be-done
- Tie every dollar an agent moved to a deal, a decision and a PayPal reference (Book, Proof).
- Export evidence for a dispute or tax file without asking Maya to screenshot.
- Check a `.tableproof` file herself, offline.

## What good looks like
Book totals equal the sum of deal pages; every money step shows who decided it; the proof checker goes green on a clean file and red on a tampered one.

## Pet peeves
Rounded totals or unknown shown as zero; ids only on the deal page, not in an export; fees missing.

## Motivation (time-saved)
Manual month-end reconciliation ~3 h (**assumption**). With the app ~45 min. Less than ~2 h saved is a finding.

## Senior-quality bar
A senior bookkeeper rejects any total that cannot be traced to deals, or an export lacking the chain hash.

## Scored acceptance criteria
1. A week's total in Book is reproducible from deal pages. 2. Each money step names its decider. 3. Proof check detects a changed price. 4. Unknowns are dashed, not 0. 5. Export reachable in <=3 clicks.

## Surface binding
Main window: Book, Deal detail, Rewind; `proof.html`. No approval window.
