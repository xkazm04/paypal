# Calibre console (design target)

Standalone static prototype chosen by the owner (contest `table-console`, round 3, variant "Calibre", 2026-10-14): the refined "Seal" console with the Calibre theme. It is the **design target** for the main-window rebuild (spark `table-console-rebuild`), not product code. Do not import from it; do not copy its patterns that the rebuild brief rules out (innerHTML templating, `window.*` globals, string-command switch, optimistic "Approved").

It loads sample worlds from `../data/scale/{small,large}.js`, which are not committed (2.6 MB each); regenerate with `node apps/desktop/client/scripts/export-scale-fixtures.mjs --out <dir>` and place the output in a `data/scale/` folder beside this one to open `index.html?scale=small|large` from disk.
