// The films' narration can only say a price the engine signed (or a signed rule's): every spoken
// dollar figure in film/*/film.json is parsed from words ("three twenty-nine") and must be one of the
// recorded haggle's figures (mock/haggle.json, through director/recorded.ts) or Maya's limits. The
// sequencing doc's "the film's prices fail the engine" (2026-10-29) cannot come back unnoticed.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RECORDED } from '../mock/haggle';
import { HAGGLE_FIGS } from './recorded';

const FILMS = ['haggle', 'hero'].map((f) => join(__dirname, '..', '..', '..', '..', '..', 'film', f, 'film.json'));

const ONES: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS: Record<string, number> = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ones = Object.keys(ONES).join('|');
const tens = Object.keys(TENS).join('|');
const teens = Object.keys(TEENS).join('|');
/** "three forty", "three hundred forty", "three twenty-nine", "two fifty", "three oh five": a price said the way a narrator says one. */
const PRICE = new RegExp(`\\b(${ones})(?: hundred(?: and)?)? (?:(${tens})(?:-(${ones}))?|(${teens})|oh (${ones}))\\b`, 'gi');

/** The dollar figures a line says out loud. */
function spokenPrices(line: string): number[] {
  return [...line.matchAll(PRICE)].map((m) => {
    const lower = (s: string | undefined) => (s ?? '').toLowerCase();
    const hundreds = (ONES[lower(m[1])] ?? 0) * 100;
    const rest = m[2] ? (TENS[lower(m[2])] ?? 0) + (ONES[lower(m[3])] ?? 0) : m[4] ? (TEENS[lower(m[4])] ?? 0) : (ONES[lower(m[5])] ?? 0);
    return hundreds + rest;
  });
}

describe('the films say only signed prices', () => {
  it('reads a price the way a narrator says it', () => {
    expect(spokenPrices('Her signed rules: three hundred forty, tops. Dan asks three forty.')).toEqual([340, 340]);
    expect(spokenPrices('Dan counters at three twenty-nine. Above two fifty, her rule says: ask me.')).toEqual([329, 250]);
    expect(spokenPrices('Three windows: The Table, the Tumbler')).toEqual([]);
  });

  it('every spoken price in film/*/film.json is the recording’s or a signed limit', () => {
    const allowed = new Set<number>([
      ...Object.values(HAGGLE_FIGS),
      RECORDED.dan.rules.ceiling / 100,
      RECORDED.dan.rules.ask_above / 100,
      ...RECORDED.dan.steps.map((s) => s.price / 100),
      ...RECORDED.house.steps.map((s) => s.price / 100),
    ]);
    let said = 0;
    for (const file of FILMS) {
      if (!existsSync(file)) continue;
      const film = JSON.parse(readFileSync(file, 'utf8')) as { beats: { id: string; line?: string }[] };
      for (const beat of film.beats) {
        for (const price of spokenPrices(beat.line ?? '')) {
          said += 1;
          expect(allowed.has(price), `${file} beat ${beat.id} says ${price}, which the engine never signed`).toBe(true);
        }
      }
    }
    expect(said).toBeGreaterThan(0);
  });
});
