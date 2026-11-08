# The Proof Table

Status: built, 2026-11-03 (spark `the-proof-table`). This is the board's look and layout. It succeeds the Switchboard layout in [conversational-home-migration.md](conversational-home-migration.md); the engine path and safe acts in [conversational-home-engine-path.md](conversational-home-engine-path.md) and [conversational-home-safe-acts.md](conversational-home-safe-acts.md) are unchanged. The design came from contest `ai-ux-board-r2` (winner B/2, chosen by the owner). The brief that framed round 1 is [ai-ux-contest-brief.md](ai-ux-contest-brief.md).

She asks. The wallet says it in one sentence she could read aloud, then lays the proof on the table, and the table lights wherever the sentence is true.

## The board

**Layout.** One window, no page scroll, on the ruled ground (`.ui-ground`). Top to bottom:

1. **Top bar:** brand, mode badge, sample-data badge, engine chip, "Earlier N", Dark/Light, Console, keyboard help.
2. **The board says:** what she asked, then one sentence that steps down in size (`is-h1` to `is-h4`) to fit. Under it, one line saying what changed on screen, with "Undo last change".
3. **Three standing questions** in a facts strip (`.ui-facts`). Pressing one asks it.
4. **Three fixed answer slots** (`slotsOf`). Below 1480 px the first slot is tall and the other two stack; at 1280x800 those two scroll inside themselves. From 1480 px all three sit side by side.
5. **The board column** (392 px; 332 px at 1120 px or narrower) holds:
   - six areas by four fates as counts, with a dashed "–" for zero;
   - lit cells (`.ui-lit`);
   - the sum line (`.ui-sum`);
   - at most six lit deals (`.ui-key`), then "+N more", which opens the paged payments panel.
6. **Ask bar:** the field (`/` focuses it), Ask (which becomes Stop while waiting), and two or three suggested questions.

At 920 px and narrower everything folds into one scrolling column.

**States.**

| State | What the board shows |
|---|---|
| Opening | A line composed from the three standing answers, labelled "From your board, not an answer". Its figures still light the board. |
| Waiting | At once: what she asked, and the field clears. The line names the engine actually answering (live engine, scripted preview, or the preview taking over after the live engine failed), the seconds since she asked, and that her move wins. No filler, no added delay (registry `model-composed-workspace/conductor-turn-flow`). |
| Answered | Figures are keys only where they equal the board. Hover or focus lights a figure's set; a press holds it. The line under the sentence says what the figure is. |
| Held | Her move won. The reply's layout is offered with "Show what it suggested". |
| Fallback, dropped parts, tidied reply | Each shows as a chip next to "You asked". |
| First run | The setup steps fill the first slot. The standing answers are dim ("Not set up yet"). |
| 500 deals | Counts, the sum, at most six keys, then "+N more". |
| Day theme | Supported. |
| Reduced motion | No animation. |

Suggested next steps sit in the focused answer's footer, or in a "Suggested next step" sheet when no answer is on screen. There is never more than one gold button in view.

**Keys.** There is one declaration (`switchboard/keys.ts`), and the help sheet lists the same table.

| Key | What it does |
|---|---|
| `/` | Focuses the ask field. |
| Esc | Lets go of a held figure first. Otherwise clears the answers, their pins, the filter and the light. In the field, it returns to the board. |
| `?` | Opens the keys help. |
| Arrows | Move across the board's heads and cells. The board is one tab stop; the corner is not a stop. |
| Enter on a cell | Lights the cell and shows only it. |
| Tab | Reaches every figure, answer action and lit key. |

**Default home** (`switchboard/view.ts`; the first match wins):

1. the address `?view=`;
2. a hash the console reads as a deep link (`#d=`, `#r=`, `#m=`, `#p=`, `#s=`, `#w=`, old sheet links);
3. the remembered choice;
4. the board.

The director's main frame pins `view=console`, because the films were recorded on the console. A Tumbler route to a deal while the board is open hands over to the console.

## Standing answers

The board answers the three questions all the time, from what it already reads (`switchboard/standing.ts`):

- **Is my money safe?** The safety record: "Safe · 158 entries checked · nothing broke your rules". It turns red when broken and dims when unread.
- **Does anything need me?** The Needs you count, the soonest deadline as a clock time, and the areas that carry it.
- **What if I do nothing?** Read from each waiting deal's If-you-do-nothing line, against the core's closed set of outcomes. Silence never sends money out. So the answer is one of:
  - "Nothing moves by itself", with at most two things that do happen, then "and N more";
  - teal "A payment can come in by itself", when the wallet would collect a payment the buyer approved;
  - dimmed "Nothing goes out by itself", when a line can't be read.

Nothing unknown is ever shown green or as zero. First run reads "Not set up yet".

## Figures

A reply is plain text. A number or name in the board's sentence becomes a key only when it equals the board's data (`switchboard/figures.ts`). That covers:

