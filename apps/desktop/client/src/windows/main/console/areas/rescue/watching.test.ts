// The Watching view and its card say "checked with PayPal every few hours" only while the wallet is
// checking. Rust stops the watch pass on one hold, the same for every watch (Runtime::
// rescue_watch_hold: agents paused, PayPal not connected, no rescue rules, no agent key), and reads
// nothing more once the day's reads are used up (reserve_rescue_watch_read, until the next UTC day).
import { describe, expect, it } from 'vitest';
import type { RescueBook } from '@bindings/RescueBook';
import type { RescueWatchView } from '@bindings/RescueWatchView';
import { clockLabel } from '../../../../../lib/format';
import { RESCUE, RESCUE_WATCH_HOLD } from '../../../../../lib/words';
import { watchStatus } from '../../../modules/rescue/model';
import { watchLines } from './RescueLayer';

const DAY = 86400;
const NOW = 20_000 * DAY + 15 * 3600; // 15:00 UTC
const watch = (o: Partial<RescueWatchView> = {}): RescueWatchView => ({
  subscription_id: 'I-AAA', recipient: 's•••@example.com', plan: 'care-plan' as RescueWatchView['plan'], state: 'paid', added_at: 1, next_read_at: NOW + 3600, ...o,
});
const book = (watching: RescueWatchView[], today = 3, max = 100): Pick<RescueBook, 'watching' | 'watch_reads_today' | 'watch_reads_max'> => ({ watching, watch_reads_today: today, watch_reads_max: max });

describe('what the Watching view says about checking', () => {
  it('a hold says why nothing is checked, never “checked every few hours”', () => {
    const b = book([watch({ held: 'paused' }), watch({ subscription_id: 'I-BBB', state: 'fix_opened', held: 'paused' })]);
    expect(watchStatus(b, NOW)).toEqual({ kind: 'held', held: 'paused' });
    const w = watchLines(b, NOW);
    expect(w.line).toBe(RESCUE_WATCH_HOLD.paused);
    expect(w.note).toBe(RESCUE_WATCH_HOLD.paused);
    expect(`${w.line} ${w.note}`).not.toMatch(/every few hours|checks today/);
  });

  it('with today’s checks used up, says nothing is checked until the next day’s checks', () => {
    const b = book([watch()], 100, 100);
    const resumes = 20_001 * DAY;
    expect(watchStatus(b, NOW)).toEqual({ kind: 'spent', resumes });
    const w = watchLines(b, NOW);
    expect(w.line).toBe(RESCUE.watch.spent(clockLabel(resumes, NOW)));
    expect(w.line).not.toMatch(/every few hours/);
  });

  it('while checking, says so with today’s count (unchanged)', () => {
    expect(watchLines(book([watch()]), NOW)).toEqual({ line: RESCUE.watch.checked, note: RESCUE.watch.reads(3, 100) });
    expect(watchLines(book([watch({ state: 'failed_no_fix' })]), NOW).line).toBe(RESCUE.watch.failing(1));
    expect(watchLines(book([]), NOW)).toEqual({ line: RESCUE.watch.none, note: RESCUE.cards.watchNote });
  });
});
