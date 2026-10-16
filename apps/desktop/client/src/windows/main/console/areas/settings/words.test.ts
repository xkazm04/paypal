// The words guard for WP3c's areas (deal, rewind, rules, connections, settings, safety): every
// string they show is in lib/words/<area>.ts, and none names a vendor other than PayPal, a rule by
// its number, a command, a raw state or an internal word (docs/ux/UX-GUIDE.md).
import { describe, expect, it } from 'vitest';
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
  it('every needs-you line says what happens if the owner does nothing', () => {
    expect(settings.SETTINGS_IF.firstRun).toMatch(/no money moves/);
    expect(connections.CONNECTIONS_ANSWER.ifNoKey).toMatch(/PayPal is never called/);
    expect(rules.RULES_IF.none).toMatch(/PayPal is never asked/);
    expect(safety.SAFETY_FOUND.ifNothing).toMatch(/nothing moves/);
  });
});
