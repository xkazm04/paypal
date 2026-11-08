# Omar, new owner on day one: L1 walk (2026-11-06)

Level L1 (code-grounded, no browser). Journeys: first-run-onboarding, sign-rules. Findings: `omar-first-time-owner.findings.json` (OMAR-L1-01..11, three strengths).
Scope honesty: accepted gaps (HOUSE not deployed, native shell unverified) are not counted as defects; only their unaccepted consequences are.

## Verdicts

| Journey | Verdict | Why |
| --- | --- | --- |
| first-run-onboarding | **L1-conditional** | Structure completes in the designed (mock/preview) world. In a plain real build the practice deal is unreachable (-02), line I needs an outside account (-01), install needs a terminal (-03). |
| sign-rules | **L1-conditional** | Say it and the sign sheet are strong. A new wallet cannot sign without inventing a payee code (-04), and the what-if is empty and not in dollars on a first rule (-08). Hello dead end (-09). |

Time saved if it all worked: about 3 to 4 h/week of his 5 h/week sourcing (assumption from the Character file), against a one-off setup of 25 to 40 minutes once the outside sandbox signup is counted (about 12 minutes without it). Confidence: low. What is live today: about 0 min/week, because no agent app is usable (the probe always reports claude-code and codex-cli unavailable, README:214-217) and the practice agent only haggles inside a fixed range.
Grounding score: not applicable (env.md, no in-product prompt surface). Wiring audit: `lib/words/setup.ts` exists as an empty stub (`export {}`, :7) while its header claims every setup string lives there; the strings are in `words.ts` (0 of ~35 setup strings in the file named for them).

## Surface model (reachable for Omar)

Entry: Console, brand-new wallet. `gettingStarted().show` makes the Charter the Home layer (core.tsx:31-34), tabs stay reachable. Charter = five lines, order `keys, rules, practice, agent, unlock` (logic.ts:343); current line = first undone (Charter.tsx:56); every line is clickable (Charter.tsx:195).
- I keys: gold `Add PayPal keys ↗` hands off to the approval window; keys typed into OS dialogs.
- II rules: `Sign rules ↗` (default) plus Say it (gold `Review rules`), approval window editor, sign sheet.
- III practice: PairingDesk embedded (3 modes, house needs a "Paid to" field).
- IV agent: radios (engines minus practice) + gold `Keep the practice agent for now` + `Check again`.
- V unlock: Hello.
Approval window (separate window, Tour of its own), Tumbler (third tour). Reachability: all main-window lines reachable; the house line is reachable but inert when house = unavailable.

## The verifications asked for

