# Owner spike results

Only the permitted version-only spike 6 was run in this session; it passes after
the Node script-path fix. No model, PayPal or Channel3 spike ran. `scripts/spike.ps1`
appends one row per invocation and writes structured, non-secret evidence under `.build/spike-results/`.
Keep the JSON with the run; `.build` is ignored by git. After review, copy only the
relevant non-secret findings into STATUS.md and replace the row's observation text.

Record browser account identity, invoice email delivery, any custom-scheme OS prompt,
existing decoy MCP servers, and the final workflow outcome. Exit 0 means the diagnostic
finished; read the evidence verdict before declaring an integration supported.
Never paste credentials, tokens, raw model output, merchant notes or approval URLs here.

| Started UTC | Spike | Exit | Evidence file | Owner observations |
| --- | --- | --- | --- | --- |
| 2026-10-02T18:44:31.3396439+00:00 | 6 | 101 | `.build/spike-results/spike-6-20261002-184438-2005791.json` | claude-code direct version passed; Node rejected the canonical verbatim script argument (EISDIR). Fixed before the next invocation. No model started. |
| 2026-10-02T18:49:23.5336439+00:00 | 6 | 0 | `.build/spike-results/spike-6-20261002-184927-7016758.json` | claude-code direct 2.1.287 and codex-cli node_script 0.160.0 both pass. No model started. Interactive window visibility still needs owner observation. |
