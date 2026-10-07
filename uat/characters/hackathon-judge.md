---
name: hackathon-judge
display: Hackathon judge
segment: evaluator of the PayPal agentic-commerce hackathon submission
references:
  - docs/design/the-table.extract.txt
  - docs/concepts/moonshot-backlog.md
  - docs/security/scan-2026-10-07.md
  - AGENTS.md
---

Unlike Maya and Dan, the judge is not invented; but their machine, patience and habits are
**assumption** except where cited.

## Who they are

Someone who must "actually run or interact with a working build", free of charge, until judging
ends on 2026-12-15 (report, "Judge-runnability"). May have one install or none, may not be on
Windows, and may have neither engine CLI (moonshot-backlog, T7: "judges may not have Windows,
either engine CLI, or patience for an install"). Gets a sandbox business app and a personal buyer
login through the Devpost form's "credentials needed for evaluation" field, never the public repo
(report, path 3).

## Voice

**Assumption:** a skimmer; reads the README first (moonshot-backlog notes the README is stale,
which is the first thing a judge reads).

## Jobs-to-be-done

- Run or watch a real haggle end to end with the least setup (report paths 1-4).
- Score against the criteria the report tags on its video script: Impact, Presentation, Design,
  Tech, Innovation (report, "Judging criteria" column). The report names Design and Impact as
  criteria the owner identified. Exact weights: not in the docs.
- Repeat the video moment: pair with code HOUSE, one PayPal approval, a signed receipt (report).

## What good looks like

HOUSE negotiates, issues a real sandbox order, captures it and signs the receipt; a "house waking"
state covers Render's 15-minute spin-down (report path 4). Without a CLI, Settings > engine >
Scripted carries a SCRIPTED ENGINE banner and still hits the real wallet (path 2). A no-install
watch-only path is a backlog candidate (T7), not built.

## Pet peeves

- Unsigned-binary warnings with no instructions (report path 1).
- HOUSE locking out after 64 buyers (moonshot-backlog finding 1): a judging-period outage.
- A stale README, or a third-party trademark in the product (report video rule; AGENTS.md vendor
  names rule).
- **Assumption:** a dead end with no explanation when a dependency is down.

## Motivation (time-saved)

- Current manual way: **assumption**, install toolchains and read source to judge a submission.
- What the app should save: one install or none, sandbox credentials from the form, and the same
  receipt-hash proof Maya and Dan see, in minutes. No figure is claimed.

## Senior-quality bar

Every judge path in the report must work from the README alone with sandbox money only, and no
secret may appear in the repo (report path 3; AGENTS.md secrets rule).

## Surface binding

- Judge path 1 (full install), 2 (Scripted engine), 4 (HOUSE) as the report defines them; path 3 is
  the credential hand-off.
- Windows: `main`, `tumbler` and `approval` of their own wallet (window-duality §1).
- Features: house-seller-demo, agent-gated-spend, audit-trail-export, mandate-authoring,
  market-price-lookup. Not counter-agent-shop as a seller: HOUSE is their counterparty.
