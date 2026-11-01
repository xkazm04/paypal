// Test fixtures for the assistant core: a Maya-like week and a brand-new wallet. Time is a number
// in the input (now_ms), so no test needs a faked clock. Not imported by product code.
import type { BoardDeal, DigestInput } from './contract';

/** A Friday, 19:30 UTC. */
export const NOW = Date.UTC(2026, 10, 6, 19, 30);
const min = (m: number): number => NOW + m * 60_000;

const deal = (d: Partial<BoardDeal> & Pick<BoardDeal, 'id' | 'module' | 'fate' | 'label'>): BoardDeal => ({
  state_word: 'Waiting',
  amount_minor: null,
  currency: 'USD',
  deadline_ms: null,
  on_silence: null,
  ...d,
});

export const MAYA_DEALS: BoardDeal[] = [
  deal({ id: 'D-0193', module: 'tables', fate: 'needs', label: 'Monitor from Dan', state_word: 'Needs your countersign', amount_minor: 32900, deadline_ms: min(150), on_silence: 'the offer lapses and nothing is paid' }),
  deal({ id: 'D-0188', module: 'rescue', fate: 'needs', label: 'Care plan renewal for Lark', state_word: 'Renewal failed', amount_minor: 4900, deadline_ms: min(600), on_silence: 'PayPal retries on its own and nothing is discounted' }),
  deal({ id: 'D-0201', module: 'rescue', fate: 'moving', label: 'Care plan renewal for Fern', state_word: 'Retrying', amount_minor: 4900 }),
  deal({ id: 'D-0170', module: 'rescue', fate: 'paid', label: 'Care plan renewal for Moss', state_word: 'Recovered', amount_minor: 4900 }),
  deal({ id: 'D-0150', module: 'shield', fate: 'stopped', label: 'Offer from a stranger', state_word: 'Blocked' }),
  deal({ id: 'D-0160', module: 'spend', fate: 'stopped', label: 'GPU hours', state_word: 'Refused by your rules', amount_minor: 120000 }),
  deal({ id: 'D-0171', module: 'spend', fate: 'paid', label: 'Dock supplies', state_word: 'Paid', amount_minor: 6800 }),
  deal({ id: 'Q-0044', module: 'counter', fate: 'moving', label: 'Quote for Fern', state_word: 'Quote sent', amount_minor: 21000 }),
  deal({ id: 'D-0120', module: 'book', fate: 'paid', label: 'Receipt matched', state_word: 'Matched', amount_minor: 2500 }),
];

export const mayaWeek = (): DigestInput => ({
  now_ms: NOW,
  first_run: false,
  deals: MAYA_DEALS.map((d) => ({ ...d })),
  money: { room_left_minor: 51000, day_cap_minor: 90000, held_minor: 12900, paid_today_minor: 6800, deals_today: 3, deals_cap: 10, currency: 'USD' },
  rules_in_force: 3,
  setup: [
    { key: 'paypal', done: true },
    { key: 'rules', done: true },
    { key: 'practice', done: true },
    { key: 'engine', done: true },
  ],
});

export const firstRun = (): DigestInput => ({
  now_ms: NOW,
  first_run: true,
  deals: [],
  money: { room_left_minor: null, day_cap_minor: null, held_minor: null, paid_today_minor: null, deals_today: null, deals_cap: null, currency: null },
  rules_in_force: 0,
  setup: [
    { key: 'paypal', done: false },
    { key: 'rules', done: false },
    { key: 'practice', done: false },
    { key: 'engine', done: false },
  ],
});

export const knownOf = (i: DigestInput): { dealIds: ReadonlySet<string> } => ({ dealIds: new Set(i.deals.map((d) => d.id)) });
