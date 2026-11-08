# L2 preflight, pass B (Sam, Grace, Chen, Hackathon judge)

Date 2026-11-06. Driver: playwright-core, headless Chrome (channel chrome), 1280x720 unless stated. Scripts in the session scratchpad (`pw/`), not in the repo.

| Precondition | Resolved value | Arm used |
| --- | --- | --- |
| Server | http://localhost:1430 already running (reused, no second instance). All six pages return 200, 0 page errors (arena logs 2 ERR_CONNECTION_REFUSED for the optional sandbox probe on :1443) | Vite dev, MOCK backend |
| Sandbox on :1443 | Not running (confirmed by the refused probes) | Arena in recorded-only mode, which is what SAM-L1-01 / -02 require |
| Fixtures non-empty and distinct | Board: 6 need you (Tables 2, Spend 1, Counter 1, Shield 1, Rescue 1), 158 ledger entries; approval lists 5 distinct rules; Tumbler list holds 6 distinct items (D-0193 $329.00, $140.00 pixel-bay, $118.00 lark, $64.00 partsco, $9.60 fix, D-0199 mismatch $339 vs $329); proof deal 01M6BDBV… plus 2 attack files | pass |
| Residue | Mock state is in-memory; page loads reset it. No localStorage written by my runs that outlive a context (fresh context per script). Nothing written to the repo apart from this run directory | clean |
| GATE with deadline over 45 min / over 2 h (snooze, calm rung) | D-0193 "Approve $329.00", 3 h 57 min left, rung calm, snooze offered | built-in sample |
| Hold item | "Amount mismatch arrives" (D-0199) from the preview controls | built-in |
| Arrival event | "New decision arrives" (Approve $48.00) | built-in |
| Reduced motion | context option reducedMotion=reduce | emulated |
| 200% zoom | Not possible as true browser zoom headlessly. Used (a) 640x360 viewport (= 200% of 1280x720), (b) 400x225 (about 320%), (c) text-only 2x by doubling every .card computed font-size | simulation, labelled as such |
| Screen reader | None available | speech claims resolve uncertain |
| Native shell / Windows Hello / NVDA | Out of scope | uncertain, fixture named per finding |
| Identity chrome | None (no signed-in header); chips "Preview · sample data" on every page except proof.html | n/a |

Not drivable here: C-14 (deployed HOUSE), C-15 (IPC error text), clean-machine install time, real Rust sandbox, flood of refusals, Narrator/NVDA speech.

Note: `pw/lib.mjs` was overwritten by another pass in the shared scratch dir; this pass used `Blib.mjs`.
