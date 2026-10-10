// T10: a payment step whose PayPal answer was lost is shown honestly on every surface (never
// "paid", never "failed"), the card only opens the deal, and the mock refuses what Rust refuses.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockBackend, resetMockState } from '../mock/backend';
import { buildMockState, fakeUlid } from '../mock/fixtures';
import { dealAnswer } from '../windows/main/deal/story';
import { mayWithdraw } from '../windows/main/deal/model';
import { cardActions, cardClock, cardWhy, stateChip } from '../windows/tumbler/logic';
import { MONEY_CHECK_ENDED, MONEY_CHECK_ENDED_SILENCE, MONEY_CHECK_PARKED, MONEY_CHECK_SILENCE, moneyCheckWord, silenceWords } from './words';

const NOW = 1_800_000_000;
const world = buildMockState(NOW);
const parked = world.deals.find((d) => d.display.label === 'D-0194')!;

describe('a payment being checked with PayPal', () => {
  it('the fixture mirrors Rust: a HOLD card with one way out, the same silence line, evidence that says so', () => {
    const item = parked.attention!;
    expect(item.kind).toBe('hold');
    expect(item.actions).toEqual(['open_in_table']);
    expect(item.money_check).toEqual(parked.evidence.money_check);
    expect(item.on_silence).toBe(MONEY_CHECK_SILENCE);
    expect(silenceWords(item.on_silence)).toBe(MONEY_CHECK_SILENCE);
    expect(parked.evidence.money_check?.state).toBe('parked');
  });

  it('the Tumbler says checking, never paused for a decision, and offers no withdraw or review', () => {
    const item = parked.attention!;
    expect(stateChip(item, false)).toEqual({ tone: 'coral', text: 'Checking' });
    expect(cardActions(item, NOW).map((a) => a.action)).toEqual(['open_in_table']);
    const [why, silence] = cardWhy(item);
    expect(why).toBe(MONEY_CHECK_PARKED);
    expect(silence).toBe(`If you do nothing, ${MONEY_CHECK_SILENCE}.`);
    expect(cardClock({ ...item, deadline: null }, NOW).text).toBe('checking with PayPal');
  });

  it('the deal page answers with the parked sentence and never offers to walk away', () => {
    const a = dealAnswer(parked.deal, { need: parked.attention ?? undefined, them: 'lark', latest: null, band: null, mayWithdraw: false, check: parked.evidence.money_check });
    expect(a.title).toBe(MONEY_CHECK_PARKED);
    expect(a.title.replace(/stays paid|paid first/g, '')).not.toMatch(/paid|failed/i);
    expect(a.sub).toMatch(/not paid and not failed/);
    expect(mayWithdraw({ ...parked.deal, kind: 'haggle' }, parked.attention ?? undefined)).toBe(false);
  });

  it('words: the same pill for both states, the parked one with the fixed sentence', () => {
    const check = parked.evidence.money_check!;
    expect(moneyCheckWord(check)).toEqual({ text: 'Checking with PayPal', means: MONEY_CHECK_PARKED });
    const checking = moneyCheckWord({ ...check, state: 'checking', step: 'create' });
    expect(checking.text).toBe('Checking with PayPal');
    expect(checking.means).toMatch(/payment request/);
    for (const s of [MONEY_CHECK_PARKED, checking.means, MONEY_CHECK_SILENCE, MONEY_CHECK_ENDED, MONEY_CHECK_ENDED_SILENCE]) expect(s).not.toMatch(/capture|void|authoriz|request id|Rust|unknown/i);
  });
});

describe('mock parity: Rust keeps a deal reserved while PayPal is being asked', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW * 1000);
    localStorage.clear(); sessionStorage.clear(); resetMockState();
    history.replaceState(null, '', '/index.html');
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('withdraw is refused and the deal stays as it was; the evidence carries the check', async () => {
    const main = mockBackend('main');
    const id = fakeUlid('D-0194');
    await expect(main.invoke('deal_withdraw', { deal_id: id })).rejects.toMatchObject({ code: 'PERMISSION' });
    expect((await main.invoke('get_deal', { deal_id: id })).state).toBe('AUTHORIZED');
    const ev = await main.invoke('deal_evidence', { deal_id: id });
    expect(ev.money_check).toMatchObject({ step: 'capture', state: 'parked' });
    const items = (await main.invoke('attention_list', null)).items;
    expect(items.find((i) => i.deal_id === id)?.money_check?.state).toBe('parked');
  });
});

describe('the parked words promise only what the wallet does', () => {
  it('say the deadline read-back, that PayPal’s answer decides and a payment it took stays paid, and promise no retry', () => {
    for (const s of [MONEY_CHECK_PARKED, MONEY_CHECK_SILENCE]) {
      expect(s).toMatch(/at the deadline/i);
      expect(s).toMatch(/what PayPal shows decides/);
      expect(s).toMatch(/a payment PayPal already took stays paid/i);
      expect(s).not.toMatch(/keeps asking|until we can|nothing more/i);
      // A hold PayPal shows may still be paid (by the owner, or a sale delivered at once):
      // nothing promises that nothing is collected.
      expect(s).not.toMatch(/nothing is collected|collects nothing/i);
    }
  });

  it('promise a release only where the wallet releases: at the hold’s own deadline, unless it is paid first', () => {
    expect(MONEY_CHECK_PARKED).toMatch(/released at its own deadline, unless it is paid first/);
    expect(MONEY_CHECK_PARKED).toMatch(/a sale delivered at once/);
    expect(MONEY_CHECK_SILENCE).not.toMatch(/release/i);
    const a = dealAnswer(parked.deal, { need: parked.attention ?? undefined, them: 'lark', latest: null, band: null, mayWithdraw: false, check: parked.evidence.money_check });
    expect(a.sub).not.toMatch(/release/i);
    expect(a.sub).toMatch(/what PayPal shows decides/);
  });
});

describe('a deal that ended before PayPal showed what happened to its payment', () => {
  const check = { step: 'authorize', state: 'parked', since: NOW - 72 * 3600, next_check: null } as const;

  it('the deal page says what PayPal could not show and what to do, never that no money moved', () => {
    const a = dealAnswer({ ...parked.deal, state: 'EXPIRED' }, { need: undefined, them: 'lark', latest: null, band: null, mayWithdraw: false, check });
    expect(a.title).toBe(MONEY_CHECK_ENDED);
    expect(a.title).toMatch(/look at the payment in PayPal/i);
    expect(a.title).toMatch(/sends nothing more/);
    expect(`${a.title} ${a.sub}`).not.toMatch(/no money moved|released|paid/i);
  });

  it('the card says the wallet stopped and what to do, with the line Rust sends', () => {
    const item = { ...parked.attention!, deadline: null, headline: 'Look at $118.00 in PayPal', on_silence: MONEY_CHECK_ENDED_SILENCE, money_check: check };
    const [, silence] = cardWhy(item);
    expect(silenceWords(item.on_silence)).toBe(MONEY_CHECK_ENDED_SILENCE);
    expect(silence).toBe(`If you do nothing, ${MONEY_CHECK_ENDED_SILENCE}.`);
    expect(MONEY_CHECK_ENDED_SILENCE).toMatch(/look at this payment in PayPal/);
    expect(MONEY_CHECK_ENDED_SILENCE).not.toMatch(/at the deadline|asks PayPal/);
  });
});
