// Words for the spend area of the console (rebuild WP3). Owned by the WP3 builder of this area; every
// user-facing string of the area goes here, never inline. Re-exported from lib/words.ts by one
// `export *` line, so importers keep `import { X } from '../lib/words'`. Rules (docs/ux/UX-GUIDE.md):
// sentence case, Maya's words, no internals (commands, ids, clause numbers, raw states), PayPal is
// the only vendor name, every needs-you line carries "If you do nothing". Prefix exports with the
// area (e.g. `SPEND_`): two areas exporting one name is a type error in lib/words.ts.
export {};