- **Skip and resume.** Yes, structurally. Tour: Esc or Skip tour, stored per window, "Take the tour" reopens (tour.ts:49-89). Setup: lines derive from wallet facts, so a restart lands on the first open line; a handoff closed unfinished says "Not finished yet. Nothing has changed." with Reopen (Charter.tsx:96-103, words.ts:861). Cost: skip is per window, so three tours. Charter's own "Skip: open the sample wallet" exists in preview only (Charter.tsx:185). Strength -S1, finding -07.
- **No engine CLI installed.** The runtime never attaches it (engines.rs:115-118), so the picker's list is empty and has no empty-state sentence (Charter.tsx:236-244). The gold keep-practice button saves the step (strength -S3). With a CLI installed it is still "not connected" with passed-through engineering reasons (native.rs:630-633, engines.rs:136-141). Finding -05.
- **Practice vs real.** Safety promise on the Charter is clear (words.ts:709). The mode badge says "Sandbox", meaning explained only by hover (honesty.tsx:15-22). Nothing real can move in this build, so the risk is that he thinks his real PayPal is connected. Finding -11.
- **Terminal needed?** Inside the app, no. To get the app: yes (rustup, pnpm, `cargo run`; relay by PowerShell env var; README:172-231). Finding -03.
- **Jargon strings (actual).** In rendered first-run surfaces: "claude-code", "codex-cli" (words.ts:728, 753, 757, 761; Charter.tsx:240; OwnerConfig.tsx:38), "Sandbox", "PayPal sandbox keys", "developer.paypal.com", "owner key" (SignSheet.tsx:67, 126), "Idle-locked", "owner configuration" (common.tsx:21, 28), "payee" / "Who may they pay?" / "payee names of the shops you use" (Templates.tsx:11), "item code ... as the seller lists it" (Templates.tsx:12, example "monitor-24-ips"), "four words", "Charter", "Line II of V", "approval window", "The Table", "Windows Hello", "agent app". Engine reasons: "Engine version probe failed", "The wallet can't yet confirm this agent app reaches only the wallet's own tools". Eighteen distinct terms he cannot know; two (engine names) break the guide's own "never vendor names" rule. Finding -06.
- **Decisions per screen.** Line I: 1 gold (+ tour). Line II: 2 competing actions, 4 example sentences, mic, Read it, Clear, plus the line list (about 10 controls, finding -10). Line III: 3 modes + payee field + submit. Line IV: 0 to 2 radios + 2 buttons. Approval editor on first signature: 3 template cards, payee field, up to 6 levers, then sign sheet.
- **Steps to first signed rule (best case, Hello set up, sandbox account already exists, preview-style flow).** Launch 1; tour skip 1; Line I: open approval 1, unlock 1, per-key dialogs about 3 (-> 6, with the approval tour skip +1 = 7); Line II: click a try-line 1, Read it 1, answer 0 to 2 questions, Review rules 1, unlock again if idle 0 to 1, type payee 1, Review & sign 1, Sign 1 (Hello) = about 7 to 9. Total about 15 to 17 actions across 3 windows to a signed rule; practice deal not reachable in a real build. Rules-first (skip line I) saves about 6 actions but the UI offers no such order. Estimated 12 minutes without the outside signup; the 15-minute goal fails once it is counted.

## Ranked findings (impact = frequency x reachability x trust erosion)

1. OMAR-L1-04 (major, high/high/high) payee code needed before he has any connection; spaces refused.
2. OMAR-L1-02 (major, high/high/high) practice step dead in plain build; Charter stays Home, no honest skip.
3. OMAR-L1-01 (major, high/high/med) line I needs a developer.paypal.com account, no help.
4. OMAR-L1-03 (major, high/high/med) install from source, PowerShell env var for the relay.
5. OMAR-L1-08 (major, high/high/med) what-if has no dollars and nothing to compare on a first rule.
6. OMAR-L1-09 (major, low/med/high) Windows Hello unsupported is a dead end.
7. OMAR-L1-06, -05, -07, -10, -11 (minors: jargon, empty engine list, triple tour, inconsistent counts, "Sandbox").
Strengths: -S1 skip/resume and safety promise, -S2 Say it and sign sheet honesty, -S3 graceful missing engine.

## Omar, first person

"I sell leather bags. I was told an agent could do my supplier haggling. The first screen is calm and I like the sentence 'Nothing pays without you or a rule you signed', I actually read that twice. Then it says 'Line I of V, add your PayPal sandbox keys'. I have a PayPal account. Is a sandbox the real one? It says go register at developer something. I did not come here to register for anything. If I get past that, the rules part is friendly: I typed what I wanted and it told me back in my own words, and told me which parts it had guessed. That is the best thing here. Then it asks who may they pay, as a code with no spaces, and I do not have anyone yet, because connecting comes after. I would be stuck, and I would not know whom to ask. The agent step lists nothing and doesn't say why; I pressed 'Keep the practice agent' and it let me move on, fine. 'Windows Hello' wanting me again and again makes me nervous. Would I tell a peer? Not yet: I would say it looks careful, and it is not for people like me today. If the first rule took ten minutes and never asked me for a code, I would."
