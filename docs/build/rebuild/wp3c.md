# WP3c - Deal page, Rewind, Rules and limits, Connections and pairing, Settings, Safety record

Scope: `apps/desktop/client/src/**` only. No Rust, `bindings/`, `crates/`, `src-tauri/`, authority,
capability or mock change: `git diff --stat 859fa04 -- crates bindings apps/desktop/src-tauri` is
empty. No dependency added. Nothing committed (the Director commits).

## 1. What was built

All six areas are layers of the one main window in the Calibre theme. The only way out of the
window is `approval_open` (same targets as before: `{deal_id}`, `credentials`, `mandate`, `unlock`,
`{pairing}`, and no target for the wallet limits), always through the existing `Handoff`
(setup/common.tsx) or the centre's contract: lock glyph and `APPROVAL_LOCKED_TITLE` while
idle-locked, disabled while pending, `WalletNotice` on error.

**The shared place frame** (`console/areas/settings/frame.tsx`, CSS in `areas/settings.css`
under `.pf`): the ONE answer line as the layer's heading (focused going in), an optional "Your
call" line (gold LED chip, "If you do nothing: ...", at most one gold hand-off), an `aside` (the
deal's figures), a `lead` slot (the decision, a finding), 3-4 cards, an explanation behind a
`Disclosure`, and the place's own content. A card opens a **nested view on the same sheet**
(aria-expanded, the card reads Close, the view's heading takes focus and scrolls into sight;
Escape inside the view closes it and gives focus back to its card, and does not go a layer up).
A card can instead move to another layer (`go`, keeps a `data-fk` for focus restore), or be a
plain figure. Places and the deal have no `v=` in their route, so a view is the sheet's own
state, not a route (see open question 1). Lists inside places are `ListEngine`s whose box is as
tall as their rows (`fitHeight`), so a small shop's short list leaves no dead band.

| Layer | Answer | Your call | Cards (-> view) | Content |
|---|---|---|---|---|
| Deal `#d=` | the deal's title (h1) + the answer sentence (`dealAnswer`) | the `DecisionCard` in `lead`: Review & approve / Review & release (gold, `approval_open {deal_id}`), Let it lapse, Withdraw (asks once) + "If you do nothing" with countdown; a live deal without a need shows its consequence line | What happened (chat, where it stands, who decided) · Rules that applied · Who you deal with · Proof from PayPal | figures beside the title (amount, state or money-check pill, money right now, time left), milestones, "what you were shown" on an ended deal; actions Start agent, Details, Export record |
| Rewind `#r=rewind` | "108 PayPal money steps this week, 7 refused before PayPal was asked. Waiting never sent money." | - | You decided · Your rules decided · Safe default · Refused (figures) | hub + scrubber (play, week back/forth, drag, keys, day anchors, ticks open their deal), the tape: every step newest first, windowed, searchable, filtered by who decided, sort; a step opens its deal |
| Agent rules `#p=rules` | `rulesAnswer` | when nothing is signed / a set is not in force: gold "Set your first rules" / "Change rules" (target mandate) | In force · Not in force · Asks you above · Wallet limits (-> `#p=limits`, `data-fk="to-limits"`) | the rule sets (ListEngine, filters in force / not, sorts) beside the picked set's full text |
| Wallet limits `#p=limits` | `readLimits().line` | - | - | the three meters (one per row), "Change limits" hand-off (no target, as before), the silence line |
| Connections `#p=connections` | "PayPal is connected, in sandbox." / "PayPal isn't connected yet" | no PayPal key: gold Save (target credentials) | PayPal and your keys · Agent app · House seller · Who you deal with | "Connect a wallet ›" (-> `#p=pairing`); the counterparty list (ListEngine, 99+ counts, filters verified / house / not verified, sorts) |
| Connect a wallet `#p=pairing` | the desk's `pairAnswer` as the heading | - | - | the pairing desk (moved, behaviour unchanged) |
| Settings `#p=settings` | `settingsAnswer` (Circuit facts) | first run: Open your charter; else the old checklist's first missing hand-off: Add PayPal key / Sign rules / Unlock with Windows Hello (gold), then Choose an agent app or Resume agents | Approving · Your agents · Appearance · Notifications | "Also here" rows: the charter, Agent rules, Connections, the safety record, Show the first visit again (preview only), Quit; "How your money is protected" disclosure |
| Safety `#p=safety` | `safetyWords().verdict` (red when broken) | findings as a red `role=alert` lead naming each deal (Open deal ›) + "If you do nothing" | Your record (-> the record itself) · Money steps · Refused (-> why) · Deals checked | who decided each money step (the bar in the Rewind's colours); Check again |

Scale findings: **#15** fixed (each rule set's row and document say its agent, what it is for -
kinds of deal and categories - its two telling limits, its version and its state; the busy
merchant's eight sets, three of them the shopper's, all read differently; tested). **#17** fixed
for the deal page (on open it reads only the conversation, the signed rules - the `['mandates']`
entry the Rules layer shares - and the proof only when PayPal has a record for the deal, which the
answer and milestones need to say a payment is being checked; deal_history, owner_facts and
rescue_book are read by the view that needs them when it opens; tested by counting reads). The
Book's ledger fan-out is the Book builder's. **#16** not applicable: the Rewind reads deal_history,
not audit rows. **#18/#19** for my areas: every long list is a `ListEngine` (windowed; people 195,
tape, rule sets), counts through `formatCount` (99+), "Showing N of M" through `formatTally`.
**#20** fixed small: Maya's week names her deals, so the director page and its frames leave a
`?scale=` sample for her week (`directorSearchFor` drops the param, `frameUrls` never passes it
for her story; tested in `director/stories.test.ts`). **#21** fixed small: the Tumbler preview's
controls act on `D-0193` when the world has it, else on the world's first decision waiting for
review, and the mismatch control is left out when `D-0199` is not there
(`windows/tumbler/preview/Preview.tsx`).

