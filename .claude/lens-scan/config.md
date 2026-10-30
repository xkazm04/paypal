---
context_map: context-map.json
standard_lenses: C:/Users/kazda/kiro/bp/docs/standard/lenses
project_slug: paypal
project_name: "PayPal Agentic Wallet (The Table)"
default_lens: development
---

# lens-scan overlay - written by /adopt-bp 1.2.0 on 2026-10-13

The product tree in .ai/lens-scan/app-structure.json is declared (provenance.product_tree: adopt-bp): lens-scan
phase 1 merges into it and never remaps contexts 1:1. Add `## Gates`, `## Harness` and `## Probes` as the
lens-scan SKILL.md overlay table describes; standard_lenses is a machine path to the bp checkout.

## Harness

Written 2026-10-14 for bp's validation run. The desktop client renders in a plain browser on its mock
backend (src/lib/runtime.ts falls back to mockBackend outside Tauri), one Vite page per Tauri window.
The approval window is always dark by design. Native window capture is a planned follow-up.

command: cd apps/desktop/client && npx vite --port 1430 --strictPort
url: http://localhost:1430
ready: /
sizes: 1280x800
themes: light, dark
theme: storage table-theme
features:
  table-main-window: route /index.html
  approval-window: route /approval.html
  tumbler-operative-window: route /tumbler.html
  deal-and-mandate-rules: unscreenable "no window of its own: core domain rules, shown through the main window"
  owner-approved-payments: unscreenable "no window of its own: the payment pipeline, shown through the approval window"
  ledger-and-receipts: unscreenable "no window of its own: the ledger crate"
  agent-runtime: unscreenable "no window of its own: the runtime crate"
  llm-engines: unscreenable "no window of its own: engine adapters"
  agent-tools-and-market: unscreenable "no window of its own: agent tools and market data"
  two-wallet-haggling: unscreenable "no window of its own: protocol and relay"
  house-seller: unscreenable "no window of its own: a seller service"
  native-host-and-ipc: unscreenable "native window only: the Tauri shell and IPC contract"
  build-ci-and-submission: unscreenable "no window of its own: build and CI"

## Skill improvement log

- 2026-10-14 (business baseline r-20261014102726-faeb): the map's footprints miss table-engine/src/policy.rs, house-seller/src/glass.rs + routes.rs, approval-window templates.ts and review/*, and table-attention/src/schedule.rs; judges counted only listed files, so readings for llm-engines, house-seller, approval-window and tumbler undercount until an /adopt-bp rescan adds them.

## Skill improvement log

