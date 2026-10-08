// T9: the house seller's signed record kept with a receipt. Evidence only: a warning on the deal
// says what changed in plain words and never offers, or implies, a money action.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { HouseRecord } from '@bindings/HouseRecord';
import type { HouseRecordState } from '@bindings/HouseRecordState';
import { buildMockState } from '../mock/fixtures';
import { ProofPanel } from '../windows/main/deal/Evidence';
import { HOUSE_RECORD_NAME, HOUSE_RECORD_SHORTER, houseRecordWord } from './words';

const NOW = 1_800_000_000;
const world = buildMockState(NOW);
const house = world.deals.find((d) => d.display.label === 'D-0201')!;
const record = (state: HouseRecordState): HouseRecord => ({ state, kept_at: NOW - 3600, entries: 412, checked_at: NOW - 60 });
const STATES: HouseRecordState[] = ['kept', 'holds', 'longer', 'restarted', 'shorter', 'rewritten'];

describe('the house seller’s record kept with a receipt', () => {
  afterEach(cleanup);

  it('warns only when the record restarted, shrank or changed, in plain words', () => {
    expect(STATES.filter((s) => houseRecordWord(record(s)).warns)).toEqual(['restarted', 'shorter', 'rewritten']);
    expect(houseRecordWord(record('shorter')).means).toContain(HOUSE_RECORD_SHORTER);
    for (const s of STATES) {
      const w = houseRecordWord(record(s));
      expect(w.text + w.means).not.toMatch(/\b(HOUSE|epoch|hash|head|audit|rows?|prefix|Rust)\b/);
      // Never green for a warning, never a money action.
      if (w.warns) expect(w.tone).not.toBe('ok');
      expect(w.means).not.toMatch(/refund|cancel|release the hold|pay now/i);
    }
  });

  it('the deal’s proof shows the record, with a red edge when it got shorter, and nothing for other deals', () => {
    const deal = { ...house.deal, state: 'RECEIPTED' as const };
    const evidence = { ...house.evidence, receipt: 'PAYPAL_VERIFIED' as const, house_record: record('shorter') };
    const shown = render(<ProofPanel deal={deal} ev={{ data: evidence, error: null }} band={null} onOpen={() => {}} />);
    const card = shown.container.querySelector('.dv-pc-wide');
    expect(card?.textContent).toContain(HOUSE_RECORD_NAME);
    expect(card?.textContent).toContain(HOUSE_RECORD_SHORTER);
    expect(card?.classList.contains('warn')).toBe(true);
    cleanup();
    const calm = render(<ProofPanel deal={deal} ev={{ data: { ...evidence, house_record: record('holds') }, error: null }} band={null} onOpen={() => {}} />);
    expect(calm.container.querySelector('.dv-pc-wide.warn')).toBeNull();
    expect(calm.container.textContent).toContain('Still matches');
    cleanup();
    const none = render(<ProofPanel deal={deal} ev={{ data: house.evidence, error: null }} band={null} onOpen={() => {}} />);
    expect(none.container.querySelector('.dv-pc-wide')).toBeNull();
    expect(house.evidence.house_record).toBeNull();
  });
});
