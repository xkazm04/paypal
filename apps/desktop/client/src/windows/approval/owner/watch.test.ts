import { describe, expect, it } from 'vitest';
import type { RescueWatchView } from '@bindings/RescueWatchView';
import { RESCUE_WATCH_STATE, watchingWords } from '../../../lib/words';
import { buildWatch, nextCheckWords, WATCH_MAX } from './watch';

const view = (id: string): RescueWatchView => ({ subscription_id: id, recipient: 's•••@example.com', plan: 'care-plan', state: 'paid', added_at: 0, last_read_at: 0, next_read_at: 0 });

describe('watching subscriptions', () => {
  it('builds the watch from the owner’s entry, trimmed, and names each problem in plain words', () => {
    expect(buildWatch({ subscription: ' I-BW452GLLEP1G ', email: ' sam@example.com', plan: 'care-plan ' }, [])).toEqual({
      ok: true, args: { subscription_id: 'I-BW452GLLEP1G', subscriber_email: 'sam@example.com', plan: 'care-plan' },
    });
    const bad = buildWatch({ subscription: 'I BW', email: 'sam', plan: 'care plan' }, []);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems).toHaveLength(3);
  });
  it('stops at twenty watched, but a watched one may be changed', () => {
    const full = Array.from({ length: WATCH_MAX }, (_, i) => view(`I-${i}`));
    expect(buildWatch({ subscription: 'I-NEW', email: 'sam@example.com', plan: 'care-plan' }, full).ok).toBe(false);
    expect(buildWatch({ subscription: 'I-3', email: 'sam@example.com', plan: 'gold' }, full).ok).toBe(true);
  });
  it('says how many are watched and when each is checked next, never naming internals', () => {
    expect(watchingWords(0)).toBe('Not watching any subscriptions yet');
    expect(watchingWords(1)).toBe('Watching 1 subscription');
    expect(watchingWords(2)).toBe('Watching 2 subscriptions');
    expect(nextCheckWords({ next_read_at: 1000 }, 990)).toBe('checked again soon');
    expect(nextCheckWords({ next_read_at: 1000 + 4 * 3600 + 30 }, 1000)).toBe('checked again in 4 h');
    expect(nextCheckWords({ next_read_at: 1000 + 600 }, 1000)).toBe('checked again in 10 min');
    for (const s of Object.values(RESCUE_WATCH_STATE)) expect(`${s.text} ${s.means}`).not.toMatch(/Rust|clause \d|_list|_query|subscription_id|GET|API/);
  });
});
