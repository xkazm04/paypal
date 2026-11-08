# Live e2e (real desktop app over CDP)

Drives the real Tauri shell (WebView2), the Chat view and the Platform view. It reads and navigates only:
no typing into credential fields, no signing, pay, release or approve clicks; it detaches at the end.

1. `cargo build -p table-desktop` (after `pnpm --dir apps/desktop/client exec vite build`).
2. Optional fresh start: move `%APPDATA%\dev.thetable.wallet` aside, restore it afterwards.
3. `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 target/debug/table-desktop.exe`
4. `PLAYWRIGHT=<ascent>/node_modules/playwright/index.mjs node apps/desktop/client/e2e/live/run.mjs`

Output: a PASS/FAIL line per check, screenshots and `report.json` in `e2e/live/out` (gitignored).
Verified 2026-11-08: the shell honours the WebView2 argument and one port lists all windows (main, tumbler, approval).

PayPal sandbox: the desktop app reads its keys from Windows Credential Manager, entered only through the approval
window's native dialog, so this run has no keys. Money paths run as Rust sandbox tests with
`scripts/sandbox/.env.sandbox`: `scripts/sandbox/run-live.ps1` (spikes 3, 4, 5 need the buyer to approve in a browser).