- 2026-10-14: the context map lists files, not directories, for the Rust crates, so a file split (008ba69 split table-runtime's tests.rs) drops `loc` with no real change. Before reading a delta, check `git log --stat` since the last measure run for new files under a mapped crate; refresh the context map first if there are any.

## Skill improvement log

- 2026-10-14 (quality lens): the map's context file lists miss the per-concern `*_tests.rs` modules (e.g. table-runtime after the test split), so test-reading lenses must walk the crate directory, not only the listed footprint; until `/adopt-bp` rescans, judge from crate dirs. flowTests excludes helper tests and counts click tests with stand-in callbacks (table-main-window: 11; mock-backend-only reading would be 2) - keep that boundary on rescans so the series stays comparable.
- 2026-10-14 (registry lens r-20261014103913-0916): until paypal is registered (no .ai/manifest.yaml, so no knowledge domains), build-registry-map.mjs refuses and the lens's conform step cannot run; per-feature registry metrics stay unmeasured. `registered` is also unmeasured while the registry checkout in $AI_REGISTRY_DIR has no .machine.local.json. Approve p-2d33d2 before re-scanning this lens.
- 2026-10-14 (execute p-2d33d2): paypal is now registered (registry commit 08e75303 in the $AI_REGISTRY_DIR checkout; product .ai/manifest.yaml + .ai/registry-map.json, untracked here). A registry-target item built in a fresh registry worktree needs the gitignored .machine.local.json copied in (register-project refuses without it); remove the copy before git worktree remove. The registry lens now has 13 features mapped and the conform step can run.
- 2026-10-14 (registry lens r-20261014104621-50ab): conform verdicts land in .ai/registry-map.json, which is untracked here and AGENTS.md forbids commits unless asked, so verdicts persist only on this disk; a rebuild or fresh clone loses them. Decide whether .ai/registry-map.json is tracked before the next conform step.
- 2026-10-14 (business rescan r-20261014111513-973c, on the 11:08 map): with code unchanged since the baseline, most deltas are footprint artefacts, not change - approval-window's USD-only case was false (owner/WhoWhat.tsx:125 has a currency picker, outside the old footprint). Counting convention set for the series: template / default rule sets count one rule per limit (approval-window templates.ts -> 28; per-template counting would read 12), and a client literal that copies a backend rule counts only where the client value itself decides what the owner sees.
- 2026-10-14 (quality r-20261014111427-cbba): after the 11:08 map rescan, test attribution is "one test counts once, under the feature whose flow it drives" - agent-runtime flowTests 120 -> 26 is re-attribution (62 to owner-approved-payments, 22 IPC/unlock to native-host-and-ipc, 10 attention-ladder to tumbler), not lost tests; parallel judges double-count unless the director de-duplicates across features before writing. The rescanned build-ci-and-submission footprint is only docs/report/report.css; it was judged on its summary, so the map needs scripts/*.ps1, ci.yml and table-verify's acceptance test.
- 2026-10-14 (development r-20261014112613-03d9, first judgement pass): standards judged per feature are a fixed set (module-design/module-depth, io-free-core, seams-and-adapters; test-harness/negative-control-tests, unreached-decisions-pin-nothing; + migrations/audit-logging extras for ledger, ipc-contract drift-gates/error-shape-mapping for native-host) and the dupSites rule is in .ai/lens-scan/work/dev-judge-brief.md - reuse both verbatim or the series breaks. negative-control-tests is a deviation in every tested feature for one repo-wide reason, so a single repo-level item moves it, not 13. build-ci-and-submission's footprint is only report.css: standardsPct stays unmeasured until the map adds CI/Docker/scripts.
- 2026-10-14 (security r-20261014112739-ad3a): one judge per 2-4 features reads ~25-45 files fully; table-main-window (~105 files) and approval-window (36) got partial reads (18 / 10, rest grepped), so their security counts may undercount. Give each >50-file feature its own judge on the next security scan. Judge write-ups (finding titles, fixes) are kept in .ai/lens-scan/findings/<run>/ for the propose phase; the store keeps only file:line.
- 2026-10-14 (design r-20261014114019-7f23, first full judgement pass): undesignedStates now counts surface x state per .ai/lens-scan/work/design-judge-brief.md (the 0s of r-20261013105700-ac28 were a grep and are not comparable); reuse the brief's 14-technique set verbatim. rawLiterals=0 everywhere is not token conformance: the static rule skips .css, and judges found raw colours in director.css, safety.css and tumbler.css. approval-window's theme-architecture deviation includes "ignores stored theme", which this overlay says is by design - decide whether that clause stands before proposing on it.
- 2026-10-14 (registry lens r-20261014114518-b1bf): the 11:08 map rebuild renamed contexts to ids, carried 0 verdicts and orphaned all 6 from r-20261014104621-50ab, so judgedPct/conformantPct fell with no code change. Before the conform step, read `orphans[]` and adopt by evidence anchor (digest unchanged + anchor lines re-read) or the series loses paid verdicts; approval-window/hitl-approval (conformant) stays orphaned because its anchors span 4 contexts, which is why approval-window conformantPct reads 0 (was 50). topicsMapped jumps (e.g. native-host-and-ipc 30 -> 80) are the rebuild's re-matching, not new code.
- 2026-10-14 (propose r-20261014115841-f613, 7 lenses): the business unhandledCases and design undesignedStates judges counted the same UI failure sites (table-main-window Home.tsx:643/Shell.tsx:116, tumbler Tumbler.tsx:210/:217). Partition sites between items by lens so one change is not claimed twice; the business item names the design delta it also moves. Registry `deviations` per feature is the count of map verdicts in state deviation, so a registry item's After is re-read from .ai/registry-map.json only after /conform re-judges the pair.
- 2026-10-14 (registry lens r-20261014155540-7cff): runtime-market-and-pairing is shared by agent-tools-and-market and two-wallet-haggling, so its device-pairing deviation counts in both features' `deviations` (agent-tools-and-market reads 2, but the only verdict on its own contexts is mcp-tools). Partition shared contexts before proposing, or one fix is claimed twice. Parallel judges of the same subject (test-harness) split on mutation-lane-with-a-triaged-baseline (not-realized vs n/a): give judges of one subject a shared technique-applicability line so verdicts stay comparable.
- 2026-10-14 (registry lens r-20261014160044-e266): build-ci-and-submission's only mapped context is overnight-build-report (docs/report/*), so its registry readings never see .github/workflows/ci.yml; its one pair (quality-gates) is not-applicable and conformantPct stays unmeasured. Map ci.yml into a context before reading this feature's registry numbers as CI conformance. The test-harness consistency line (money-path guards only) held across two UI contexts: both judged negative-control / mutation-lane n/a, not deviation.
- 2026-10-14 (execute r-20261014180702-0274): all 6 registry items built green but none moved `deviations`: /conform judges every technique of the subject, so an item scoped to one clause (or one technique) of a multi-clause verdict cannot flip the pair. Before proposing a registry item, list every failing technique in the pair's evidence and either scope the item to all of them or propose against a metric that a partial fix moves. Also: never share the main checkout's CARGO_TARGET_DIR with a worktree here - cargo hashes workspace crates by relative path, so table-desktop's build script ran with the other checkout's stale authority table.