## 2. PARITY (old feature -> new place -> moves from the centre)

Moves: one click (or key) per move from the decision centre; "+0" = on the first view of the layer.

### Deal page (DealView.tsx, deal/*.tsx)
| Old feature | New place | Moves |
|---|---|---|
| Title, "You're buying · haggle" | deal h1 + kicker (module · side · kind · with whom) | 1 (Open the deal) |
| Amount, state chip / money-check pill, own mode badge, money right now, time left + countdown | figures beside the title (`Summary`, same words, `.dv-pills`/`.dv-f` kept) | 1 |
| Five milestones, early ending marker | lead (`StateStrip`) | 1 |
| "What you were shown" on a deadline-ended deal | lead (`ShownStrip`, read only on an ended deal) | 1 |
| Answer in one sentence | the line under the title | 1 |
| Decision card: Review & approve, Review & release, Let it lapse, Withdraw (+ confirm sheet), silence line + countdown, mismatch silence line, quiet Withdraw without a card | lead (`DealDecision`, same commands and words) | 1 |
| Start agent / agent running chip + run badge, paused title | page action | 1 |
| Details popover (deal label + id, exact state, rules + version + id, agent app, instructions) | Details | 2 |
| Instructions word for word | Details > Read | 3 |
| Export record: messages, PayPal ids, mode, record id, convergence chart, table, Save signed proof + confirm | Export record | 2 (save: 3-4) |
| Names-couldn't-load hint | lead | 1 |
| What happened: chat, envelope popover (when/who/signature/checked against/message), where it stands, who decided | card What happened | 2 (envelope 3) |
| Your rules: checks (exceptions first), fold "checked when it pays", rules sheet (status, for, valid, each rule's reading, signature, version) | card Rules that applied: all inline in the view; "Agent rules ›" opens the layer | 2 |
| Rules sheet "Rules id" and "Rule numbers" | **cut on the deal** (internals; no clause numbers on screen). The rule set's id is in Agent rules > the set > Proof details | 3 (rules layer) |
| Who: identity, gets paid as, known since, scam check, their lowest/highest kept private, offers used, their note (NoteChip, quarantined), About sheet (who, identity why, scam check text), wallet key + short key | card Who you deal with (About folded into the view; keys in Details) | 2 (keys 3) |
| Proof: what PayPal has, receipt, statement, typical price, house record (warn edge), the three sheets, Check my PayPal statement (deal_reconcile), statement words | card Proof from PayPal (`ProofPanel`/`EvidenceSheet` moved, class names kept) | 2 (sheets 3) |
| Rules badge on the tab / house-record warn chip on the tab | card value / card chip | 1 |
| Tabs' arrow keys | cards are buttons (Tab); views close with Escape | - |

### Rewind (Rewind.tsx, RewindParts.tsx, console/RewindLayer.tsx)
| Old feature | New place | Moves |
|---|---|---|
| Play / pause (Space), reduced-motion stepping | scrubber | 1 (Rewind) |
| Week before / after | scrubber | 1 |
| Drag the playhead, keys (arrows, Shift, Home, End) | scrubber (slider) | 1 |
| PayPal lane ticks coloured by who decided, clustered, click opens the deal | scrubber (ticks are pointer targets; the tape is their keyboard path) | 2 |
| Legend, Back to now (Esc), truncated note, read error | scrubber | 1 |
| Hub: the moment, narration, who decided, Open deal, counts | hub over the scrubber | 1-2 |
| Opening at a moment ("See it on the Rewind") | `rewindAt`, kept | 1 |
| New: tape of every step (search, who-decided filters, sort), day anchors, four figures | Rewind | 1 |

### Settings (setup/CircuitView.tsx) and its old surfaces
| Old feature | New place | Moves |
|---|---|---|
| "Is my wallet ready" answer | Settings heading | 1 |
| The one gold hand-off (PayPal key, rules, unlock) | Settings > Your call | 1-2 |
| First run: "Open Set up" | Settings > Your call > Open your charter | 2 |
| PayPal key: saved + date, connection not tested, Add / Replace | Connections > PayPal and your keys | 2-3 |
| Market prices key, market-watch lines (checks today, used up) | Connections > PayPal and your keys | 2-3 |
| Owner key (public id, copy) | Connections > PayPal and your keys | 2 |
| Sign your agents' rules / Agent rules › | Settings Your call; Settings > Also here > Agent rules; top bar Rules | 1-2 |
| Choose an agent app: picker (radio), Check again / Look for agent apps, probe time, Use practice agent, Keep the practice agent, errors where clicked, versions and reasons | Connections > Agent app (tested) | 2-3 |
| Your agents: Pause all agents (no confirmation), Resume, n working, P key | Settings > Your agents (P on the Settings layer; tested) | 2 |
| Agents roster (slot, engine, what it does, follows rules, running) and agents at work (6, by deal title) | Settings > Your agents | 2 |
| Approving: locked / unlocked, locks in N min, Windows Hello, what locks / never locks, permissions fingerprint, Unlock with Windows Hello | Settings > Approving (+ Your call when locked; top bar lock) | 2 |
| House seller: state, Open a table with it | Connections > House seller (+ Wake it now) | 2-3 |
| "How your money is protected" chain, "Who can set what", "Money moves only on" | Settings > How your money is protected (disclosure) | 2 |
| The Circuit picture (Detailed: wired parts, inspector, breaker switch, "Can't tell yet" list) | **cut as a picture**: each part's facts live in the card views above (unknowns read dashed there); the breaker is the Pause button. Ask: keep the cut? | - |
| "Setup · n of 3 done" progress | the answer's "n steps are left" | 1 |
| Your wallet's charter (`SETTINGS_MORE.charter`) | Settings > Also here | 2 |
| Theme (footer only before) | Settings > Appearance (and the footer) | 2 |
| Calm motion (footer only before) | Settings > Appearance (and the footer) | 2 |
| New: Windows notifications, Do not disturb (`settings_write`, fresh read, one field) | Settings > Notifications | 2 |
| Show first run again (preview only) | Settings > Also here (mock backend only) | 2 |
| Quit | Settings > Also here > Quit The Table (the Quit sheet) | 2 |

### Connections / pairing (setup/PairingDesk.tsx)
| Old feature | New place | Moves |
|---|---|---|
| Whole wizard: share a code (side, payee, make code, copy, stop waiting, poll every 3 s, runs out), join (their code), house (wake, connect), four word tiles to tick, All four match, They don't match: stop, auto hand-off of the words, Confirm in the approval window (gold, pairing), house table offer, connected + Connect another, mirror of their screen, offline notice, errors | Connections > Connect a wallet (moved file, same behaviour, words in lib/words/connections.ts) | 2 |
| Settings > House seller opened the desk on the house mode | Connections > House seller > Open a table with it | 3 |
| New: who you deal with (counterparty list) | Connections | 1 |

### Agent rules and limits (setup/Mandates.tsx, legacy limits)
| Old feature | New place | Moves |
|---|---|---|
| Answer + Set your first rules / Change rules hand-off | heading + Your call / action | 1 |
| One card per set: agent, kind, three limits, state chip (active until / ended / starts / not signed / needs signing again), Change | the list rows + the picked set's document | 1-2 |
| All rules popover: every rule in words | the set's document "Every rule" | 2 |
| Proof details: version + valid, rules id, agent key, signature | the set's document > Proof details | 3 |
| Proof details: "Rule numbers" | **cut** (no clause numbers on screen) | - |
| Full list (Detailed) | the list itself (filters, sorts) | 1 |
| "3 agents · 5 rule sets" line | the In force card ("8 rule sets for 3 agents") | 1 |
| Silence line | under the list | 1 |
| Wallet limits meters, line, about, Change limits, silence | Wallet limits (from the Rules card, `data-fk="to-limits"`) | 2 |

### Safety record (safety/SafetySheet.tsx)
| Old feature | New place | Moves |
|---|---|---|
| Verdict and sentences | heading + sub | 1 (Settings > Your safety record, or from the Book) |
| Findings: red alert, deal by title, Open deal, "first N of M", what to do on a broken chain | lead (+ "If you do nothing") | 1-2 |
| Who-decided bar and legend | first view | 1 |
| Details: records, chain, head, deals checked, histories, refused deals, money steps, refusal families, precise findings | card Your record (refusal families also on card Refused) | 2 |
| Check again | action | 1 |
| Detail toggle | replaced by the cards' views | - |

Deep links checked: `#d=<id>` and `#d=<label>` (console.test "#d=D-0193 ... /monitor/"), `#d=...&m=<module>` from Find, `#r=rewind`, `#p=<place>`, `#p=<place>&m=<module>`, `#s=settings|pairing|mandates`, `#m=book&p=safety`, and `main:route` from the Tumbler (console.test) all land on the new layers.

## 3. Deleted / moved
Deleted: `windows/main/DealView.tsx`, `deal.css`, `deal/{Columns,Decision,Evidence,Instructions,InstructionsValue,ShownStrip,WhoDecided}.tsx`, `deal/whatYouWereShown.css`, `Rewind.tsx`, `RewindParts.tsx`, `rewind.css`, `console/RewindLayer.tsx`, `safety/SafetySheet.tsx`, `safety/safety.css`, `setup/{CircuitView,PairingDesk,Mandates}.tsx`, `setup/setup.css`, and the tests `deal/{Decision,evidence,instructions}.test.tsx`, `safety/view.test.tsx`, `setup/CircuitView.test.tsx` (moved or rewritten, below).
Kept where they were (pure, other tests import them): `deal/{model,story,shown}.ts` (+ tests), `safety/model.ts` (+ test), `setup/{circuit,limits,pairing,common,start}.ts(x)` (+ tests), `home/away.ts`, `unshown.ts`, `logic.ts`.
Moved with their importers updated: `ProofPanel`/`watchWhy`/`EvidenceSheet`/`TranscriptSheet` -> `console/areas/deal/Evidence.tsx` (`lib/houseRecord.test.tsx`, `lib/marketWatch.test.ts`); `decidedLine`/`decisionSteps` -> `console/areas/deal/decided.ts` (`windows/main/rewind.test.ts`); `TickMark` -> `console/areas/rewind/TickMark.tsx`; `useRewind` -> `console/areas/rewind/clock.ts`; `PairingDesk` -> `console/areas/connections/PairingDesk.tsx` (`setup/Charter.tsx` import line).
`console/legacy.tsx`: only my entries and their imports removed (deal, rewind, settings, connections, rules, limits, safety, `PlaceHead`, `Desk`, the setup.css and ownerKey.css imports). Module and setup entries untouched.

## 4. Words added
`lib/words/settings.ts` (`PLACE_FRAME`, `SETTINGS_*`), `connections.ts` (`CONNECTIONS_*`, `PAIR`), `rules.ts` (`RULES_*`, `LIMITS_PLACE`), `deal.ts` (`DEAL_*`, `DEAL_NAME_UNREAD`), `rewind.ts` (`REWIND_*`), `safety.ts` (`SAFETY_*`). Strings moved from the old files are byte-identical (tests know "Check my PayPal statement", "Done", "Read", "Open deal ›", "Money right now"...). `lib/words.ts` not edited.

## 5. Tests
New: `areas/settings/places.test.tsx` (the 8 layers + a deal on both scales through `expectLayerHealthy`; Settings: a card's view opens on the same sheet, Escape closes it and returns focus without going up; notices `settings_write` from a fresh read changing one field; P pauses and never resumes; Connections: 195 wallets windowed, 99+, search), `areas/settings/locked.test.tsx` (locked glyph + title + only `approval_open` on the deal's gold, Settings' unlock, Rules' Change), `areas/settings/words.test.ts` (words guard: no vendor but PayPal, no internals, silence lines), `areas/deal/deal.test.tsx` (gold hand-off calls only `approval_open {deal_id}`; per-view reads #17; Escape order), `areas/rules/rules.test.tsx` (#15 distinct names, plain-words document, Change -> `approval_open` target mandate; `purposeOf`), `areas/rewind/rewind.layer.test.tsx` (who-decided filter, a step opens its deal, day anchor), `areas/connections/engine.test.tsx` (the old Circuit test, ported: a failed pick shows its alert in the picker's view), `areas/safety/view.test.tsx` (the old SafetyView assertions on the new parts). Moved with imports updated, assertions kept: `areas/deal/{Decision,evidence,instructions}.test.tsx`. `director/stories.test.ts`: three assertions added for #20.
Shared test adjusted deliberately: `console/console.test.tsx` "Rules from the top bar is a layer": focus going in is now asserted to be the layer's heading (`[data-layer-title]` inside the rules layer) instead of the heading text "Agent rules", because the heading is now the place's one answer line (the crumb still says "Agent rules", still asserted).

Gates (from `apps/desktop/client`, final run): `pnpm typecheck` clean (other builders' in-flight files failed in between - `fewRows` in rescue/shield, book - and were fixed by them); `pnpm exec vitest run`: **137 files, 1423 tests, all passed** (full run, `--reporter=dot`). Rust diff vs 859fa04 empty.

## 6. Screenshots (scratchpad `wp3c-shots/`, all read)
Every layer at small and large, dark 1280x800 and light 1920x1080 (32), plus: deal views open (story dark, rules light, who dark, proof light 1920), Settings agents view, Connections PayPal view (light), first run (Settings light, pairing house mode), degraded (`#d=D-0193`), Charter practice line (the moved desk embedded). No console error in any run, no text under 12 px (the rule glyphs were 11 px: fixed to 12), no raw id/enum, no horizontal overflow. Fixed during review: the duplicated "1 asks you" chip on the deal's Rules card; the mode badge floating under the corner seal (the footer carries it; dropped from places, WP2.5 open item 4); ~350 px dead bands on Connections and Safety (the people list and the who-decided bar are now the places' own content, lists sized to their rows); the limits meters' label squeezed to four lines (one meter per row); a view opening below the fold (it scrolls into sight); the Rewind's answer at 1920 (kept to the hero size); a degraded `#d=<label>` said "isn't here any more" (now says the names didn't load).

## 7. Open questions
1. **Nested views without a route.** Places and the deal have no `v=` (route.ts, `stepBack`), so a card's view is the sheet's own state: Escape closes it first (the console honours `defaultPrevented`), but browser Back and the crumbs do not see it and a reload closes it. Adding `&v=` to `#d=` and `#p=` would be a route-shape change in shared files (logic.ts, route.ts): I did not make it. Want it?
2. **Short pages on 1920x1080.** Settings, Wallet limits, Connect a wallet and a deal with nothing open leave 250-400 px below their content on a tall window (none at 1280x800). The frame now spaces itself out on tall windows; filling more would mean opening a view by default, against "first view = answer + decision + cards". Keep?
3. **Notifications from Main.** `settings_write` replaces the whole preferences record and re-applies the mini window's form and position (routing.rs). Main writes it from a fresh read and changes one field, as the mini window's own do-not-disturb does; the mini window's live form, if a native drag/snap moved it without an event, is whatever the store says. Acceptable, or should Main show these read-only?
4. **Cuts to confirm**: the Circuit picture (wires, inspector, breaker) is gone as a picture; "Rule numbers" (Agent rules proof details, the deal's rules sheet) and the deal's "Rules id" are not shown; the Rewind's ticks are pointer targets only (`tabIndex -1`; the tape is their keyboard path).
5. **"Check proof"** in the brief: I read it as the safety record's Check again. The Book's "Check a proof file" stays the Book's (its file is another builder's); a second entry from the safety record is one lazy import away if wanted.
6. **Tour replay**: the tour is mounted only on the root Charter (first run). Settings offers the charter again and, in the preview, the first visit; replaying the tour on a set-up wallet is not possible without mounting it elsewhere (setup area, not mine).
7. **Shared CSS now unused**: `console/framework.css` `.cs-placelayer`/`.cs-placehead`/`.cs-meters`/`.cs-limits` rules served the interim place layers only; the Director may delete them with `legacy.tsx`.
8. **Crumbs overflow** (console, not mine): on `?first_run=1` the crumb row "Your wallet's charter › Connections › Connect a wallet" runs into the depth bars at 1280 px.
9. `NoteChip` is still imported from `modules/shield/NoteChip.tsx` (the shield area's folder; the shield and tables builders import it too): whoever moves it should move all three importers.

## 8. Files
New: `src/windows/main/console/areas/settings/{frame.tsx, handoff.tsx, SettingsLayer.tsx, places.test.tsx, locked.test.tsx, words.test.ts}`, `areas/connections/{ConnectionsLayer.tsx, PairingDesk.tsx, engine.test.tsx}`, `areas/rules/{RulesLayer.tsx, rules.test.tsx}`, `areas/safety/{SafetyLayer.tsx, view.test.tsx}`, `areas/rewind/{RewindLayer.tsx, Scrubber.tsx, clock.ts, TickMark.tsx, rewind.layer.test.tsx}`, `areas/deal/{DealLayer.tsx, DealPage.tsx, Decision.tsx, StoryView.tsx, RulesView.tsx, WhoView.tsx, ProofView.tsx, Evidence.tsx, Instructions.tsx, InstructionsValue.tsx, ShownStrip.tsx, decided.ts, deal.test.tsx, Decision.test.tsx, evidence.test.tsx, instructions.test.tsx}`, this note.
Changed: `console/layers/{deal,rewind,rules,connections,settings,safety}.ts`, `console/areas/{deal,rewind,rules,connections,settings,safety}.css`, `lib/words/{deal,rewind,rules,connections,settings,safety}.ts`, `console/legacy.tsx` (my entries only), `setup/Charter.tsx` (one import line), `console/console.test.tsx` (one assertion), `lib/{houseRecord.test.tsx, marketWatch.test.ts}` and `windows/main/rewind.test.ts` (import paths), `director/{stories.ts, stories.test.ts}` (#20), `windows/tumbler/preview/Preview.tsx` (#21).
