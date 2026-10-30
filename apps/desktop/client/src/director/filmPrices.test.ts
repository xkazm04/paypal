// The films' narration can only say a price its beat's table shows: every spoken dollar figure in
// film/*/film.json is parsed from words ("three twenty-nine") and must be on the table the director
// puts on screen for that beat (beats.ts, same beat ids), as far as the director has rewound it, or one
// of the signed limits that table runs under. Dan's table (D-0193) and the house seller's (D-0204) are
// the engine's recording (mock/haggle.json); a figure from another beat's table, or from the house
// table on a beat that shows only Dan's, fails here. The sequencing doc's "the film's prices fail the
// engine" (2026-10-29) cannot come back unnoticed.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildMockState } from '../mock/fixtures';
import { DAN_LABEL, RECORDED } from '../mock/haggle';
import { BEATS } from './beats';
import { HAGGLE, MISMATCH } from './helpers';
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

/** The preview's sample world, whose tables the director's beats show. */
const WORLD = buildMockState(1_800_000_000);
const table = (label: string): number[] => {
  const d = WORLD.deals.find((x) => x.display.label === label);
  if (!d) throw new Error(`the sample world has no ${label}`);
  return d.transcript.flatMap((t) => (t.price ? [t.price.minor / 100] : []));
};
/** The house seller's table as the story opens (D-0204: the recording's first signed steps). */
const HOUSE_TABLE = 'D-0204';
/** How far the director has rewound Dan's table when a beat plays: the last rewind of it up to and
 *  including that beat (every story starts by rewinding it). */
function danCut(beatId: string): number {
  let upTo = Number.MAX_SAFE_INTEGER;
  for (const b of BEATS) {
    for (const a of b.do) if (a.do === 'rewind' && a.deal === HAGGLE) upTo = a.upTo;
    if (b.id === beatId) break;
  }
  return upTo;
}
/** The figures a beat may say: the tables its chapter shows, cut where the director has them, and the
 *  limits Maya signed for those tables. A beat the director does not play shows no table. */
function shownAt(beatId: string): Set<number> {
  const beat = BEATS.find((b) => b.id === beatId);
  const out = new Set<number>();
  const add = (xs: readonly number[]) => xs.forEach((x) => out.add(x));
  const limits = (rules: typeof RECORDED.dan.rules) => add([rules.ceiling / 100, rules.ask_above / 100]);
  const dan = () => {
    const cut = danCut(beatId);
    add(table(DAN_LABEL).slice(0, cut));
    limits(RECORDED.dan.rules);
  };
  switch (beat?.chapter) {
    case 'shop': dan(); add(table(HOUSE_TABLE)); limits(RECORDED.house.rules); break;
    case 'haggle': case 'silence': dan(); break;
    // A typed sample deal, not a recorded table (see the report's counter-proposal): its own transcript.
    case 'mismatch': add(table(MISMATCH)); break;
    default: break;
  }
  return out;
}

describe('the films say only the prices their beat shows', () => {
  it('reads a price the way a narrator says it', () => {
    expect(spokenPrices('Her signed rules: three hundred forty, tops. Dan asks three forty.')).toEqual([340, 340]);
    expect(spokenPrices('Dan counters at three twenty-nine. Above two fifty, her rule says: ask me.')).toEqual([329, 250]);
    expect(spokenPrices('Three windows: The Table, the Tumbler')).toEqual([]);
  });

  it('cuts each table where the director has it: Dan’s last counter is not on screen before the gate', () => {
    const last = RECORDED.dan.outcome.price / 100;
    expect(shownAt('haggle-open').has(last)).toBe(false);
    expect(shownAt('haggle-gate').has(last)).toBe(true);
    // the house seller's prices belong to the shop-around beats only
    expect(shownAt('shop-prices').has(HAGGLE_FIGS.houseNow)).toBe(true);
    expect(shownAt('haggle-gate').has(HAGGLE_FIGS.houseNow)).toBe(table(DAN_LABEL).includes(HAGGLE_FIGS.houseNow));
    expect(shownAt('open').size).toBe(0);
  });

  it('every spoken price in film/*/film.json is on its beat’s table or one of its signed limits', () => {
    let said = 0;
    for (const file of FILMS) {
      if (!existsSync(file)) continue;
      const film = JSON.parse(readFileSync(file, 'utf8')) as { beats: { id: string; line?: string }[] };
      for (const beat of film.beats) {
        const allowed = shownAt(beat.id);
        for (const price of spokenPrices(beat.line ?? '')) {
          said += 1;
          expect(allowed.has(price), `${file} beat ${beat.id} says ${price}, which its table does not show (${[...allowed].join(', ')})`).toBe(true);
        }
      }
    }
    expect(said).toBeGreaterThan(0);
  });
});
