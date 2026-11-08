# YouTube sponsorship: the live end-to-end runner

One business case, run end to end so the owner can judge the onboarding chore: a YouTube creator
sells sponsored slots and shout-outs; brands' agents haggle at the creator's Tables inside rules the
creator signs; money goes through PayPal (sandbox). The story, the beats, who acts at each one and
the known gaps are in [docs/e2e/youtube-sponsorship.md](../../../../../docs/e2e/youtube-sponsorship.md).

The runner is a **guided runbook plus an observer**. It drives The Table where that is harmless,
and at every step only the owner may take it stops, prints a **YOU DO THIS** card in the terminal
(what to click, where, what done looks like), then watches the app until it sees the step done (or
times out with a plain message) and carries on. It records per-beat timings, screenshots in light
and dark, console errors, and a friction log.

It never approves, signs, pays, pastes keys, confirms a connection or unlocks. In the live app that
is enforced in `lib/app.mjs`: clicks are refused outside The Table, and inside it only an allow-list
of tour, theme and navigation controls can be pressed; typing is refused altogether; no
`page.evaluate` touches the wallet's IPC.

| File | What it is |
|---|---|
| `run.mjs` | the runner: arguments, the beat loop, timings, screenshots, results |
| `beats.mjs` | the twelve beats: who acts, the card, the passive "done" check, the mock's simulated owner step, reference screens |
| `briefs.json` | the creator's rules and three brand briefs (one hostile); brand text is untrusted |
| `lib/app.mjs` | the app in either world (mock / live over CDP), the live refusals, DOM reads, the ledger-copy observer |
| `lib/card.mjs` | the terminal cards and the wait loop (owner keys: `d`, `s <why>`, `n <note>`) |
| `lib/friction.mjs` | automatic friction checks and `friction.md` |

Nothing here is a dependency of the client package, and nothing here is picked up by `vitest` (its
`include` is `src/**`) or `tsc` (its `include` is `src`).

## Requirements

- Node 22.18 or later (the runner uses `node:sqlite` for the ledger observer; Node 24 tested).
- Playwright, found the same way as the director's takes rig (`scripts/lib/rig.mjs`,
  `loadPlaywright`): `PLAYWRIGHT=<.../playwright/index.mjs>`, or `npm i -g playwright`. Playwright
  for Python works too: its driver ships the Node package, e.g.
  `PLAYWRIGHT=C:/Users/<you>/AppData/Local/Programs/Python/Python312/Lib/site-packages/playwright/driver/package/index.mjs`.
  `PW_CHROMIUM` may name a Chromium binary (mock only; live attaches to the app's own WebView2).
- `pnpm install` in `apps/desktop/client` (the mock run starts its Vite).

No new dependency was added.

## (a) Mock dry-run

From the repository root (Git Bash; PowerShell: `$env:PLAYWRIGHT="..."; node ...`):

```sh
PLAYWRIGHT=/path/to/playwright/index.mjs node apps/desktop/client/e2e/youtube/run.mjs
```

It starts Vite on port **1561** (`--port` to change; `--url http://localhost:1430/` to use a server
you already run), opens Chromium on the brand-new-wallet world (`?first_run=1`), pins the clock at
2026-11-05 09:00 America/Los_Angeles (`--at`, `--tz`), plays the twelve beats, and stops Vite and
the browser at the end. Owner steps are **simulated owner steps**: the harness clicks through the
mock's own approval window (the mock saves no real key, signs nothing real, moves no money), and the
results say so beat by beat. Beats the first-run world cannot reach (offers, the owner's price
approval, PayPal) are shown on the preview's sample week as **reference only (sample data)**.

Options: `--headed` (watch it), `--theme light|dark|both` (default both), `--only <beat>`,
`--from <beat>`, `--out <dir>`.

## (b) Live: the desktop app with PayPal sandbox

**Before the run** (once):

1. A PayPal developer account with a sandbox app (developer.paypal.com › Apps & Credentials ›
   Sandbox): its Client ID and Secret, a sandbox **business** account for the creator, and a
   sandbox **personal** account for the brand to pay with.
2. A second wallet for the brand. The app keeps one wallet per Windows user
   (`%APPDATA%\dev.thetable.wallet`), so the brand needs another PC or another Windows account.
3. A relay both wallets reach: run `rendezvous` (`cargo build -p rendezvous`, then
   `target/debug/rendezvous.exe`; it listens on `PORT`, default 8080, on all interfaces) or the hosted
   one, and launch both apps with `TABLE_RELAY_URL=http://<relay host>:8080`. The relay is attached
   only at launch and only from that variable. Without a relay nobody can be connected and beats 7 to
   12 cannot happen.
4. A brand-new wallet on the creator's side for day one: quit The Table and move
   `%APPDATA%\dev.thetable.wallet` aside (rename it; put it back after). UNVERIFIED: the owner and
   agent keys live in the Windows credential store, not in that folder, so an earlier install's
   keys may survive and the wallet may not look entirely new.

**Launch the creator's app with a debugging port** (PowerShell):

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
$env:TABLE_RELAY_URL = "https://<your relay>"
& "<repo>\target\debug\table-desktop.exe"     # or the installed app, or `pnpm tauri dev`
```

**Then run** (another terminal, repository root):

```sh
PLAYWRIGHT=/path/to/playwright/index.mjs node apps/desktop/client/e2e/youtube/run.mjs --mode live --cdp http://127.0.0.1:9222
```

The runner attaches with Playwright's `connectOverCDP`, finds The Table, the approval window and the
Tumbler by their page addresses (`index.html`, `approval.html`, `tumbler.html`), and detaches at the
end (it never closes the app's windows). At each card, do the step in the app; the runner sees it
done by itself. While it waits you can type:

- `d` + Enter: I did it (when the runner cannot see it),
- `s <why>` + Enter: skip this step (e.g. `s house unavailable`),
- `n <text>` + Enter: add a note to the friction log.

Owner steps wait 15 minutes (`--timeout-min`), brand steps 30 (`--brand-timeout-min`). A step that
times out is recorded and the run moves on; re-run one later with `--only <beat>` (for example
`--only money-confirmed` once PayPal's statement caught up, up to 3 hours).

**What is UNVERIFIED about attaching** (not run against the desktop app while writing this):

- that the Tauri shell lets `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` through (WebView2 reads it when
  the environment is created; if the shell passes its own browser arguments the variable may be
  ignored or merged: check `http://127.0.0.1:9222/json/version` answers once the app is up);
- that all three windows share one WebView2 browser process, so one port lists all three (they
  share one user-data folder, `%LOCALAPPDATA%\dev.thetable.wallet\EBWebView`, which suggests so);
- that Playwright's screenshots of WebView2 pages come out right at mixed DPI;
- the pages' addresses (`http://tauri.localhost/index.html` is expected on Windows; the runner only
  looks at the path).

