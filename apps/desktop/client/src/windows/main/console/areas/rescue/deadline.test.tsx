// A failed renewal's panel tells PayPal's retry and the fix's deadline apart. Rust opens every fix
// with a deadline: PayPal's next retry when the failure carries one, else a 5-day window of the
// wallet's own (table-app rescue.rs RESCUE_RETRY_DEFAULT_SECS); at that deadline an unapproved fix
// lapses and nothing is sent (deal.rs Agreed + Deadline -> Withdrawn). Only RescueView.next_retry_at
// is PayPal's, so only it may be shown as "PayPal retries ...".
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import type { RescueView } from '@bindings/RescueView';
import { clockLabel, nowUnix } from '../../../../../lib/format';
import { RESCUE } from '../../../../../lib/words';
import { invoiceText, proposeDiscount } from '../../../../../mock/rescue';
import { splitRows } from '../../../modules/rescue/model';
import { fixWhy, previewFor } from '../../../modules/rescue/preview';
import { FixPanel, type RescueWorld } from './parts';
import { answerOf } from './RescueLayer';

afterEach(cleanup);

const DAY = 86400;
const H = Array.from({ length: 32 }, () => 0) as unknown as Deal['transcript_head'];
const deal = (o: Partial<Deal> = {}): Deal => ({
  id: 'R-1', kind: 'rescue', side: 'seller', counterparty: 'sub:I-1', state: 'AGREED', mode: 'sandbox', mandate_id: 'M', mandate_version: 1, transcript_head: H,
  terms: { item_ref: 'care-plan', qty: 1, unit_price: { minor: 960, currency: 'USD' }, currency: 'USD', delivery: { type: 'ship_then_capture', days: 0 } },
  paypal: { order: null, authorization: null, capture: null, subscription: 'I-1' }, market: null, shield: null, ...o,
});
const offer = proposeDiscount({ minor: 1200, currency: 'USD' }, { max_discount_bp: 2000, max_discount: { minor: 500, currency: 'USD' } })!;
const view = (o: Partial<RescueView> = {}): RescueView => ({ deal_id: 'R-1', source: 'paypal', offer, text: invoiceText(offer), failed_payments: 1, next_retry_at: null, recipient: 's•••@example.com', counted: false, ...o });

function world(d: Deal, v: RescueView, deadline: number): RescueWorld {
  return {
    loaded: true, error: null, all: [d], rows: splitRows([d], () => deadline), book: { cases: [v], recovered: [], watching: [], watch_reads_today: 0, watch_reads_max: 100 }, bookError: null,
    need: () => undefined, deadline: () => deadline, name: () => 'subscriber I-1', title: () => 'Care plan', view: () => v,
  };
}
const panel = (d: Deal, v: RescueView, deadline: number) =>
  render(<FixPanel deal={d} r={world(d, v, deadline)} col="NONE" onPick={() => {}} onDeal={() => {}} />).container;

describe('a failed renewal’s retry and deadline', () => {
  it('without PayPal’s retry time, shows no PayPal retry date, only when the fix closes', () => {
    const due = nowUnix() + 5 * DAY;
    const c = panel(deal(), view(), due);
    const text = c.textContent ?? '';
    expect(text).not.toMatch(/PayPal retries in/);
    expect(c.querySelector('[data-col="NONE"]')?.textContent).toContain(RESCUE.retriesOwn);
    expect(c.querySelector('.rs-close')?.textContent).toContain(clockLabel(due));
    expect(c.querySelector('.rs-close')?.textContent).toContain('closes and nothing is sent');
  });

  it('with PayPal’s retry time, the retry is PayPal’s and the deadline stays the fix’s', () => {
    const now = nowUnix();
    const due = now + 5 * DAY;
    const c = panel(deal(), view({ next_retry_at: now + 2 * DAY + 3600 }), due);
    expect(c.querySelector('[data-col="NONE"]')?.textContent).toContain('PayPal retries in 2 days');
    expect(c.querySelector('.rs-close')?.textContent).toContain(clockLabel(due));
  });
});

// A replayed failure (D-0188 in the sample world) is one the owner recorded because PayPal can't fail
// a test renewal: there is no failed payment at PayPal, and Rust records no retry for it (table-app
// rescue.rs, rescue_replay). Nothing on the screen may promise that PayPal retries it.
describe('a replayed failure', () => {
  const replayDeal = deal({ mode: 'replay' });
  // The sample world gives D-0188 a retry date; Rust never does for a replay. Either way none is shown.
  const replayView = view({ source: 'replay', next_retry_at: nowUnix() + 4 * DAY });

  it('promises no PayPal retry on its panel', () => {
    const c = panel(replayDeal, replayView, nowUnix() + 5 * DAY);
    expect(c.textContent).not.toMatch(/PayPal retries/);
    expect(c.querySelector('[data-col="NONE"]')?.textContent).toContain(RESCUE.replayNoRetry);
    expect(c.querySelector('.rs-sil')?.textContent).toContain(RESCUE.replaySilence);
  });

  it('says on the summary that doing nothing sends nothing, not that PayPal retries', () => {
    const due = nowUnix() + 5 * DAY;
    expect(answerOf(world(replayDeal, replayView, due)).sub).toBe(RESCUE.answer.replay);
    expect(answerOf(world(deal(), view(), due)).sub).toBe(RESCUE.answer.retries);
  });

  it('its preview and Why? name no PayPal retry', () => {
    const amount = { minor: 1200, currency: 'USD' as const };
    expect(previewFor('NONE', { item: 'care-plan', amount, retryAt: null, replay: true }).line).not.toMatch(/PayPal retries/);
    expect(fixWhy('NONE', { amount, retryAt: null, replay: true }).join(' ')).not.toMatch(/PayPal retries/);
    expect(fixWhy('PAUSE', { amount, retryAt: null, replay: true, offCode: 'NOT_BUILT' }).join(' ')).not.toMatch(/PayPal retries/);
  });
});
