# Tomasz (power owner, six agents) - L1 walk, 2026-11-06

Method: code-grounded, no browser. Client root `apps/desktop/client/src` (paths below are relative to it unless prefixed). Everything in the brief was treated as a hypothesis; each is verified or refuted in the table.

## Verdicts

| Journey | Verdict | Time saved if it all worked | Confidence |
| --- | --- | --- | --- |
| sign-rules | **L1-conditional** (no structural blocker; 4 majors carry to L2) | about 3.5 h/week of the ~8 h target (assumption base 10 h to 2 h) | low-medium |
| counter-shop-and-wallet | **L1-conditional** (1 major) | about 1 h/week | low |

Reachability: Tomasz's surfaces (Rules, Limits, Tables, Spend, Counter, Rewind in the main window; the approval window for signing) are all reachable on the preview server. The preview mock differs from Rust in two places that matter to him (see TOM-L1-01 and TOM-L1-08), so those findings need a Rust-backed run or resolve `uncertain` at L2.

Grounding: not applicable (env.md). Wiring audit (unit: IPC field declarations vs reads under client/src): **26/31**. Unread: `ExposureView.signed_at`, `MandateSimulation.from`, `.to`, `.not_simulated`, `WalletEnvelope.version`.

## Hypotheses checked

| Hypothesis | Result | Evidence |
| --- | --- | --- |
| What-if exists before signing and shows dollars | Exists, is the default pane. Dollars only per changed row, no total | `windows/approval/MandateEditor.tsx:136,342-359`; `owner/simulation.ts:35-47`; `owner/WalletLimits.tsx:49-57` (TOM-L1-04) |
| Wallet-wide limit visibly beats an agent rule | Said in static copy and as 'over your wallet limits' on a refused deal. Not shown while editing; a cap-bound deal folds into 'same' | `lib/words/rules.ts:93`, `lib/words.ts:552,628`, `owner/simulation.ts:22-28` (TOM-L1-01) |
| List search / filter / sort / bulk | Search, filter chips with counts and sort: yes (ListEngine). Bulk: none anywhere | `console/ListEngine.tsx:43-85,222-253` (TOM-L1-02) |
| Virtualised lists use react-virtual | True, but every list is cut into pages of 20 first, so windowing is moot | `lib/data/useWindowedRows.ts:16`; `ListEngine.tsx:37,153-159` (TOM-L1-07) |
| Rewind per deal | Week-wide Rewind plus per-deal story view (same steps, TickMark) | `areas/rewind/RewindLayer.tsx:128-151`, `areas/deal/StoryView.tsx:19,132` |
| No two gold buttons | One gold on Rules, Limits, editor footer, sign sheets, Counter tray. Two possible on Wallet setup and maybe Tables: L2 count | TOM-L1-12 |
| 50+ rows | Mock: 500 deals, 8 sets in force, 5000 audit rows. Search/filter hold; paged at 20; toolbar vanishes at 8 rows or fewer | `mock/scale.ts:299-330`; `ListEngine.tsx:33,170` (TOM-L1-06) |

## Surface model (condensed)

- **Rules place** (`areas/rules/RulesLayer.tsx`): answer line, one gold 'Change rules' only when a set is missing or not in force, four cards (in force, not in force, lowest 'asks you above', wallet limits), a ListEngine of sets (filter In force / Not in force, sorts By agent / Newest / Ends soonest) beside the picked set in words. Read only: Change hands off to the approval window (`ToApproval`, target mandate).
- **Limits place** (same file `:210-254`): meters today against signed caps (budget used, held, deals) and 'Change' with no target.
- **Approval window**: `OwnerConfig.tsx` (wallet setup page, rule sets as plain rows, Wallet limits section `:312`) opens `MandateEditor.tsx` (tab per set, replay pane or levers, footer gold 'Review & sign changes...') then `SignSheet.tsx` (Now / After table, plain-words consequences, what-if line, gold 'Sign with your owner key'). Limits: `owner/WalletLimits.tsx` sheet with `envelope_simulate`.
- **Counter**: Open orders, Your prices (multi-item draft tray with impact), Shop rules, Closed orders. **Tables**: open and closed lists, Watch, Shop around (`areas/tables/Shop.tsx`). **Spend**: lists with five outcome filters and three sorts. **Rewind**: scrubber plus searchable, filterable tape.

## Walk, in character

