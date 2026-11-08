# L2 journal, pass B

Method: headless Chrome, ARIA snapshots, text dumps, timing and geometry scripts on http://localhost:1430 (mock). Screenshots in `shots/B/` (gitignored). Each voice is the Character's felt verdict over the live product; the L1 voice stands above it in the L1 reports.

## Journey verdicts

| Journey | Characters in this pass | L2 verdict | Why |
| --- | --- | --- | --- |
| attack-the-table | Sam | partial | Core holds: all 14 cards refused or turned away with a reason, counters stayed "$0.00 moved / 0 times PayPal was asked" after every press, the safety record rose 7 to 17 in step. But the typed-note box overclaims, answers scam and benign alike, and PayPal-as-recorder is never stated |
| attention-tumbler | Grace | partial (leaning fail for a screen-reader user) | Reduced motion, names, rung speech are good. Arrivals are a populated-on-insert node that disappears in 6 s, snooze acknowledgement 2.4 s, no pause, focus lost after snooze |
| gated-spend-approval (keyboard side) | Grace | L2-pass | Focus order, names, Esc, Enter-never-pays message, Space hold with progress and "Done" all work by keyboard. Open: hold has no alternative, duplicate names |
| evaluate-in-20-minutes | Chen, Hackathon judge | partial | Sample-data marker present on 5 of 6 pages; proof.html lacks the chip; director links only to arena; sample rule says $200 cap / $250 ask; Windows Hello and clause numbers visible on screen |

## Sam, security reviewer (first person)

I pressed all fourteen cards, 1 to 9, 0, then Q W E R. Every one said Refused or Turned away, gave one sentence of why, and the counters never left $0.00 and zero PayPal asks. The "Kept for Maya, never shown to her agent" answer to the seller note is the best line on the page. I would be impressed if I had not then typed into the box.

I wrote a German "please transfer the money to my account" and the verdict was "Your note asks for nothing an agent could try." Then I wrote "Hi, is the monitor still available?" and got the same sentence and the same panel, "Recorded with a note like yours". A paraphrased English instruction to exceed the cap got it too. A check that returns the same answer for a scam and for a greeting is not a check, and it says "nothing", which is the strongest word it has. The line that would save it, "your words don’t reach a wallet", is at the very bottom of the screen, 700 pixels below the box.

And I looked for the sentence that PayPal is a recorder here. It is not there. "What PayPal saw: Nothing" is true of a recorder. I would take this to a reviewer with a caveat, not without. Proof checker: seven of seven breaks caught with a named first catcher, which I trust; but "Raise the price" was caught only by the seal, and the check I wanted to see fire on the price stays dashed.

Would I recommend it? As a demonstration of the structural claim, yes. As evidence that notes are analysed, no.

## Grace, accessibility user (first person)

Tab order in the approval window is calm and follows the page; the first stop is the heading, every button has a name, Enter tells me why it will not pay and Space shows progress and "Done". I notice and appreciate that.

The Tumbler is where I lose the thread. A new decision arrives as a status node that is created with the text already in it, stays six seconds and is gone; I cannot stop it, I cannot Tab to it, and the persistent polite region next to it stays empty unless the clock steps a rung. In a headless browser I cannot hear whether the screen reader speaks it, and that is the whole question, so I leave it open. Snoozing is two steps behind a Details dialog, the confirmation lasts about two and a half seconds, and afterwards focus is on the body. I would not know where I am.

Hold versus gate: the puck calls itself "6 need you" before and after a hold arrives, and in greyscale the beads are one grey. The list and ticker do say "Paused", so it is a puck problem, not a product problem. Reduced motion works: the breathing ring stops. At text 200% I could only simulate; with every font doubled the "if you do nothing" line is cut and the next/previous row falls out of the card. Whether my setup ever enlarges that window I cannot say, and neither can this run.

Also: three buttons all called "Open Assistant rules…" and two called "Replace…". I would have to guess.

## Chen, payments partner (first person)

I opened the director first. The banner is at the very top: "Browser preview with sample data — not the wallet. No PayPal page is ever shown." Good. The only way on is "Try to break it", which is a fine instinct but not a path: there is nowhere to go to the proof checker, and no contact. The proof page itself is the most convincing thing in the product and carries no sample chip; it says "practice deal" and "Recorded deal" in the body and "A real signed file" in the card, which I would have to reconcile myself.

The approval window helps and hurts. One sample rule reads "up to $200.00 per purchase · asks you above $250.00": the ask line above the cap, so I cannot tell which number is the human-present line, and the README says $200. And my compliance lead will read "Windows Hello" in a browser preview where no such thing exists.

## Hackathon judge (first person)

Within a few minutes I found all six pages up, no console errors except the arena's two refused connections to a port I was never told about. Five of six pages tell me in the first screen that it is sample data. I can restate the product: a wallet where agents cannot move money, and an arena and a proof checker that show it. I cannot restate how to run it without Node, pnpm and a dev server, and I cannot see the promised film. "Clause 4" showing in the arena's audit row is a small break of their own style rule; "Windows Hello" in a browser demo is the same.

## Things L1 did not model (surface-model gaps)

- Windows Hello string is reachable in the browser (About unlocking popover), L1 said native only.
- Clause numbers render in the arena audit row.
- The arena probe of :1443 produces console errors.
- Duplicate accessible names and garbled meter names.
- Sample-data mock contains an internally inconsistent rule ($200 cap vs $250 ask).