### Fallback: observe without CDP

If the port does not answer, run with `--observe ledger`:

```sh
node apps/desktop/client/e2e/youtube/run.mjs --mode live --observe ledger
```

The cards are the same. The runner cannot read the screen, so it watches the wallet's own ledger
instead, **IPC-free**: it copies `%APPDATA%\dev.thetable.wallet\wallet.sqlite` (`--ledger <file>` to
point elsewhere) to a temp file and reads the copy read-only with `node:sqlite`, so the app's writes
are never blocked. It sees signed rules (`mandates`), connections (`counterparties`) and the
sponsorship deal's state, order and capture (`deals`); it cannot see saved PayPal keys (OS keychain)
or the agent-app choice, so for those you answer `d`. Screenshots are full-desktop PNGs through
PowerShell (one theme: whatever the app shows). The ledger copy is also used in CDP mode as a second
signal.

## Output

Every run writes a folder (gitignored: `/e2e-out/` at the repository root):

```
e2e-out/youtube/<YYYY-MM-DD_HH-MM-SS>/
  results.json   per beat: actor, status, signal, timings, clicks, screens, console errors,
                 friction findings, owner notes, gaps, mock or ledger state summary
  friction.md    the friction log: a table, one section per beat, then every finding ranked
  shots/NN-<beat>-<what>-<window>-<theme>.png   light and dark (desktop.png in observe-only mode)
```

Statuses: `done`, `done (simulated owner step)`, `done (simulated counterparty)`, `reference only
(sample data)`, `owner-reported`, `skipped`, `timeout`.

## The owner's steps, in order (live)

1. Beat 2: add the PayPal sandbox keys (approval window, Windows dialog; Windows Hello unlock).
2. Beat 3: choose the agent app or keep the practice agent (The Table, charter line IV).
3. Beat 4: build and sign the selling rules (approval window rules editor; Windows Hello).
4. Beat 5: connect the house seller and confirm four words (The Table, then the approval window).
5. Beat 7: type the brand's code, compare four words with the brand, confirm (both windows).
6. Beat 8: open the sponsorship table and send the brand the listing code (approval window).
7. Beat 9: (the brand) join with the code and haggle; you watch.
8. Beat 10: approve the price above "Ask me above" in the approval window, or let it lapse.
9. Beat 11: if asked, approve the order in the approval window; (the brand) approves on PayPal.
10. Beat 12: optionally "Check my PayPal statement" in the Book.