**sign-rules.** I open Rules. Eight sets, no toolbar (TOM-L1-06), so I scan by eye; the rows read 'Shopper - purchases of office supplies' and the next row may read the same (TOM-L1-05). I pick one, press Change, land in the approval window, and open the editor. Good: it opens on 'This week', a scoreboard shows refused / asks / agent-may now and after, and the unchanged deals fold away. I raise 'most per deal' and the replay re-runs. I want to know how many dollars that would have let through; I get counts and have to add the amount cells by hand (TOM-L1-04). I push the limit above my wallet cap. The what-if says nothing moved and the lever never mentions the cap (TOM-L1-01). I sign, once, with a clear sheet. Then I do it five more times for the other agents (TOM-L1-02). Wallet limits: 'Change' on the limits page drops me at the top of Wallet setup and I scroll (TOM-L1-11). The limits sheet itself is good: a sentence, a table of changed purchases, one button (S2). The audit row exists in Rust but the Book would read it as 'A step by your wallet' (TOM-L1-08).

**counter-shop-and-wallet.** In Counter > Prices I type new floors on 12 SKUs: stepping, Shift for tens, an impact list of quotes that would be withdrawn, and an Esc guard (S3). Then Review & sign sends only the first floor to the approval window and tells me the rest 'follow one at a time' (TOM-L1-03). Market band: shows 'checked <clock>' but not saved-copy or basis (TOM-L1-09). Shop around groups one item per press (TOM-L1-10). Rewind and the per-deal story explain each step well (S4).

## Scored acceptance criteria

1. What-if before signing: **pass** (counts and per-row dollars; total absent, TOM-L1-04).
2. Wallet limit beats agent rule visibly: **partial/fail while editing** (TOM-L1-01); pass after the fact on a refused deal.
3. List search/filter: **pass** where rows exceed 8 (TOM-L1-06 for exactly 8).
4. Rewind per deal: **pass**.
5. No two gold buttons: **pass in the paths checked; two L2 counts open** (TOM-L1-12).

## Feedback, first person

"Show me the diff before I sign. Mostly you do: the replay is the first thing I see on a rule I already have, and I like that unchanged deals fold away. But a diff for a treasury person is dollars. 'Refused 1, asked 2, allowed 6' is a headcount; give me 'would have stopped $4,210'. The thing that worries me most is the cap. I set my wallet limit above everything on purpose, and when I widen an agent rule past it you tell me nothing changed and never say why. That is a silent override, and silent overrides are exactly what I distrust. The rest is repetition: six agents, six editors, six signatures; twelve prices, twelve trips. The lists are fine, search and counts and sorts everywhere, but the toolbar disappears at eight rows, which is precisely my size, and my six agents are really three slots with no names. Would I tell a peer? I'd say the safety story is the best I've seen and the scale story is not there yet. Cut the repetition and I save most of the eight hours; as built, maybe three and a half."

## Ranked findings (impact = frequency x reachability x trust erosion)

| Rank | ID | Severity | Title |
| --- | --- | --- | --- |
| 1 | TOM-L1-01 | major | Wallet cap invisible while editing a rule; cap-bound deals fold into 'same' |
| 2 | TOM-L1-02 | major | No bulk or cross-agent rule change |
| 3 | TOM-L1-03 | major | Counter hands off one floor at a time (N prices = N round trips and versions) |
| 4 | TOM-L1-04 | major | What-if in counts, no dollar total |
| 5 | TOM-L1-05 | major | 'Six agents' are three slots; no agent names (uncertain, L2) |
| 6 | TOM-L1-06 | minor | Toolbar hidden at 8 rows or fewer |
| 7 | TOM-L1-07 | minor | Lists paged at 20; virtualisation moot; guide says windowed |
| 8 | TOM-L1-13 | minor | What-if window fixed at 7 days, dates not shown |
| 9 | TOM-L1-09 | minor | Counter market line lacks saved-copy and basis, no staleness flag |
| 10 | TOM-L1-08 | minor | Wallet-limit audit row unreadable; signed_at unread (needs Rust-backed L2) |
| 11 | TOM-L1-10 | minor | Shop around one group per press |
| 12 | TOM-L1-11 | minor | Limits 'Change' lands at top of setup page |
| 13 | TOM-L1-12 | polish | Gold count: two possible on Wallet setup, Tables to count (uncertain) |

Strengths to protect: TOM-L1-S1 (what-if as default pane, real engine replays under limits), S2 (limits preview), S3 (Counter draft with impact), S4 (Rewind narration, ListEngine everywhere).

## Notes for L2

- Run on `?scale=large` for rules, lists and the toolbar findings.
- Findings 01 and 08 depend on Rust behaviour the mock does not model: `mock/backend.ts:1337-1369` (no wallet limit in `mandate_simulate`) and `:1378-1387` (no audit row for `envelope_sign`). On the preview they resolve `uncertain`, never `refuted`.
- Nothing here is in `uat/accepted-gaps.md`.
