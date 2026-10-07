---
name: maya-shop-owner
display: Maya, owner of Second Screen
segment: small online seller with a PayPal business account, non-technical
references:
  - docs/ux/UX-GUIDE.md
  - docs/design/the-table.extract.txt
  - docs/design/window-duality.md
  - AGENTS.md
---

Maya, Dan and Second Screen are invented for illustration, as the design report says
(`docs/design/the-table.extract.txt`, "Maya, Dan and Second Screen are invented for illustration").
Anything below that no cited doc states is marked **assumption**.

## Who they are

Runs Second Screen, a two-person shop selling refurbished monitors and a $12/month care plan
(report, "One user, one sentence"). Has a PayPal business account and runs `claude-code` on the shop
laptop. Uses PayPal every day, knows what a refund, an invoice and a hold are, has never opened a
terminal (UX-GUIDE, "Who we design for"). Not a developer, not a finance team (report).

## Voice

Plain money words: "Paid", "Most you'll pay", "Approved shops", "rules" instead of mandate
(UX-GUIDE, Vocabulary). Short, practical, wary of anything that makes her feel she does not know
where her money is (UX-GUIDE). Exact phrasing beyond the vocabulary table is an **assumption**.

## Jobs-to-be-done

- Let agents buy stock, buy supplies, quote the catalog to other agents and chase failed renewals
  without signing above her number (report).
- Ask "how did this week go?" and get an answer (report, "book").
- Know afterwards, with proof, where every dollar went (report).

## What good looks like

She answers UX-GUIDE's three questions on any screen within two seconds, without reading a
paragraph:

1. Is my money safe right now? (moving / held / paid / stopped)
2. Does anything need me? (gold, with a time left)
3. What happens if I do nothing? (always: no money moves, or a hold is released)

One gold decision per screen; money large and coloured by what it is doing; identifiers, hashes and
clause numbers only one click away in Details/Proof (UX-GUIDE principles 2, 5, 6).

## Pet peeves

- A paragraph where a label, icon or colour should do the work (UX-GUIDE principle 1).
- Machinery on screen: Rust, command names, error codes, clause numbers, ids (principle 3).
- Unknown shown as green or zero instead of dashed (principle 4).
- Two gold buttons in one view (principle 5).
- Agents that sign above her ceiling, pay a stranger, or move money she cannot prove (report).
- Engine vendor product names in user-facing text (AGENTS.md).

## Motivation (time-saved)

- Current manual way: she haggles, buys, answers and chases renewals herself. The docs say agents
  "save her hours" (UX-GUIDE) but give no figure; the hours saved are an **assumption** to be
  measured, not claimed.
- What the app should save: the watching. She countersigns only what is over the human-present
  threshold (report: over $250 in the example) and approves once on PayPal's page; everything else
  stays inside the signed band without her.

## Senior-quality bar

A reviewer playing Maya must find no unexplained term, no screen where the three questions take
more than two seconds, every deadline default being "no money moves" or a void, and no internal
name on screen. Failing the UX-GUIDE checklist is a defect, not a nit.

## Surface binding

- Windows: `main` (rules, deals, deal book), `tumbler` (attention, withdraw, snooze, review), and
  `approval` (the only place she countersigns, captures, releases a hold or opens PayPal)
  (window-duality §1, §4).
- Features: agent-gated-spend, mandate-authoring, attention-escalation, audit-trail-export,
  market-price-lookup. She is the buyer side of counter-agent-shop deals.
- Does not reach HOUSE or the judge path.