- a deal that exists;
- an amount equal to a deal or a money fact, printed exactly as the app prints money;
- a count equal to the column it names (or to the area named earlier in the same sentence);
- the deals today;
- the rules in force;
- a deal's time left;
- an area name.

Each figure carries a tone by meaning, a plain line saying what it is, and the set it lights. Hovering it lights that set, and the sum line counts it: "What needs me?" gives 2 + 1 + 1 + 1 + 1 = 6. Anything else stays plain text, and a span that fails stays plain whole. So a live model's wording links less, never wrongly. On the 500-deal board, the sample week's "6 things wait on you" stays plain, because that board has 44.

How a reply's own light becomes a lit set (`switchboard/lit.ts`):

- The highlight lights its row, column, cell or deal.
- A filter lights what it leaves undimmed.
- When there are both, the filter's undimmed part of the highlight is lit.
- A highlight the filter does not meet wins as is: a light never hides anything.

The sum and the lit keys count only the named deals when a set names deals; otherwise they count every key in a lit cell.

## Slots

Up to three answers each keep a fixed place on screen (`switchboard/region.ts`, `slotsOf`):

- A new answer takes the place of the one it pushed out (the oldest unpinned), or the first empty place.
- An answer never moves while it stays.
- Closing an answer frees its place.
- Undo puts every answer back where it was.

The region's other rules (REGION_MAX 3, PIN_MAX 2, copy-don't-move, her move wins) are unchanged.

## Kit classes (design/kit.css, "the Proof Table's language")

The board's night look is the app's own tokens composed differently, as class-only kit pieces. Markup wears them; no component wraps them. The sheet frame is still `.ui-stack-sheet` and the facts strip is `.ui-facts`.

**Tone.** `data-tone="gold|teal|coral|refuse|ok|market"` (the board's `Tone`) sets two local properties in one place: `--tc` for the fill and edge, and `--tl` for the text ink. The tones mean:

| Tone | Meaning |
|---|---|
| gold | needs you, or settlement |
| teal | moving, or your side |
| coral | holds, or the other side |
| refuse | stopped |
| ok | paid, or safe |
| market | neutral |

Without a tone, the classes are steel with normal text.

**Classes.**

| Class | What it is |
|---|---|
| `.ui-ground` | The surface's own graticule: a vignette over major lines every four pitches, over minor lines every pitch (`--grat-pitch`, 21 px), on `--bg`. The board and the console wear it. |
| `.ui-sentence` | The screen's one answer, large and light. It steps down with its length (`is-h2` to `is-h4`); `is-h1` steps up with the window. |
| `.ui-fig` | A figure in the sentence, a key to its proof. Drawn in its tone's ink with a dotted underline. When on (hover, focus, `.is-on`) it gets a solid underline and a 16% fill; when held (`.is-held`) it also gets a ring. |
| `.ui-lit` | A lit cell: its tone's edge, an 18% fill, and the signal glow in its tone. By day the edge alone carries it. Page CSS must not set `background`, `box-shadow` or a `border` shorthand on a cell, or it cancels the light. Use `.cell:not(.ui-lit)` for the resting look. |
| `.ui-sum` | The sum line. |
| `.ui-key` | A lit deal as a chip with a 3px rail. |
| `.ui-rail` | A panel with a tone rail. |
| `.ui-ghost` | An empty slot drawn as an invitation. |

Every tone's ink is at least 4.5:1 on every surface these classes put it on, in both themes (`design/proofTableKit.test.ts`).

## Limits and follow-ups

- **Figure refs on the wire.** Figures are matched on the client, so a live model's wording links less. Refs on the wire need the assistant contract (`crates/table-client/src/assistant_contract.json`), which is pinned until after 2026-11-12.
- **200-deal digest.** The digest caps at 200 deals, so on a large wallet a live sentence's counts can disagree with the board. Those figures stay plain.
- **Money sentence.** The scripted money sentence says "held at PayPal or agreed and waiting to be paid", because the digest carries one `held_minor`. Splitting it also waits for the contract.
- **Small windows.**
  - At 1280x800 the two smaller slots scroll inside themselves, and the first-run gold "Next" button sits below the fold of the setup sheet.
  - At 500 deals and 1280 px, the needs detail's area list ends in an ellipsis.
  - At 1920 px a one-line sentence leaves the says area's fixed height partly empty.
- **The YouTube capture script.** `e2e/youtube/lib/app.mjs` opens `index.html` and drives the console, so it now lands on the board. Its mock mode can add `?view=console`; its live mode would need a click on "Console".
- **Global `.amt`.** `legacy.css` sets a font on every `.amt`. The board overrides it locally; the kit's `.ui-key .amt` could defend itself.
- **The director's `takes --check`.** One beat, `end-proof`, fails ("The Table should show 'decided by the deadline'"). It fails the same way on the base commit, so it predates this work.
