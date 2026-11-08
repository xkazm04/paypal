# env.md - how to reach the start state
- Not Next/auth: the client is Vite + React, preview runs on a MOCK backend with sample data (no PayPal, no keychain, no Windows Hello).
- Install: `pnpm --dir apps/desktop/client install` (node_modules already present on this host).
- Start: `pnpm --dir apps/desktop/client dev` -> http://localhost:1430
- Pages: `/index.html` (main console; hash routes like `#m=tables&v=watch`), `/tumbler.html`, `/approval.html`,
  `/director.html` (`?story=say`), `/arena.html`, `/proof.html`.
- Reuse a running server on 1430; do not start a second.
- Fixtures: sample data in `apps/desktop/client/src/mock/` (haggle.json, tables, book). Preflight: assert the book/tables are non-empty
  and deals differ; the recorded house haggle is deal D-0205.
- Native shell (`npm run tauri:dev:test`, Windows only): not L2-drivable by a browser driver; interactive checks only.
- Language: English. Driver: Playwright is NOT installed in the repo; L2 uses the Claude-in-Chrome tools or installs Playwright in a scratch dir.
- Grounding denominator: not applicable (the engine is the owner's own CLI; no in-product LLM prompt surface in the client).
