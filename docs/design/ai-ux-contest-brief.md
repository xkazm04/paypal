# Contest brief - how the board looks when it takes the screen

Input for `/contest` (copy this file as the contest's `BRIEF.md`). It frames one blind design
contest; it does not choose a direction. The standard every entry is judged against is the
registry's AI-driven experience golden path - `model-composed-workspace` (inside the app) and
`agent-host-experience` (inside other assistants), `ai-registry`, subcategory
`llm-agent/experience`. The vocabulary and the person come from `docs/ux/UX-GUIDE.md`; read it
first.

## 1. The idea

The Table is a wallet for AI agents that touch money: they haggle, buy and sell for a small
shop owner, and nothing moves without a mandate she signed. The board is where she asks it
anything in her own words and the wallet takes the screen to show her the answer - across all
six of her money areas at once. The contest asks what that experience looks like at its best,
for Maya, who runs a refurbished-electronics shop, uses PayPal daily and has never opened a
terminal.

## 2. The material (real, at real scale)

- **Six areas by four fates.** Areas: haggling tables, agent purchases, the shop counter, the
  payment book, scam checks, renewals. Fates: needs her, moving, stopped, paid. The board is
  that six-by-four matrix of her deals.
- **A reply** is one short sentence (about 25 words, at most 600 characters) plus up to eight
  screen operations from a closed set: show an answer panel, light up an area / fate / deal,
  dim everything else, propose an action. Ten answer panel kinds: what needs you, a decision,
  a deal, your money today, rules in force, failed renewals, safety, the book, this week,
  setup. The model never moves money and never signs; proposals are buttons that hand off to
  the approval window, and the three small acts it may propose (pause all agents, pause one,
  let one ask lapse) only make the wallet do less, each behind a consent box the wallet draws,
  each with an undo.
- **The region.** Up to three answers on screen; an answer already there is pointed at, never
  moved; she can pin two; every reply that changed the screen says what it changed in one line;
  "Undo last change" puts the screen back; if she moves while it is answering, her move wins.
- **A reply takes** two to sixty seconds today and does not stream; a fallback engine answers
  when the live one cannot, and says so.
- **Outside the app**, other agents reach the wallet through a role-scoped tool server; a small
  read view inside an assistant is planned (glimpse there, decision at home).
- Use the fixtures staged under `data/` (read `data/SCHEMA.md` first): Maya's week as the board
  sees it (10 of the 24 area-by-fate cells are genuinely empty - the book row has no deals - and an
  empty cell is a real state to design, not a gap to fill), a day-one wallet, a 500-deal scale
  world, replies of every op kind (the three acts and the dropped part come from recorded live
  replies, labelled), a held reply after her move, a session with a pinned answer and an undo, the
  ten panels' real fields, the product's own words, and screenshots of today's board with its
  known faults under `data/current/`. Nothing outside them is real; never invent a deal.

## 3. The wow, and what must never break

In the first three seconds Maya should feel the wallet just *answered her* - the screen shows the
thing she asked about, and she still knows exactly where her money is. What must never break,
from the UX guide: on any screen she answers within two seconds, without reading a paragraph,
*Is my money safe right now? Does anything need me? What happens if I do nothing?* - and there is
never more than one gold button in a view.

## 4. Freedoms

Everything visual and spatial: how the conversation and the matrix relate, how answers arrive
and stack, typography, palette within the PayPal-adjacent brand the app already uses (or a
better one you argue for), motion, how "what changed" and "undo" read. Any framework or none.

## 5. Hard constraints

- Opens from disk, offline, no build step required to view.
- Honesty: fixtures say they are fixtures; an unknown value is dashed, never zero, never green;
  a fallback answer says it is one; designed imagery is labelled as stylised.
- No machinery words in anything Maya reads (no command names, error codes, model names).
- Calm and reduced motion honoured: every motion has a still form that carries the same content.
- Every action reachable by keyboard; nothing she must read is only a colour.
