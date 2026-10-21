// The words guard for WP3c's areas (deal, rewind, rules, connections, settings, safety): every
// string they show is in lib/words/<area>.ts, and none names a vendor other than PayPal, a rule by
// its number, a command, a raw state or an internal word (docs/ux/UX-GUIDE.md).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as words from '../../../../../lib/words';
import * as connections from '../../../../../lib/words/connections';
import * as deal from '../../../../../lib/words/deal';
import * as rewind from '../../../../../lib/words/rewind';
import * as rules from '../../../../../lib/words/rules';
import * as safety from '../../../../../lib/words/safety';
import * as settings from '../../../../../lib/words/settings';

/** Every string in a words module, with functions called on sample arguments. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (typeof v === 'function') {
    try { strings((v as (...a: unknown[]) => unknown)('3', 3, '2 Nov'), out); } catch { /* a words function needs other arguments */ }
  } else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}

const AREAS = { connections, deal, rewind, rules, safety, settings };

const withoutEngineIds = (s: string): string => s.replace(/\b(claude-code|codex-cli)\b/g, '');

/** The Charter's sources: the setup sheet and the console layer that hosts it. */
const CHARTER_SOURCES = ['../../../setup/Charter.tsx', '../setup/SetupLayer.tsx'];
/** Every export of lib/words.ts the Charter's sources import, by name. */
function charterWords(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const rel of CHARTER_SOURCES) {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(?:\.\.\/)+lib\/words'/g)) {
      for (const name of m[1]!.split(',').map((n) => n.replace(/^\s*type\s+/, '').trim()).filter(Boolean)) {
        expect(name in words, `${rel} imports ${name} from lib/words`).toBe(true);
        out[name] = (words as Record<string, unknown>)[name];
      }
    }
  }
  return out;
}
const VENDOR = /\b(claude|anthropic|openai|codex|gpt|chatgpt|gemini|copilot)\b/i;
const INTERNAL = /\b(clause \d|§|mandate_|deal_|approval_open|settings_write|engine_select|keyring|rust|ipc|hash chain|enum)\b|[A-Z]{3,}_[A-Z]{2,}/i;

describe('WP3c words', () => {
  for (const [area, mod] of Object.entries(AREAS)) {
    it(`${area}: no vendor name but PayPal, no internals`, () => {
      const all = strings(mod);
      expect(all.length).toBeGreaterThan(5);
      expect(all.filter((s) => VENDOR.test(s))).toEqual([]);
      expect(all.filter((s) => INTERNAL.test(s))).toEqual([]);
    });
  }
  // The Charter (the first screen a new owner sees) takes its words from lib/words.ts, not from an
  // area file: the words it imports are read from its own source, so a string it starts to show is
  // guarded the day it is imported.
  // Its agent-app line names the two engines by their product ids, which UX-GUIDE keeps as values
  // ("engine (claude-code, codex-cli) | agent app; keep the product id as the value"); a vendor
  // or product name anywhere else is still refused.
  it('the Charter: no vendor name but PayPal, no internals', () => {
    const all = strings(charterWords());
    expect(all.length).toBeGreaterThan(20);
    expect(all.filter((s) => VENDOR.test(withoutEngineIds(s)))).toEqual([]);
    expect(all.filter((s) => INTERNAL.test(s))).toEqual([]);
  });
  it('every needs-you line says what happens if the owner does nothing', () => {
    expect(settings.SETTINGS_IF.firstRun).toMatch(/no money moves/);
    expect(connections.CONNECTIONS_ANSWER.ifNoKey).toMatch(/PayPal is never called/);
    expect(rules.RULES_IF.none).toMatch(/PayPal is never asked/);
    expect(safety.SAFETY_FOUND.ifNothing).toMatch(/nothing moves/);
  });
});
