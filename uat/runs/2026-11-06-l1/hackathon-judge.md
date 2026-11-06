# L1 walk: Hackathon judge x evaluate-in-20-minutes

Run 2026-11-06, code-grounded, no browser. Findings: `hackathon-judge.findings.json` (JUDGE-L1-01..13).
Everything below is verified against code or docs unless marked uncertain. The brief's leads were treated as hypotheses.

## Verdict: L1-conditional

The judge can finish the job structurally: `pnpm dev` serves director, arena and proof, all labelled as sample or recorded data. Four majors carry into L2. Three of them are README or doc honesty (stale date, dead film pointer, design report promising unbuilt paths) and are fixable in minutes. The fourth is structural: there is no zero-install route.

**Time saved (designed, if all works): about 60-90 min saved** against the manual way (clone, install Rust and Tauri on Windows, read source), because the director plus arena plus proof give the trust story in about 15-20 min of browser time. **Confidence: medium-low.** The manual baseline is an assumption (character file says no figure is claimed), and cold `pnpm install` time and Node-version behaviour are unmeasured.

## The first 20 minutes, walked

1. 0-2 min: README top. Pitch is clear. The status line says 2026-10-08, and today is 11-06 (JUDGE-L1-02). A dense 30-line theme list follows before any run instruction.
2. 2-5 min: the first runnable block (line 55) wants cargo and the pinned Rust 1.97, headed "2 minutes" (JUDGE-L1-04). I have no Rust, so I skip down. The browser path at line 102 is titled "without installing anything" and step 1 is `pnpm install` (JUDGE-L1-01). Ports, scripts and pages all verify (JUDGE-L1-12).
3. 5-12 min: director plays Maya's week. Banner says sample data, not the wallet (JUDGE-L1-11). I try `?story=say`; it exists.
4. 12-17 min: arena, 14 recorded cards, tagged "Preview - recorded answers". I type my own scam note. It answers from a recording by keyword, which README oversells slightly (JUDGE-L1-07).
5. 17-20 min: proof page, break a proof by typing over the price. Good. I look for the film README promised under `film/` and there is none (JUDGE-L1-03). I open the design report, see macOS and Windows binaries and a Scripted engine banner, and find none (JUDGE-L1-06).

Judge-runnability without Windows or an engine CLI: yes for the browser pages. The native app, HOUSE, real PayPal sandbox and `claude-code`/`codex-cli` are all unavailable by design and disclosed (accepted gaps). The sandbox crate compiles on Ubuntu in CI, so a Linux judge with Rust has a second route (README:55-100).

## Name ban
BUILDER.md does not exist here; the rule is AGENTS.md:46. Client words contain only the sanctioned ids `claude-code` and `codex-cli`; no model or vendor brand found. Open question: "Windows Hello" in user strings (JUDGE-L1-08, uncertain).

## First-person feedback (judge)

I would not drop this entry. It tells me what is not done, and I trust that. The director and arena are the first submission in my stack where I could poke the safety claim myself and get a recorded answer pinned to a test. That is the Tech and Innovation score.

What irritated me: the README is the first thing I read and it is dated a month ago. It points me at a film that is not in the repo. Its "without installing anything" section starts with an install. I judge many entries in a week; each of these costs me a small amount of trust before I have seen the product. Its own design report promises macOS and Windows binaries that do not exist, and I cannot tell which document to believe.

Does it fit my world: only if I will clone a repo and run Node. A hosted link or the video at the top would make me comfortable. Would I tell a peer: "watch the director, try the arena, ignore the README header". I would rather say "read the README".

## Ranked findings (impact first)

1. JUDGE-L1-01 major: no zero-install path; heading contradicts its own step 1.
2. JUDGE-L1-03 major: README points to a film that is gitignored and absent; no video link.
3. JUDGE-L1-06 major: design report promises binaries, Scripted banner, HOUSE; README says none exist.
4. JUDGE-L1-02 major: status date 2026-10-08; STATUS.md header 2026-10-06.
5. JUDGE-L1-04 minor: "2 minutes" Rust path is unmeasured and listed before the cheap path.
6. JUDGE-L1-05 minor: Node and pnpm versions unpinned in the repo yet CI uses Node 24 and pnpm 11.
7. JUDGE-L1-07 minor: typed arena note answers by recorded keyword match.
8. JUDGE-L1-08 / 09 minor, uncertain: Windows Hello wording; rule numbers on the sandbox page.
9. JUDGE-L1-10 minor: judge character and backlog stale.

Strengths: JUDGE-L1-11, 12, 13.

## L2 priorities (environment preconditions)
- Cold `pnpm install` plus dev from a clean clone, Node 24 and an older Node (JUDGE-L1-01, 05).
- Cold `cargo run -p table-sandbox` timing and page on :1443 (JUDGE-L1-04); needs empty cargo caches.
- Fresh clone of origin: is `film/` empty, and is the repo public (JUDGE-L1-03).
- Director banner visible at 1280x720; arena typed-note wording (JUDGE-L1-11, 07).

## Not findings (accepted)
Live PayPal spikes not run, HOUSE not deployed, native shell unverified (accepted-gaps.md).
