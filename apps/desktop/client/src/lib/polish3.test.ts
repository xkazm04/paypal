// Polish 3: the wording fixes on surfaces that landed after polish 2 (docs/ux/UX-GUIDE.md).
// Each test pins one defect from the coordinator's sweep so it cannot come back.
import { describe, expect, it } from 'vitest';
import type { Clause } from '@bindings/Clause';
import type { Deal } from '@bindings/Deal';
import { buildMockState } from '../mock/fixtures';
import { cardQuestion } from '../windows/tumbler/logic';
import { decisionLine } from '../windows/main/deal/model';
import { atRiskOf, isFailing } from '../windows/main/modules/rescue/model';
import { dealTotal, summarize } from '../windows/main/logic';
import { heldAtPayPal, heldLine } from '../windows/main/home/model';
import { sums } from '../windows/main/modules/book/model';
import { houseName } from './display';
import { CHECK_QUIET, heldWords, houseWords, itemWords, notOfferedLine, NOT_REPORTED, ruleSentence } from './words';

const NOW = 1_800_000_000;

describe('the house seller is a name, never a shout', () => {
  it('one helper turns the payee "HOUSE" and the name "HOUSE seller" into "House seller"', () => {
    expect(houseWords('HOUSE')).toBe('House seller');
    expect(houseWords('HOUSE seller')).toBe('House seller');
    expect(houseWords('north-desk')).toBe('north-desk');
    expect(houseWords('housewares')).toBe('housewares');
    // display.ts keeps its old name, routed through the same helper
    expect(houseName('HOUSE seller')).toBe('House seller');
  });
  it('the payees rule sentence never shows HOUSE (Spend, Agent rules, the deal page)', () => {
    const c: Clause = { type: 'payees', payees: ['packrite-supply', 'cablehaus', 'north-desk', 'HOUSE', 'partsco', 'pixel-bay'] };
    expect(ruleSentence(c)).toBe('only packrite-supply, cablehaus, north-desk, House seller, partsco and pixel-bay');
  });
  it('every mock rule sentence, the Tumbler question and the deal line are free of HOUSE', () => {
    const world = buildMockState(NOW);
    for (const m of world.mandates) for (const c of m.payload.clauses) expect(ruleSentence(c)).not.toMatch(/\bHOUSE\b/);
    const item = { headline: 'Countersign $329.00', amount_minor: 32900, currency: 'USD' as const, kind: 'gate' as const, counterparty: 'HOUSE seller' };
    const q = cardQuestion(item);
    expect(`${q.lead}${q.amount ?? ''}${q.tail}`).toContain('with House seller');
    const line = decisionLine({ state: 'AGREED', kind: 'haggle', shield: null }, { headline: 'Countersign $329.00', clause: null, counterparty: 'HOUSE seller' }, false);
    expect(line.t2).toBe('House seller');
  });
});

describe('Book: what is on hold, said as a sentence', () => {
  it('both directions: one sentence with "going out" and "coming in", plural verb', () => {
    expect(heldWords('$64.00', '$118.00')).toBe('$64.00 going out and $118.00 coming in are on hold at PayPal, not paid yet.');
  });
  it('one direction keeps the singular form; nothing held says nothing', () => {
    expect(heldWords('$64.00', '')).toBe('$64.00 is on hold at PayPal, not paid yet.');
    expect(heldWords('', '$118.00')).toBe('$118.00 is on hold at PayPal, not paid yet.');
    expect(heldWords('', '')).toBeNull();
  });
});

describe('Book and Rescue agree on a failed renewal’s amount', () => {
  it('the mock’s failing renewal shows the missed cycle ($12.00), not the $9.60 invoice', () => {
    const world = buildMockState(NOW);
    const cases = Object.values(world.rescue ?? {});
    const failing = world.deals.map((d) => d.deal).filter((d: Deal) => isFailing(d));
    expect(failing.length).toBeGreaterThan(0);
    for (const d of failing) {
      const risk = atRiskOf(d, { cases });
      const view = cases.find((v) => v.deal_id === d.id);
      expect(risk).toEqual(view?.offer.cycle);
      expect(risk.minor).toBeGreaterThan(dealTotal(d).minor);
    }
  });
});

describe('Home and Book agree on what is on hold', () => {
  it('Home counts PayPal holds per direction, as Book’s tile does; a paused payment is not on hold at PayPal', () => {
    const deals = buildMockState(NOW).deals.map((d) => d.deal);
    const s = summarize(deals, new Set());
    const home = heldAtPayPal(s.held);
    const book = sums(deals).held;
    expect(home.out).toEqual(book.out);
    expect(home.inn).toEqual(book.in);
    expect(home.deals.every((d) => d.state === 'AUTHORIZED')).toBe(true);
    expect(s.held.some((d) => d.shield === 'HOLD' && d.state !== 'AUTHORIZED')).toBe(true); // D-0198 stays on the dial and under Needs you
    expect(heldLine(home)).toBe('$64.00 out · $118.00 in');
    expect(heldLine({ out: [], inn: [] })).toBe('nothing');
  });
});

describe('Home and Book agree on a payment being checked with PayPal', () => {
  it('a deal whose capture is being checked is on hold in neither: D-0194 leaves, D-0190 stays', () => {
    const mock = buildMockState(NOW).deals;
    const deals = mock.map((d) => d.deal);
    const ids = new Set(mock.filter((d) => d.evidence.money_check).map((d) => d.deal.id));
    expect(mock.find((d) => d.display.label === 'D-0194')?.evidence.money_check).toBeTruthy();
    const home = heldAtPayPal(summarize(deals, new Set()).held, ids);
    const book = sums(deals, (d) => ids.has(d.id)).held;
    expect(home.out).toEqual(book.out);
    expect(home.inn).toEqual(book.in);
    expect(heldLine(home)).toBe('$64.00 out');
  });
});

describe('Rescue: the fixes a renewal can’t have, in one line', () => {
  it('names them in the cards’ own words, lower-cased, joined', () => {
    expect(notOfferedLine(['Pause for a while', 'Retry later', 'Smaller plan'])).toBe('Not offered for this renewal: pause for a while, retry later and smaller plan.');
    expect(notOfferedLine(['Retry later'])).toBe('Not offered for this renewal: retry later.');
  });
});

describe('Shield: a check with no result here reads calmly, never as a pass', () => {
  it('short labels, each with the honest detail behind it', () => {
    expect(Object.values(CHECK_QUIET).map((q) => q.text)).toEqual(['No alert', 'Didn’t stop it', 'Not reported']);
    for (const q of Object.values(CHECK_QUIET)) {
      expect(q.text.split(' ').length).toBeLessThanOrEqual(3);
      expect(q.means).toMatch(/isn’t marked as passed/);
      expect(q.text + q.means).not.toMatch(/shown here|window|projected/i);
    }
    expect(NOT_REPORTED.text).toBe('not reported');
  });
});

describe('Counter: an item known only by its code reads as a plain name', () => {
  it('humanises the code from the shop rules', () => {
    expect(itemWords('dp-cable-2m')).toBe('DP cable 2m');
    expect(itemWords('hdmi-21')).toBe('HDMI 21');
    expect(itemWords('wipe-kit')).toBe('Wipe kit');
    expect(itemWords('monitor-27-4k')).toBe('Monitor 27 4K');
    expect(itemWords('usb_c_dock')).toBe('USB c dock');
    expect(itemWords('')).toBe('Item');
  });
});
