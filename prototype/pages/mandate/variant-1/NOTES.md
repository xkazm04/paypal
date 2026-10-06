# Clause sheet

## The bet
The built editor, sharpened and layered. Layer 1 is the clause list: number, name, value, and how many of this week's intents it decided, under a version strip and above the sign / revoke bar. Editing never touches v3: it drafts v4, and a changed row turns gold with the new value and the old one struck. Signing is its own sheet.

## How a person uses it
1. Pick M-12, S-2 or R-3 and scan the clauses and this week's tally.
2. Open a clause. Its sheet (Layer 2) holds the typed editor and this week's verdicts, before → after, with reasons.
3. Press "Review & sign v4…" (Ctrl+Enter). Its sheet holds the diff, plain-words consequences, signature facts and the exact bytes.
4. Unlock with Windows Hello (simulated), then sign. A past row opens read-only in a sheet, where you can draft from it.
5. "Revoke v3" acts in one click, even while locked.

## What it does better than the other two
Fastest to scan and most precise to edit; the whole mandate fits one small window, and the signing step is the clearest.

## Known limits
- It reads like a settings page. The meaning sits one click away.
- It uses a prototype hash, not sha256 or Ed25519.
- Revoke passes the idle lock. The report lists it as privileged, so this needs an owner decision.
