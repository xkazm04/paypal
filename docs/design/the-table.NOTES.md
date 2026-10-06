# THE TABLE

## Philosophy
Every payment is a deal with a counterparty. The spine is a two-sided `Deal`. Owners sign an AP2-inspired open mandate (numbered clauses plus an agent key), implemented locally. The wallet countersigns a closed mandate only when a deal fits, and both sides keep one hash-linked transcript of signed envelopes.

The firewall, shop, deal book, shield, subscriber rescue and haggle are this one primitive at different tables. PayPal settles each through flows the sandbox supports: seller-issued Orders v2, authorize then capture or void, and merchant-side Subscriptions. The target is HM "Best Use of Agentic Commerce" plus Channel3.

## How it stays readable at scale
- Dark palette with three fixed meanings: teal for your side, coral for the counterparty, gold for PayPal settlement.
- Mirrored two-column figures throughout.
- Grouped sidebar with scrollspy, breadcrumb, section filter and reading progress.
- Six data-driven sequence diagrams; hovering a step lights up its note, and the reverse.
- Models and interfaces shown as code.
- Every claim marked S/R/A, with a claims filter.

## The wow moment
On "The Table" home screen, you drag your mandate's ceiling. Offers outside the band go grey and can't be signed, and the verdict names the refusing clause. The video shows two desktops: two agents haggle inside their bands, one PayPal approval, the same transcript hash on both.

## Known limits
- A seller-issued order approved by a second sandbox account is a day-1 spike; invoicing is the fallback.
- A can't API-read B's order (an assumption), and A-side reconciliation is R.
- Subscription failure simulation is undocumented, so the demo may use a labelled REPLAY.
- Live use needs marketplace or MSB pre-approval.
- Numbers in figures are illustrative.

## What changed in round 2

The owner's words this round answers: *"As the app will need strong UX and practical business situation anyone can understand the benefit, proceed then with round 2 focused on desktop app UI and UX."* The bet is unchanged: the two-sided `Deal`, signed mandates, the mirrored "your side / PayPal settles / counterparty" composition, and the draggable mandate band.

**"practical business situation anyone can understand the benefit"**
- The hero now opens with one user in one sentence. Maya runs a two-person refurbished-monitor shop; Maya's agents buy stock, sell to other people's agents and chase failed renewals. The hero gives who, what the agents do, what goes wrong without the wallet (sourced failures) and what Maya gains. The claim, the target prize and the video moment all fit in the first 1280 × 800 screen.
- New §2 "A week at Maya's table": one card per capability (Mon haggle … Sun book). Each card shows what the agent tried, what The Table did, and the one thing Maya decided.
- The same persona carries through the spine figure, the home figure (Maya's wallet / Dan's wallet), every capability header ("Maya, Tue: …"), the haggle protocol and the video script.

**"focused on desktop app UI and UX" (surfaces a designer can build from)**
- §10 Product surfaces is rewritten:
  - a navigation map with three levels (home → module rail → one shared deal detail) plus the separate approval window;
  - six rules every surface follows: mode badge, default on silence, two meters, untrusted text, idle lock, PayPal only in the browser;
  - a deal-detail spec;
  - the approval moment with its full state strip and READY / LOCKED / MISMATCH wireframes;
  - a home spec with first-run, no-engine, quiet, live, needs-you, locked and house-waking states;
  - six module cards (Tables, Spend, Shield, Counter, Rescue, Book). Each gives what Maya sees first, the one decision, its states, where Maya moves next, and its empty and error states.
- The home figure gains a "Needs you" strip in which every item states what happens if Maya does nothing.
- The spine figure is now an HTML grid instead of an SVG, because the SVG text shrank below 12 px at 1280.

**Host's reading: the grounding audit (every item closed; table in §16)**
- **Rescue reprices the whole plan:** `update-pricing-schemes` is banned (test R3). There are now four per-subscription levers: a discounted one-off invoice, suspend/activate, outstanding-balance capture, and revise to a pre-created plan.
- **No channel to the subscriber:** the channel is now PayPal's invoice email plus the owner's own `mailto:` draft. The answer is read from PayPal state, not from replies.
- **Channel3 history isn't on demand:** the market band now uses on-demand comparables. History is used only after `/start-tracking`, which is started for demo items during the Oct 2–4 spikes. Unindexed items show "no market reference".
- **Shield run not fenced from MCP:** there is now a tool-less engine profile using `--strict-mcp-config`, an empty server list, a `mcp__*` deny rule and a `system/init` check that requires zero tools and zero servers. codex-cli runs with `--ignore-user-config` (test S3).
- **`--json-schema` conflicts with stream-json:** `--json-schema` is no longer used. Rust validates the schema (test E3).
- **`invoice_id` collides at the shared house seller:** it is now `{deal ULID}-{attempt}`. "D-0193" is a display label only (test H3).
- **`payee` merchant never learns of the order:** flagged as route ② vs route ① in cap 1, in the collisions table and on the UI label (test F5).
- **Marks:**
  - "closed list of deal types" is now A, as the note's inference;
  - "no local cross-agent PayPal wallet" is A [inference];
  - the WebView2 choice and the APIMatic caveat are re-marked A;
  - haggle settlement is now AUTHORIZE, so "matches the recommended framing" is true.
- **Missed 15-minute idle rule:** the privileged tier now locks after 15 idle minutes (test F4, trust table, approval wireframe).

**"the bar for this round" (reading)**
- Minimum CSS text size is now 12 px (was 11 px); SVG labels were bumped so they stay at 12 px or more at 1280.
- Fixed a round-1 bug: a sticky table header inside an `overflow:hidden` wrapper covered the first row of every table.
- Key-value values in the home figure were shortened so they no longer wrap mid-token.
- The nav has 16 sections with surface sub-links, and the marks section adds a table that closes each audit item.

**The reveal (`#reveal`, "Why this design")**
- Six bets side by side, each with its unit that can be wrong and what it refuses.
- A 9-criterion matrix against all five field variants (A-1, A-2, B-1, B-2, B-3), with each cell citing the competitor's own anchor.
- Where others are better: A-1 (simpler home, higher ceiling), A-2 (default on silence, found the idle rule), B-2 (stricter consent, better Channel3 evidence), B-1/B-3 (state tables, mode badge).
- What was taken, credited: the idle lock and default on silence (A-2); the mode badge (B-1/B-3); "seller-attested" (B-1/B-2); no manual capture while a PayPal retry is due (B-1/B-2/B-3); typed confirmation to release a hold (A-1/A-2); AUTHORIZE settlement (B-*); market snapshot hashing (B-2).
- Why to build The Table rather than A-1, including A-1's checkable defects.

**Plan, acceptance and risks**
- 8 day-1 spikes (now including the tool-less fence, Channel3 tracking and the Invoicing send/pay test).
- New tests: H3/H4/H5 (AUTHORIZE, ULID), F4/F5, S3, R1–R3, E3, and U1–U4 for surfaces.
- New risk rows: empty `--mcp-config` rejected, no Channel3 history, sandbox invoice email, revise approval link, house-seller collisions.
- The cut line now drops the PAUSE/DOWNGRADE levers before the invoice lever.
