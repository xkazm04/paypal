// Browser preview only: `?first_run=1` starts the mock as a brand-new wallet, the state the real
// shell is in right after install: no deals, no rules, no saved keys, no wallet limits, nobody
// connected, `first_run` true. It is its own world (own storage key and broadcast channel), so the
// sample week stays untouched and the windows a first-run preview opens stay in the same world.
// Nothing here moves money; it only chooses which sample world the mock serves.
import type { Terms } from '@bindings/Terms';
import { FIRST_RUN_PARAM } from '../lib/preview';
import { buildMockState, type MockState } from './fixtures';

// The param and the world keys live in lib/preview.ts, so a window (the tour) can use them without
// loading the mock.
export { FIRST_RUN_PARAM, firstRunPreview, worldKeys } from '../lib/preview';

/** A window the preview opens stays in the first-run world: `approval.html?deal=x` gains `&first_run=1`. */
export function withFirstRun(page: string, firstRun: boolean): string {
  if (!firstRun) return page;
  const hash = page.indexOf('#');
  const [path, frag] = hash < 0 ? [page, ''] : [page.slice(0, hash), page.slice(hash)];
  if (new URLSearchParams(path.split('?')[1] ?? '').get(FIRST_RUN_PARAM) === '1') return page;
  return `${path}${path.includes('?') ? '&' : '?'}${FIRST_RUN_PARAM}=1${frag}`;
}

/** The house seller's practice table when the ledger has no sample deal to borrow terms from.
 *  Sample data: the real house's item and price come from its own signed rules (one item,
 *  delivered at once, services/house-seller hosted.rs). */
export const PRACTICE_TERMS: Terms = {
  item_ref: 'monitor-24-ips', qty: 1, unit_price: { minor: 22900, currency: 'USD' }, currency: 'USD', delivery: { type: 'digital_now' },
};

/** A wallet straight after install, as the shell reports it: the practice agent selected (the
 *  runtime's default engine), the house seller asleep, meters not counted, nothing signed or saved. */
export function buildFirstRunState(now: number): MockState {
  const base = buildMockState(now);
  return {
    settings: {
      ...base.settings,
      house: 'idle',
      locked: false,
      payment_executor_configured: false,
      meters_available: false,
      client_pending: false,
      first_run: true,
      channel3_configured: false,
      agents_paused: false,
      selected_engine: 'scripted',
      engine_chosen: false,
      house_connected: false,
      preferences: { ...base.settings.preferences, form: 'rest' },
    },
    deals: [],
    mandates: [],
    mandateSlots: {},
    revokedMandates: [],
    pendingPairings: [],
    pairingResults: {},
    snoozed: {},
    counterparties: [],
    notes: {},
    audit: [],
    history: [],
    credentialsStoredAt: { paypal_sandbox: null, channel3: null },
    lastReportingPoll: null,
    enginesProbedAt: now,
    engines: base.engines,
    runs: [],
    stoppedToday: 0,
    inMotion: 0,
    walletSpendTodayMinor: 0,
    engineEstimateTodayUsd: 0,
    categories: {},
    envelope: null,
    rescue: {},
    marketChecksToday: {},
  };
}
