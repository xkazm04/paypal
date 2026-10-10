// Browser mock of the Rust shell, for design review and Playwright. It mirrors the gates the
// real shell enforces (approval label + token + unlocked + selected deal) so the UI is built
// against the same failure modes. It never pretends to be real: every payload says sandbox
// or replay, and the UI shows a "browser preview · mock backend" badge (see shared/MockBadge).
import type { AgentSlot } from '@bindings/AgentSlot';
import type { BookQuery } from '@bindings/BookQuery';
import type { BookView } from '@bindings/BookView';
import type { JsonValue } from '@bindings/serde_json/JsonValue';
import type { ApprovalDraft } from '@bindings/ApprovalDraft';
import type { ApprovalTarget } from '@bindings/ApprovalTarget';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { AttentionSnapshot } from '@bindings/AttentionSnapshot';
import type { LadderRung } from '@bindings/LadderRung';
import type { NotifySuppression } from '@bindings/NotifySuppression';
import type { Deal } from '@bindings/Deal';
import type { DealState } from '@bindings/DealState';
import type { EventContract } from '@bindings/EventContract';
import type { Form } from '@bindings/Form';
import type { SettingsSnapshot } from '@bindings/SettingsSnapshot';
import type { ShieldVerdict } from '@bindings/ShieldVerdict';
import type { ArgsOf, Backend, CommandName, EventName, InvokeOptions, PayloadOf, ResultOf, WindowLabel } from '../lib/contract';
import { WalletError } from '../lib/contract';
import { clockOffset, setClockOffset, simulateClock } from '../lib/clock';
import { fairPriceOf } from '../lib/fairPrice';
import { formatMoney, nowUnix } from '../lib/format';
import { buildMockState, fakeHash, fakeUlid, MOCK_OWNER_KEY_ID, type MockDeal, type MockGroup, type MockState } from './fixtures';
import { safetyRecordOf } from './safety';
import type { DealGroupView } from '@bindings/DealGroupView';
import { ON_QUIT, mockForecast, mockQuitLines, quitPending, type ForecastDeal } from './forecast';
import type { ApprovalCheckId } from '@bindings/ApprovalCheckId';
import type { DecisionArgs } from '@bindings/DecisionArgs';
import { CHECK_FAILED, SUMMARY_CHANGED } from '../lib/words';
import { mockChecks, mockChecksHash } from './checks';
import type { MandatePayload } from '@bindings/MandatePayload';
import type { SimulatedLine } from '@bindings/SimulatedLine';
import type { SimulatedVerdict } from '@bindings/SimulatedVerdict';
import { mockCheck, mockValidate, type MockIntent } from './simulate';
import { mockEnvelopeRefusal, mockExposureView } from './exposure';
import type { RescueView } from '@bindings/RescueView';
import type { Money } from '@bindings/Money';
import type { Playbook } from '@bindings/Playbook';
import { RESCUE_NO_RULES, RESCUE_SENT_SILENCE, RESCUE_SILENCE, RESCUE_WATCH_FULL } from '../lib/words';
import type { RescueWatchView } from '@bindings/RescueWatchView';
import { invoiceText, leverOf, maskEmail, proposeDiscount, RESCUE_WATCH_MAX, RESCUE_WATCH_READS_DAY, validEmail, validSubscriptionId } from './rescue';
import { AUTHORITY, AUTHORITY_MANIFEST, type CommandAuthority } from '@bindings/authority';
import { LADDER } from '@bindings/ladder';
import { buildFirstRunState, firstRunPreview, PRACTICE_TERMS, withFirstRun, worldKeys } from './firstRun';

type Envelope =
  | { kind: 'event'; event: EventName; targets: WindowLabel[]; payload: unknown }
  | { kind: 'state'; state: MockState }
  | { kind: 'clock'; offset: number };

const TARGETS: Record<EventName, WindowLabel[]> = {
  'tumbler:handoff': ['tumbler'],
  'agent:changed': ['main'],
  'attention:changed': ['main', 'tumbler'],
  'deal:changed': ['main'],
  'receipt:created': ['main', 'tumbler'],
  'settings:changed': ['main', 'tumbler', 'approval'],
  'wallet:error': ['main', 'tumbler'],
  'approval:summary': ['approval'],
  'main:route': ['main'],
  'tumbler:form': ['tumbler'],
  'tumbler:orient': ['tumbler'],
  'tumbler:status': ['main'],
  'tumbler:selected': ['tumbler'],
  'tumbler:visual': ['tumbler'],
  'pairing:pinned': ['main'],
};

export const STORE_KEY = 'the-table-mock-state-v18'; // v18: fair-price certificates on the sample market records (market-data-2); v17: agents' refused requests in Maya's week (safety record); v16: the attention ladder's recorded rungs and D-0184's lapse that cites them (attention-ladder-1); v15: D-0190's attention names no rule, as Rust does (polish 3); v14: the owner's watched subscriptions (rescue detection); v13: the shield's rule on each deal and a release bound to its terms (shield slice 2); v12: shop-around groups and the house seller's D-0204 (T8); v11: keep-prices-fresh rules and today's price checks (T15); v10: rescue cases and the fixes rule (rescue); v9: signed wallet limits (T14); v8: D-0194 checking with PayPal (T10); v7: D-0181 and the Rewind history (T6); v6: purchase payees match the Rust payees rule (T5)
const DEGRADE_KEY = 'the-table-mock-degrade';
/** The preview clock's offset from wall time, shared by every mock window of this origin. */
export const CLOCK_KEY = 'the-table-mock-clock';
const CHANNEL = 'the-table-mock';

function storedOffset(): number {
  try {
    const v = Number(localStorage.getItem(CLOCK_KEY) ?? 0);
    return Number.isFinite(v) ? Math.trunc(v) : 0;
  } catch {
    return 0;
  }
}

/** Rust's deadline default per state (table-core `transition` with Deadline / AutoVoid): an
 *  authorization auto-voids, anything not yet at PayPal is withdrawn, an unapproved order expires.
 *  Never a capture. */
const ON_DEADLINE: Partial<Record<DealState, DealState>> = {
  PAIRING: 'WITHDRAWN', LISTED: 'WITHDRAWN', NEGOTIATING: 'WITHDRAWN', AGREED: 'WITHDRAWN',
  SETTLING: 'EXPIRED', AWAITING_APPROVAL: 'EXPIRED', APPROVED: 'EXPIRED',
  AUTHORIZED: 'AUTO_VOIDED',
};
/** The sentence the shell's event loop sends with a deadline's terminal state. */
const DEADLINE_SILENCE = 'Deadline or safe decision completed; no capture was made';

/**
 * Browser preview only: the scenario director's (and the Tumbler preview stage's) handle on the
 * mock world. It moves the shared clock and replays a deal's signed steps the way the core would
 * record them. It has no money operation: nothing here approves, captures or pays, and the only
 * transitions it makes on its own are the deadline defaults above.
 */
export interface MockWorld {
  /** A deal by its display label ("D-0193"). */
  deal(label: string): MockDeal | undefined;
  attention(): AttentionSnapshot;
  settings(): SettingsSnapshot;
  /** Set the shared preview clock (seconds ahead of wall time) in every mock window. */
  setOffset(seconds: number): void;
  /** Move the shared clock forward, then let every deadline that passed take its safe default. */
  advance(seconds: number): string[];
  /** Apply the safe default to every deadline that has passed; returns the labels that lapsed. */
  sweep(): string[];
  /**
   * Show a deal as it stood after its first `upTo` signed steps (the full record is kept aside and
   * comes back once `upTo` reaches its end). `interim` is the state and check verdict before then.
   */
  rewind(label: string, upTo: number, interim?: { state: DealState; shield: ShieldVerdict | null }): void;
  /** Fresh sample data, sent to every mock window: on the wall clock, or with the shared clock set
   *  so the week starts at `at` (Unix seconds; the director starts Maya's afternoon at 14:02). */
  reset(at?: number): void;
  /** Send a Rust-shaped event from this world to its target windows. */
  emit<E extends EventName>(event: E, payload: EventContract[E]): void;
}

export type MockBackend = Backend & { readonly world: MockWorld };
const FORM_SIZE: Record<Form, [number, number]> = { rest: [88, 88], tab: [28, 96], ticker: [420, 88], card: [460, 320], stack: [460, 560], handoff: [460, 200], welcome: [460, 380] };

/** Optional compatibility preview for an older shell without the safe projections. */
function degraded(): boolean {
  try {
    return new URLSearchParams(location.search).get('degrade') === '1' || localStorage.getItem(DEGRADE_KEY) === '1';
  } catch {
    return false;
  }
}
function pendingFail(cmd: string): never {
  throw new WalletError({ code: 'UNAVAILABLE', message: `command ${cmd} not found (older shell preview)` });
}
const TOKEN = 'mock-approval-capability';
const IDLE_LOCK_SECONDS = 15 * 60;
/** Who may call each command: the Rust authority table (T11), generated into bindings, never a
 *  hand-kept copy. The type check fails here if a command has no row. */
const GATES: Record<CommandName, CommandAuthority> = AUTHORITY;

/** A refusal by the gate itself (label, token, idle lock, selected deal), as the shell's
 *  authority check answers it; anything a handler refuses after the gate is a plain WalletError. */
export class GateError extends WalletError {}
function gateFail(code: 'PERMISSION' | 'LOCKED', message: string): never {
  throw new GateError({ code, message });
}

function fail(code: WalletError['code'], message: string): never {
  throw new WalletError({ code, message });
}

export function mockBackend(label: WindowLabel): MockBackend {
  // ?first_run=1: a brand-new wallet in a world of its own (src/mock/firstRun.ts).
  const firstRun = firstRunPreview();
  const keys = worldKeys(STORE_KEY, CHANNEL, firstRun);
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(keys.channel) : null;
  const listeners = new Map<EventName, Set<(p: unknown) => void>>();
  // The preview clock: every mock window reads the same offset (storage on load, the channel after).
  simulateClock();
  setClockOffset(storedOffset());
  const fresh = () => (firstRun ? buildFirstRunState(nowUnix()) : buildMockState(nowUnix()));
  let state: MockState = load() ?? fresh();
  let lastPrivileged = nowUnix();
  let form: Form = state.settings.preferences.form;
  const params = new URLSearchParams(location.search);
  // The deal this approval window is bound to; a replayed renewal rebinds it (Rust rescue_replay).
  let selected: string | null = label === 'approval' ? params.get('deal') : null;
  const selectedPairing = label === 'approval' ? params.get('pairing') : null;

  function load(): MockState | null {
    try {
      const raw = sessionStorage.getItem(keys.store) ?? localStorage.getItem(keys.store);
      if (!raw) return null;
      const stored = JSON.parse(raw) as MockState;
      // The fingerprint is this build's authority table, never stored data.
      stored.settings = { ...stored.settings, authority_manifest: AUTHORITY_MANIFEST };
      return stored;
    } catch {
      return null;
    }
  }
  function save(): void {
    try {
      localStorage.setItem(keys.store, JSON.stringify(state));
    } catch {
      /* storage may be blocked in previews; the mock still works per tab */
    }
    channel?.postMessage({ kind: 'state', state } satisfies Envelope);
  }
  function deliver(event: EventName, payload: unknown): void {
    listeners.get(event)?.forEach((cb) => cb(payload));
  }
  function emit<E extends EventName>(event: E, payload: EventContract[E]): void {
    const targets = TARGETS[event];
    if (targets.includes(label)) deliver(event, payload);
    channel?.postMessage({ kind: 'event', event, targets, payload } satisfies Envelope);
  }
  channel?.addEventListener('message', (m: MessageEvent<Envelope>) => {
    const env = m.data;
    if (env.kind === 'state') state = env.state;
    else if (env.kind === 'clock') setClockOffset(env.offset);
    else if (env.targets.includes(label)) deliver(env.event, env.payload);
  });

  const find = (id: string) => state.deals.find((d) => d.deal.id === id) ?? fail('NOT_FOUND', `no deal ${id}`);
  /** The ledger's `status='active'` row: the newest signed version of an id, unless it was revoked. */
  function activeMandate(id: string) {
    const latest = state.mandates.filter((m) => m.payload.id === id).reduce<MockState['mandates'][number] | undefined>((a, m) => (!a || m.payload.version > a.payload.version ? m : a), undefined);
    return latest && !state.revokedMandates?.includes(`${id}:${latest.payload.version}`) ? latest : undefined;
  }
  function ownerMandateAllows(d: ReturnType<typeof find>): boolean {
    const m = activeMandate(d.deal.mandate_id);
    if (!m || m.payload.version !== d.deal.mandate_version || m.payload.not_before > nowUnix() || m.payload.expires <= nowUnix()) return false;
    const amount = d.deal.terms.unit_price.minor * d.deal.terms.qty;
    const cp = state.counterparties.find((c) => c.key_id === d.deal.counterparty);
    return m.payload.clauses.every((c) => {
      switch (c.type) {
        case 'roles': return c.roles.includes('buy');
        case 'counterparties': return !!cp && (c.rule.type === 'paired' || c.rule.type === 'house' && cp.house || c.rule.type === 'pinned' && c.rule.keys.includes(cp.key_id));
        case 'per_deal': return c.kind === d.deal.kind && c.max_amount.currency === d.deal.terms.currency && amount <= c.max_amount.minor;
        case 'band': return !!c.ceiling && c.ceiling.currency === d.deal.terms.currency && c.item_refs.includes(d.deal.terms.item_ref)
          && d.deal.terms.unit_price.minor <= c.ceiling.minor && c.deadline > nowUnix() && (d.display.band?.rounds_used ?? 0) <= c.max_rounds;
        case 'velocity': return c.max_total_day.currency === d.deal.terms.currency && amount + state.walletSpendTodayMinor <= c.max_total_day.minor;
        case 'human_present_over': return c.amount.currency === d.deal.terms.currency; // Only this clause is satisfied by the owner decision.
        case 'payees': return !!cp?.declared_payee && c.payees.includes(cp.declared_payee);
        // Keeping prices fresh grants nothing and refuses nothing.
        case 'market_watch': return true;
      }
    });
  }
  /** BookQuery as Rust's serde + BookQuery::rejection + book_query_rejection see it. */
  function checkBookQuery(raw: JsonValue): BookQuery {
    const rejected = (why: string): never => fail('INVALID', `BookQuery rejected: ${why}`);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return rejected('invalid type: expected struct BookQuery');
    const o = raw as Record<string, JsonValue>;
    const KEYS = ['view', 'metrics', 'filters', 'group_by', 'range', 'limit'];
    for (const k of Object.keys(o)) if (!KEYS.includes(k)) rejected(`unknown field \`${k}\`, expected one of ${KEYS.map((x) => `\`${x}\``).join(', ')}`);
    const VIEWS: BookView[] = ['deals', 'paypal_calls', 'receipts', 'subscriptions', 'reconciliation'];
    const METRICS = ['count', 'sum_amount', 'avg_vs_market_pct', 'recovered_sum'];
    const GROUPS = ['kind', 'counterparty', 'state', 'day', 'decided_by'];
    const FIELDS = ['kind', 'state', 'counterparty', 'amount', 'created_at', 'vs_market_pct', 'decided_by'];
    const OPS = ['eq', 'ne', 'gt', 'lt', 'between', 'in'];
    if (!VIEWS.includes(o.view as BookView)) rejected(o.view === undefined ? 'missing field `view`' : `unknown variant \`${String(o.view)}\``);
    if (!Array.isArray(o.metrics)) rejected('missing field `metrics`');
    const metrics = o.metrics as string[];
    for (const m of metrics) if (!METRICS.includes(m)) rejected(`unknown variant \`${m}\``);
    const group_by = (o.group_by ?? []) as string[];
    for (const g of group_by) if (!GROUPS.includes(g)) rejected(`unknown variant \`${g}\``);
    const filters = (o.filters ?? []) as Array<{ field: string; op: string; value: JsonValue }>;
    for (const f of filters) {
      if (!FIELDS.includes(f.field)) rejected(`unknown variant \`${f.field}\``);
      if (!OPS.includes(f.op)) rejected(`unknown variant \`${f.op}\``);
    }
    const limit = (o.limit ?? null) as number | null;
    if (metrics.length < 1 || metrics.length > 4) rejected('metrics: 1 to 4 required');
    if (filters.length > 6) rejected('filters: at most 6');
    if (group_by.length > 2) rejected('group_by: at most 2');
    if (limit !== null && (limit < 1 || limit > 500)) rejected('limit: 1 to 500');
    if (new Set(metrics).size !== metrics.length) rejected('metrics: each at most once');
    if (new Set(group_by).size !== group_by.length) rejected('group_by: each at most once');
    if (o.view === 'paypal_calls' && metrics.includes('recovered_sum')) rejected('recovered_sum is not defined on the paypal_calls view');
    for (const f of filters) {
      const ints = ['amount', 'created_at', 'vs_market_pct'].includes(f.field);
      const vals = f.op === 'in' || f.op === 'between' ? f.value : [f.value];
      if (!Array.isArray(vals) || !vals.length || vals.length > 32) rejected('filters: in and between take an array of 1 to 32 values');
      if (f.op === 'between' && (vals as JsonValue[]).length !== 2) rejected('filters: between takes exactly two values');
      for (const v of vals as JsonValue[]) {
        if (ints && !Number.isInteger(v)) rejected('filters: amount, created_at and vs_market_pct take integers');
        if (!ints && (typeof v !== 'string' || !v.length || v.length > 256)) rejected('filters: text values are 1 to 256 characters');
      }
    }
    // compile(): a range is [from, to) of RFC 3339 times, from strictly before to.
    const range = (o.range ?? null) as BookQuery['range'];
    if (range !== null) {
      if (typeof range !== 'object' || Array.isArray(range)) rejected('invalid type: expected struct BookRange');
      for (const k of Object.keys(range)) if (k !== 'from' && k !== 'to') rejected(`unknown field \`${k}\`, expected \`from\` or \`to\``);
      const t = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.test(x) ? Date.parse(x) : NaN);
      const from = t(range.from);
      const to = t(range.to);
      if (!Number.isFinite(from) || !Number.isFinite(to)) rejected('range: from and to must be RFC 3339 times');
      if (from >= to) rejected('range: from must be before to');
    }
    return { view: o.view as BookView, metrics: metrics as BookQuery['metrics'], filters: filters as BookQuery['filters'], group_by: group_by as BookQuery['group_by'], range, limit };
  }
  /** Runtime::check_draft: a draft binds to its target (shape and currency only). */
  function checkDraft(t: ApprovalTarget | null, dealId: string | null, draft: ApprovalDraft): void {
    const bandOf = (m: MockState['mandates'][number] | undefined, item: string) =>
      m?.payload.clauses.find((c): c is Extract<typeof c, { type: 'band' }> => c.type === 'band' && c.item_refs.includes(item));
    switch (draft.type) {
      case 'band': {
        if (t !== 'deal' || !dealId) fail('INVALID', 'a band draft needs a deal');
        const d = find(dealId);
        const cur = d.deal.terms.currency;
        const vals = [draft.floor, draft.ceiling].filter((v): v is NonNullable<typeof v> => !!v);
        if (!['PAIRING', 'LISTED', 'NEGOTIATING', 'AGREED'].includes(d.deal.state) || d.deal.paypal.order || !bandOf(activeMandate(d.deal.mandate_id), d.deal.terms.item_ref)
          || !vals.length || vals.some((v) => v.currency !== cur || v.minor <= 0) || (draft.floor && draft.ceiling && draft.floor.minor > draft.ceiling.minor)) fail('INVALID', 'the band draft does not fit this deal');
        return;
      }
      case 'floor': {
        const m = activeMandate(draft.mandate_id);
        const b = bandOf(m, draft.item_ref);
        const cur = m?.payload.clauses.find((c): c is Extract<typeof c, { type: 'per_deal' }> => c.type === 'per_deal')?.max_amount.currency;
        if (t !== 'mandate' || !b || draft.floor.minor <= 0 || draft.floor.currency !== cur || (b.ceiling && b.ceiling.minor < draft.floor.minor)) fail('INVALID', 'the floor draft does not fit that mandate');
        return;
      }
      case 'lever':
        if (t !== 'deal' || !dealId || find(dealId).deal.kind !== 'rescue') fail('INVALID', 'a lever draft needs a rescue deal');
    }
  }
  // ?limits=none previews a wallet with no limits signed (the fixtures sign Maya's).
  const limitsNone = params.get('limits') === 'none';
  const envelope = () => (limitsNone ? null : state.envelope ?? null);
  const exposureView = () => mockExposureView(state.deals.map((d) => d.deal), envelope(), nowUnix());
  // As Runtime::record_rung (attention-ladder-1): a card's rung for its live deadline, once each.
  // Recorded in memory; the next save carries it, and the deadline's sweep cites it.
  function recordRung(a: AttentionItem, rung: LadderRung, reason?: NotifySuppression): void {
    const now = nowUnix();
    if (a.deadline === null || a.deadline <= now) return;
    const list = state.rungs ?? [];
    if (list.some((r) => r.deal_id === a.deal_id && r.deadline === a.deadline && r.mark.rung === rung)) return;
    state.rungs = [...list, { deal_id: a.deal_id, deadline: a.deadline, mark: { rung, at: now, ...(reason ? { reason } : {}) } }];
  }
  /** As Runtime::record_snapshot_rungs: each card shown, each gate breathing, each due notice held back. */
  function snapshotRungs(items: readonly AttentionItem[]): void {
    const p = state.settings.preferences;
    for (const a of items) {
      recordRung(a, 'shown');
      if (a.kind !== 'gate' || a.deadline === null) continue;
      const left = a.deadline - nowUnix();
      if (!p.dnd && left > 0 && left <= LADDER.breathe_secs) recordRung(a, 'breathing');
      if (left > 0 && left <= LADDER.notify_secs && (p.dnd || !p.notifications)) recordRung(a, 'notify_suppressed', p.dnd ? 'do_not_disturb' : 'notifications_off');
    }
  }
  /** An owner act on a deal's card (opened, reviewed, snoozed), when it has one. */
  const cardRung = (dealId: string, rung: LadderRung) => {
    const a = state.deals.find((d) => d.deal.id === dealId)?.attention;
    if (a && (a.kind !== 'gate' || (state.snoozed?.[a.deal_id] ?? 0) <= nowUnix())) recordRung(a, rung);
  };
  const attention = (): AttentionSnapshot => {
    const items = state.deals
      .map((d) => d.attention)
      .filter((a): a is NonNullable<typeof a> => a !== null)
      .filter((a) => (label === 'approval' ? a.deal_id === selected : true))
      .filter((a) => a.kind !== 'gate' || (state.snoozed?.[a.deal_id] ?? 0) <= nowUnix() || (a.deadline ?? Infinity) - nowUnix() <= LADDER.notify_secs)
      .map((a) => {
        const left = a.deadline === null ? Infinity : a.deadline - nowUnix();
        return { ...a, urgency: left <= LADDER.notify_secs ? ('now' as const) : left <= LADDER.breathe_secs ? ('soon' as const) : ('calm' as const) };
      })
      .sort((x, y) => (x.deadline ?? Infinity) - (y.deadline ?? Infinity));
    snapshotRungs(items);
    const exposure = exposureView();
    const rows = exposure.currencies;
    return {
      items,
      stopped_today: state.stoppedToday,
      in_motion: state.inMotion,
      wallet_spend_today_minor: state.walletSpendTodayMinor,
      wallet_spend_today_currency: 'USD',
      engine_estimate_today_usd: state.engineEstimateTodayUsd,
      locked: isLocked(),
      forecast: forecast(),
      exposure,
      // As Rust: the day's money out from the fold when it is in one currency; mixed is not summed.
      ...(rows.length === 1 ? { wallet_spend_today_minor: rows[0]!.out_today.minor, wallet_spend_today_currency: rows[0]!.currency } : rows.length > 1 ? { wallet_spend_today_currency: null } : {}),
    };
  };
  // ?forecast=off previews a shell whose forecast read failed (the snapshot then carries none).
  const forecastOff = params.get('forecast') === 'off';
  const forecastDeals = (): ForecastDeal[] => state.deals.map((d) => ({
    deal: d.deal, label: d.display.label, deadline: d.display.deadline,
    // The mock keeps no receipt time: the deal's last change stands in for it.
    receiptAt: d.deal.side === 'buyer' && d.deal.state === 'RECEIPTED' && d.evidence.receipt === 'SELLER_ATTESTED' ? d.deal.updated_at ?? null : null,
  }));
  const forecast = () => (forecastOff ? null : mockForecast(forecastDeals(), {
    now: nowUnix(), paused: state.settings.agents_paused, executorConfigured: state.settings.payment_executor_configured,
  }));
  // ?locked=1 starts the window idle-locked, for screenshots of the LOCKED states.
  const forceLocked = params.get('locked') === '1';
  const isLocked = () => forceLocked || state.settings.locked || nowUnix() - lastPrivileged > IDLE_LOCK_SECONDS;

  /** The authority table's gate, in the runtime's order: label, token, idle lock, selected deal. */
  function gate(cmd: CommandName, args: unknown, opts: InvokeOptions | undefined): void {
    const g = GATES[cmd];
    if (!g.labels.includes(label)) gateFail('PERMISSION', `${cmd} is not available to ${label}`);
    if (g.token && opts?.token !== TOKEN) gateFail('PERMISSION', 'missing approval capability');
    if (g.unlock && isLocked()) gateFail('LOCKED', 'idle for more than 15 minutes · unlock with Windows Hello');
    const bound = g.selection === 'required' || (g.selection === 'in_approval' && label === 'approval');
    if (bound && (args as { deal_id?: string } | null)?.deal_id !== selected) gateFail('PERMISSION', 'not the selected deal');
  }
  /** The real shell's privileged gate: approval label AND token AND unlocked AND selected. */
  function privileged(opts: InvokeOptions | undefined, dealId?: string): void {
    if (label !== 'approval') gateFail('PERMISSION', 'privileged commands run only in the approval window');
    if (opts?.token !== TOKEN) gateFail('PERMISSION', 'missing approval capability');
    if (isLocked()) gateFail('LOCKED', 'idle for more than 15 minutes · unlock with Windows Hello');
    if (dealId !== undefined && dealId !== selected) gateFail('PERMISSION', 'this approval window is bound to another deal');
    lastPrivileged = nowUnix();
  }
  /** The wallet's checklist for a deal now, as Rust composes it (src/mock/checks.ts). */
  function checksFor(d: ReturnType<typeof find>) {
    // Like the ledger's usage_for: the other deals under the same mandate that reached agreement
    // and were not withdrawn, refused, expired or released (the mock keeps no agreement day).
    const OUT = ['PAIRING', 'LISTED', 'NEGOTIATING', 'REFUSED', 'WITHDRAWN', 'EXPIRED', 'VOIDED', 'AUTO_VOIDED'];
    const spentTodayMinor = state.deals
      .filter((o) => o.deal.id !== d.deal.id && o.deal.mandate_id === d.deal.mandate_id && !OUT.includes(o.deal.state))
      .reduce((sum, o) => sum + o.deal.terms.unit_price.minor * o.deal.terms.qty, 0);
    const checks = mockChecks({
      deal: d.deal, transcript: d.transcript, counterparty: state.counterparties.find((c) => c.key_id === d.deal.counterparty),
      mandate: activeMandate(d.deal.mandate_id), spentTodayMinor, now: nowUnix(),
      limitRefusal: mockEnvelopeRefusal(state.deals.map((o) => o.deal), d.deal, envelope(), nowUnix()),
      rescue: state.rescue?.[d.deal.id],
    });
    return { checks, checks_hash: mockChecksHash(checks) };
  }
  /** Rust's decide(): a money decision must carry the hash of the checklist as it reads now, and
   *  no line may fail (a release may fail only the shield line). Void never comes here. */
  function boundToChecks(args: DecisionArgs, exempt?: ApprovalCheckId): void {
    const now = checksFor(find(args.deal_id));
    if (!args.checks_hash || JSON.stringify(args.checks_hash) !== JSON.stringify(now.checks_hash)) fail('INVALID', SUMMARY_CHANGED);
    if (now.checks.some((c) => c.status === 'fail' && c.id !== exempt)) fail('INVALID', CHECK_FAILED);
  }
  function transition(id: string, to: DealState, patch: Partial<Deal> = {}, keepAttention = false): Deal {
    const d = find(id);
    d.deal = { ...d.deal, ...patch, state: to, updated_at: nowUnix() };
    if (!keepAttention) d.attention = null;
    save();
    emit('deal:changed', { deal: d.deal, mode: d.deal.mode });
    emit('attention:changed', attention());
    return d.deal;
  }
  /** Rust keeps a deal reserved while a money step's PayPal answer is being checked (T10): no
   *  new money step and no walking away until PayPal's record settles it. */
  function notWhileChecking(id: string): void {
    if (find(id).evidence.money_check) fail('PERMISSION', 'a payment step is being checked with PayPal');
  }
  /** Runtime::rescue_mandate: the latest active rules that carry the fixes clause. */
  function rescueMandate() {
    const ids = [...new Set(state.mandates.map((m) => m.payload.id))];
    return ids.map(activeMandate).filter((m): m is NonNullable<typeof m> => !!m && !!leverOf(m) && m.payload.not_before <= nowUnix() && m.payload.expires > nowUnix())
      .sort((a, b) => a.payload.not_before - b.payload.not_before).at(-1);
  }
  /** Runtime::rescue_releasable: a fix waiting at AGREED, before its deadline, nothing being checked. */
  function rescueReleasable(d: ReturnType<typeof find>): boolean {
    return d.deal.kind === 'rescue' && d.deal.state === 'AGREED' && !d.evidence.money_check && (d.display.deadline ?? 0) > nowUnix() && !!state.rescue?.[d.deal.id];
  }
  /** The ledger's rescue_recovered: counted rescues only, one total per currency. */
  function rescueRecovered(): Money[] {
    const by = new Map<Money['currency'], number>();
    for (const v of Object.values(state.rescue ?? {})) if (v.counted) by.set(v.offer.invoice.currency, (by.get(v.offer.invoice.currency) ?? 0) + v.offer.invoice.minor);
    return [...by.entries()].map(([currency, minor]) => ({ minor, currency }));
  }
  // ---- shop around (T8): as the ledger's group guard and Runtime::close_groups -------------------
  // ?groups=none previews the wallet before the sample group was opened ("Shop around" shows).
  const groupsNone = params.get('groups') === 'none';
  const groups = (): MockGroup[] => (state.groups ?? []).filter((g) => !(groupsNone && g.sample));
  const groupOfDeal = (id: string) => groups().find((g) => g.deal_ids.includes(id));
  /** Our ACCEPT is out on this table: signed after the latest offer, the deal still negotiating. */
  function acceptOut(d: MockDeal): boolean {
    const last = d.transcript.reduce((i, t, n) => (t.typ === 'OFFER' || t.typ === 'COUNTER' ? n : i), -1);
    return d.deal.state === 'NEGOTIATING' && d.transcript.some((t, n) => n > last && t.by === 'you' && t.typ === 'ACCEPT');
  }
  /** The ledger's accept guard: another table agreed, or holds the group's one ACCEPT. */
  function groupBlocked(id: string): boolean {
    const g = groupOfDeal(id);
    if (!g) return false;
    if (g.winner && g.winner !== id) return true;
    return g.deal_ids.some((o) => o !== id && acceptOut(find(o)));
  }
  function groupView(g: MockGroup): DealGroupView {
    const priced = (d: MockDeal, by: 'you' | 'them') =>
      [...d.transcript].reverse().find((t) => t.by === by && (t.typ === 'LISTING' || t.typ === 'OFFER' || t.typ === 'COUNTER'))?.price ?? null;
    return {
      group_id: g.group_id, item_ref: g.item_ref, opened_at: g.opened_at, winner: g.winner,
      tables: g.deal_ids.map((id) => {
        const d = find(id);
        return {
          deal_id: id, counterparty: d.deal.counterparty, state: d.deal.state, seller_price: priced(d, 'them'), our_price: priced(d, 'you'),
          closed_by_group: !!g.winner && g.winner !== id && d.deal.state === 'WITHDRAWN',
        };
      }),
    };
  }
  /** The group rule after a table agreed: claim the group, then a signed WITHDRAW to every other open table. */
  function closeGroup(winner: string): void {
    const g = groupOfDeal(winner);
    if (!g || g.winner) return;
    g.winner = winner;
    const history = state.history ?? buildMockState(nowUnix()).history ?? [];
    for (const id of g.deal_ids) {
      const d = find(id);
      if (id === winner || !['PAIRING', 'LISTED', 'NEGOTIATING'].includes(d.deal.state)) continue;
      d.transcript.push({ seq: d.transcript.length + 1, by: 'you', typ: 'WITHDRAW', price: null, at: nowUnix(), verified: true });
      history.push({ at: nowUnix(), deal_id: id, seq: history.reduce((m, h) => Math.max(m, h.seq), 0) + 1, kind: 'group_withdrawn', state_after: 'WITHDRAWN', authority: { type: 'group_rule' }, paypal: { type: 'none' } });
      state.history = history;
      transition(id, 'WITHDRAWN');
      emit('receipt:created', { deal_id: id, evidence: d.evidence, mode: d.deal.mode, state: 'WITHDRAWN', on_silence: 'withdrawn · no money moved' });
    }
    save();
  }
  function openWindow(page: string, name: string, features?: string): void {
    window.open(withFirstRun(page, firstRun), name, features);
  }

  const handlers: { [K in CommandName]: (args: ArgsOf<K>, opts?: InvokeOptions) => ResultOf<K> } = {
    get_settings: () => ({ ...state.settings, house_connected: state.counterparties.some((c) => c.house), locked: isLocked(), authority_manifest: AUTHORITY_MANIFEST }),
    list_deals: () => state.deals.map((d) => d.deal),
    get_deal: ({ deal_id }) => find(deal_id).deal,
    // The fair price is worked out from the deal's market record as Rust does from its rows.
    deal_evidence: ({ deal_id }) => {
      const d = find(deal_id);
      return { ...d.evidence, fair_price: fairPriceOf(d.deal.state, d.deal.market, d.deal.terms.unit_price) };
    },
    // A browser preview has no ledger or agent key to sign with: say so instead of faking a file.
    deal_export_proof: ({ deal_id }) => { find(deal_id); return fail('UNAVAILABLE', `Proof export needs the native wallet: the bundle is signed by the deal's agent key`); },
    // Checking a file needs the wallet's own file dialog and checker; the preview has neither.
    proof_check: () => fail('UNAVAILABLE', 'Checking a proof file needs the desktop app.'),
    deal_reconcile: ({ deal_id }) => {
      const d = find(deal_id);
      if (d.evidence.reconciliation === 'pending_reporting') d.evidence = { ...d.evidence, reconciliation: 'matched' };
      save();
      return d.evidence;
    },
    engine_status: () => state.engines,
    engine_select: ({ engine }) => {
      const e = state.engines.find((x) => x.id === engine);
      if (!e?.available) fail('UNAVAILABLE', `${engine} is installed but waits for its isolation spike`);
      state.settings = { ...state.settings, selected_engine: engine, engine_chosen: true };
      save();
      emit('settings:changed', state.settings);
      return null;
    },
    agent_start: ({ deal_id }) => {
      // engines.rs: a scripted-engine run is a practice run; any other keeps the deal's mode.
      const engine = state.settings.selected_engine;
      const deal = find(deal_id).deal;
      // engines.rs: an agent app run starts from its role's playbook; the policy negotiator reads none.
      const playbook: Playbook | null = engine === 'scripted' ? null
        : deal.kind === 'purchase' ? 'shopper' : deal.side === 'buyer' ? 'buyer_haggler' : 'seller_counter';
      const run = { run: fakeUlid(`run:${deal_id}:${Date.now()}`), deal_id, engine, mode: engine === 'scripted' ? 'scripted_engine' as const : deal.mode, state: 'running' as const, playbook };
      state.runs = [run, ...state.runs].slice(0, 64);
      save();
      emit('agent:changed', run);
      return run;
    },
    agent_runs: () => state.runs,
    resume_all_agents: () => {
      state.settings = { ...state.settings, agents_paused: false };
      save();
      emit('settings:changed', state.settings);
      return null;
    },
    pause_all_agents: () => {
      state.settings = { ...state.settings, agents_paused: true };
      save();
      emit('settings:changed', state.settings);
      return null;
    },
    market_refresh: ({ deal_id, product_id }, opts) => {
      privileged(opts, deal_id);
      const d = find(deal_id);
      // As Runtime::market_refresh: only the product the deal's rules bind to its item, refused
      // before any market call (market-data-2).
      const latest = activeMandate(d.deal.mandate_id);
      const watched = latest?.payload.clauses.flatMap((c) => (c.type === 'market_watch' ? c.items : [])).find((i) => i.item_ref === d.deal.terms.item_ref);
      const bound = watched ? watched.product_id : /^[A-Za-z0-9_-]{1,128}$/.test(d.deal.terms.item_ref) ? d.deal.terms.item_ref : null;
      if (product_id !== bound) fail('INVALID', 'that market product does not price this item under its rules');
      return d.deal.market ?? fail('UNAVAILABLE', 'no market reference for this item');
    },
    attention_list: () => attention(),
    main_open: ({ deal_id }) => {
      // Opened from its Tumbler card: the owner's own act (attention-ladder-1).
      if (deal_id && label === 'tumbler') cardRung(deal_id, 'card_opened');
      if (label === 'main') emit('main:route', { deal_id });
      else openWindow(`index.html${deal_id ? `#d=${deal_id}` : ''}`, 'the-table-main');
      return null;
    },
    approval_open: ({ deal_id, pairing, target, draft }) => {
      if (deal_id && pairing) fail('INVALID', 'choose one approval selection');
      // As Runtime::open_approval: the target must fit the selection, and a draft (pre-fill only,
      // from Main only) must bind to that target. Nothing is signed or rebound here.
      const t = target ?? (pairing ? 'pairing' : deal_id ? 'deal' : null);
      const shape = t === 'deal' ? !!deal_id && !pairing : t === 'pairing' ? !!pairing && !deal_id : !deal_id && !pairing;
      if (!shape) fail('INVALID', 'the approval target does not match the selection');
      if (draft) {
        if (label !== 'main') fail('PERMISSION', 'only The Table carries a draft');
        checkDraft(t, deal_id ?? null, draft);
      }
      if (pairing) {
        if (label !== 'main') fail('PERMISSION', 'pairing handoff is main-only');
        if (!state.pendingPairings?.some((p) => JSON.stringify(p.pairing_id) === JSON.stringify(pairing) && p.expires > nowUnix())) fail('INVALID', 'unknown or expired pairing');
      } else if (deal_id) {
        find(deal_id);
        cardRung(deal_id, 'review_opened');
      }
      const q = new URLSearchParams();
      if (pairing) q.set('pairing', JSON.stringify(pairing));
      else if (deal_id) q.set('deal', deal_id);
      if (t) q.set('target', t);
      if (draft) q.set('draft', JSON.stringify(draft));
      const qs = q.toString();
      openWindow(`approval.html${qs ? `?${qs}` : ''}`, 'the-table-approval', 'width=744,height=660');
      return null;
    },
    // As Runtime::book_query: the closed BookQuery, its rules named verbatim, aggregates per
    // currency and mode (minor units, basis points). Read-only.
    book_query: ({ query }) => {
      const q = checkBookQuery(query);
      const views: Record<BookView, (d: MockState['deals'][number]) => boolean> = {
        deals: () => true,
        paypal_calls: (d) => !!(d.deal.paypal.order || d.deal.paypal.authorization || d.deal.paypal.capture),
        receipts: (d) => d.evidence.receipt !== 'NONE',
        subscriptions: (d) => !!d.deal.paypal.subscription,
        reconciliation: (d) => d.evidence.reconciliation !== 'not_applicable',
      };
      const col = (d: Deal, f: string): string | number | null => {
        switch (f) {
          case 'kind': return d.kind;
          // As book.rs STATE: a RECEIPTED deal on the seller's word alone is its own key.
          case 'state': return d.state === 'RECEIPTED' && state.deals.find((x) => x.deal.id === d.id)?.evidence.receipt === 'SELLER_ATTESTED' ? 'RECEIPTED:buyer' : d.state;
          case 'counterparty': return d.counterparty;
          case 'decided_by': return d.decided_by ? JSON.stringify(d.decided_by) : null;
          case 'amount': return d.terms.unit_price.minor * d.terms.qty;
          case 'created_at': return d.created_at ?? null;
          case 'vs_market_pct': return d.market && d.market.median.minor ? Math.trunc(((d.terms.unit_price.minor - d.market.median.minor) * 10000) / d.market.median.minor) : null;
          case 'day': return d.created_at ? new Date(d.created_at * 1000).toISOString().slice(0, 10) : null;
          default: return null;
        }
      };
      const span = q.range ? [Math.floor(Date.parse(q.range.from) / 1000), Math.floor(Date.parse(q.range.to) / 1000)] as const : null;
      const inRange = (d: Deal) => !span || (d.created_at !== undefined && d.created_at >= span[0] && d.created_at < span[1]);
      const keep = (d: Deal) => inRange(d) && q.filters.every((f) => {
        const v = col(d, f.field);
        const vals = Array.isArray(f.value) ? f.value : [f.value];
        switch (f.op) {
          case 'eq': return v === f.value;
          case 'ne': return v !== f.value;
          case 'gt': return typeof v === 'number' && v > Number(f.value);
          case 'lt': return typeof v === 'number' && v < Number(f.value);
          case 'in': return vals.includes(v as never);
          case 'between': return typeof v === 'number' && v >= Number(vals[0]) && v <= Number(vals[1]);
        }
      });
      const groups = new Map<string, { row: Record<string, unknown>; ds: Deal[] }>();
      for (const m of state.deals.filter((d) => views[q.view](d)).map((d) => d.deal).filter(keep)) {
        const row: Record<string, unknown> = { currency: m.terms.currency, mode: m.mode, direction: m.side === 'buyer' ? 'out' : 'in' };
        for (const g of q.group_by) row[g] = col(m, g);
        const k = JSON.stringify(row);
        const e = groups.get(k) ?? { row, ds: [] };
        e.ds.push(m);
        groups.set(k, e);
      }
      const rows = [...groups.values()].sort((a, b) => JSON.stringify(a.row).localeCompare(JSON.stringify(b.row))).slice(0, q.limit ?? 500).map(({ row, ds }) => {
        const out = { ...row };
        const bp = ds.map((d) => col(d, 'vs_market_pct')).filter((x): x is number => typeof x === 'number');
        for (const m of q.metrics) {
          if (m === 'count') out.count = ds.length;
          if (m === 'sum_amount') out.sum_amount = ds.reduce((s, d) => s + d.terms.unit_price.minor * d.terms.qty, 0);
          if (m === 'avg_vs_market_pct') out.avg_vs_market_bp = bp.length ? Math.trunc(bp.reduce((a, b) => a + b, 0) / bp.length) : null;
          if (m === 'recovered_sum') out.recovered_sum = ds.filter((d) => d.kind === 'rescue' && !!state.rescue?.[d.id]?.counted).reduce((s, d) => s + d.terms.unit_price.minor * d.terms.qty, 0);
        }
        return out as JsonValue;
      });
      return { query: q, rows };
    },
    // As Runtime::audit_page: newest first, `before` exclusive, 1..=200, closed facts only.
    audit_page: ({ before, limit }) => {
      if (limit < 1 || limit > 200) fail('INVALID', 'limit is 1 to 200');
      // ?records=broken previews a chain that fails its check: Rust verifies the whole chain
      // before every page and answers LEDGER_TRUST with no rows.
      if (params.get('records') === 'broken') fail('LEDGER_TRUST', 'ledger integrity failure: audit sequence/previous hash');
      const older = (state.audit ?? []).filter((r) => before == null || r.seq < before).sort((a, b) => b.seq - a.seq);
      const rows = older.slice(0, limit);
      return { rows, next_before: older.length > limit ? rows[rows.length - 1]?.seq ?? null : null };
    },
    // As Runtime::deal_history: one deal or all, [from, to) in Unix seconds, oldest first, the
    // newest 500 steps (truncated says older ones were left out). Closed facts only, main only.
    deal_history: ({ deal_id, from, to }) => {
      if (from != null && to != null && from >= to) fail('INVALID', 'from must be before to');
      if (deal_id) find(deal_id);
      const all = (state.history ?? buildMockState(nowUnix()).history ?? [])
        .filter((s) => (!deal_id || s.deal_id === deal_id) && (from == null || s.at >= from) && (to == null || s.at < to))
        .sort((a, b) => a.seq - b.seq);
      return { steps: all.slice(-500), truncated: all.length > 500 };
    },
    // As Runtime::owner_facts: dates and states only, never a secret.
    owner_facts: () => {
      const locked = isLocked();
      const s = state.settings;
      const mandates = handlers.mandate_list(null);
      const slots: Array<[AgentSlot, string]> = [
        ['negotiator', 'Haggles at your tables inside a signed band. Signs offers; never pays.'],
        ['shopper', 'Proposes purchases inside your spend mandate. Money moves only when you decide.'],
        ['assistant', 'Reads the book and drafts shop and rescue work. No money tool.'],
      ];
      return {
        locked,
        lock_in: locked ? null : Math.max(0, IDLE_LOCK_SECONDS - (nowUnix() - lastPrivileged)),
        last_reporting_poll: state.lastReportingPoll ?? null,
        engines: state.engines.map((e) => ({ id: e.id, probed_at: state.enginesProbedAt ?? null, available: e.available, version: e.version, detail: e.reason })),
        credentials: [
          { kind: 'paypal_sandbox' as const, stored: s.payment_executor_configured, stored_at: s.payment_executor_configured ? state.credentialsStoredAt?.paypal_sandbox ?? null : null },
          { kind: 'channel3' as const, stored: s.channel3_configured, stored_at: s.channel3_configured ? state.credentialsStoredAt?.channel3 ?? null : null },
        ],
        agents: slots.map(([slot, does]) => ({
          slot, engine: s.selected_engine, does,
          mandates: mandates.filter((m) => m.agent === slot).map((m) => m.payload.id),
          // The mock's runs are all haggles, so they belong to the negotiator slot.
          running: slot === 'negotiator' ? state.runs.filter((r) => r.state === 'running' || r.state === 'starting').length : 0,
        })),
        // As Runtime::market_watch_facts: rules in force with a keep-prices-fresh rule, and today's checks.
        market_watch: mandates.filter((m) => !m.refusal && m.payload.not_before <= nowUnix() && nowUnix() < m.payload.expires).flatMap((m) =>
          m.payload.clauses.flatMap((c) => {
            if (c.type !== 'market_watch') return [];
            const used = state.marketChecksToday?.[m.payload.id] ?? 0;
            return [{ mandate_id: m.payload.id, mandate_version: m.payload.version, agent: m.agent, items: c.items, max_per_day: c.max_refreshes_day, used_today: used, used_up: used >= c.max_refreshes_day }];
          })),
        // The owner's public key id (public; the private key never leaves the keychain).
        owner_key_id: MOCK_OWNER_KEY_ID,
      };
    },
    approval_handoff: () => {
      const target = (params.get('target') as ApprovalTarget | null) ?? (selectedPairing ? 'pairing' : selected ? 'deal' : null);
      let draft: ApprovalDraft | null = null;
      try {
        draft = params.get('draft') ? (JSON.parse(params.get('draft') as string) as ApprovalDraft) : null;
      } catch {
        draft = null;
      }
      return { target, deal_id: selected, draft };
    },
    approval_pairing: () => {
      const p = state.pendingPairings?.find((p) => JSON.stringify(p.pairing_id) === selectedPairing && p.expires > nowUnix());
      return p ? { pairing_id: p.pairing_id, words: p.words, house: p.house, display_context: p.display_context, expires: p.expires } : null;
    },
    approval_summary: ({ deal_id }) => {
      if (label !== 'approval') fail('PERMISSION', 'approval_summary is approval-only');
      if (deal_id !== selected) fail('PERMISSION', 'not the selected deal');
      const d = find(deal_id);
      const locked = isLocked();
      const shieldStops = d.deal.shield === 'HOLD' || d.deal.shield === 'BLOCK';
      const buyerHaggle = d.deal.side === 'buyer' && (d.deal.kind === 'haggle' || d.deal.kind === 'shop_order');
      const rescue = d.deal.kind === 'rescue';
      return {
        ...checksFor(d),
        deal: d.deal,
        evidence: d.evidence,
        attempt: 1,
        terms_hash: fakeHash(`${deal_id}:terms`),
        counter_hash: d.transcript.some((s) => s.by === 'them' && s.typ === 'COUNTER') ? fakeHash(`${deal_id}:counter:${d.transcript.length}`) : null,
        can_owner_accept: !locked && d.deal.side === 'buyer' && d.deal.kind === 'haggle' && d.deal.state === 'NEGOTIATING'
          && !shieldStops && d.deal.mode === 'sandbox' && (d.display.deadline ?? 0) > nowUnix()
          && d.transcript.some((s) => s.by === 'them' && s.typ === 'COUNTER')
          && !d.transcript.some((s) => s.by === 'you' && s.typ === 'ACCEPT') && ownerMandateAllows(d) && !groupBlocked(deal_id),
        locked,
        can_release: !locked && state.settings.payment_executor_configured && !buyerHaggle && d.deal.shield !== 'BLOCK' && d.deal.state !== 'MISMATCH' && (!rescue || rescueReleasable(d)),
        can_open_paypal: !locked && d.deal.state === 'AWAITING_APPROVAL' && !shieldStops,
        unavailable_reason: rescue
          ? null
          : buyerHaggle
            ? 'buyer haggle resources belong to the seller · you approve on PayPal and accept the signed receipt'
            : null,
        rescue: state.rescue?.[deal_id] ?? null,
      };
    },
    approval_token: () => {
      if (label !== 'approval') fail('PERMISSION', 'the capability exists only in the approval window');
      return TOKEN;
    },
    tumbler_set_form: ({ form: f }) => {
      form = f;
      emit('tumbler:form', f);
      const [w, h] = FORM_SIZE[f];
      emit('tumbler:orient', { form: f, placement: { rect: { x: 0, y: 0, width: w, height: h }, side: 'right', valign: 'up' } });
      emit('tumbler:status', { visible: true, form: f, count: attention().items.length });
      return null;
    },
    tumbler_pin: ({ pinned }) => {
      state.settings = { ...state.settings, preferences: { ...state.settings.preferences, pinned } };
      save();
      emit('settings:changed', state.settings);
      return null;
    },
    tumbler_drag: () => null,
    tumbler_snap: () => state.settings.preferences.snap,
    deal_withdraw: ({ deal_id }) => {
      if (label === 'approval' && deal_id !== selected) fail('PERMISSION', 'not the selected deal');
      notWhileChecking(deal_id);
      transition(deal_id, 'WITHDRAWN');
      emit('receipt:created', { deal_id, evidence: find(deal_id).evidence, mode: find(deal_id).deal.mode, state: 'WITHDRAWN', on_silence: 'withdrawn · no money moved' });
      return null;
    },
    deal_let_lapse: ({ deal_id }) => {
      const d = find(deal_id);
      d.attention = null;
      save();
      emit('attention:changed', attention());
      return null;
    },
    deal_snooze: ({ deal_id }) => {
      const d = find(deal_id);
      if (d.attention?.kind !== 'gate' || (d.attention.deadline ?? 0) - nowUnix() <= LADDER.snooze_min_left_secs) fail('INVALID', 'snooze requires a gate more than 45 minutes away');
      recordRung(d.attention, 'snoozed');
      state.snoozed = { ...state.snoozed, [deal_id]: nowUnix() + LADDER.snooze_secs };
      save();
      emit('attention:changed', attention());
      return null;
    },
    deal_owner_accept: (args, opts) => {
      privileged(opts, args.deal_id);
      boundToChecks(args);
      const d = find(args.deal_id);
      const s = handlers.approval_summary({ deal_id: args.deal_id });
      if (args.attempt !== s.attempt || JSON.stringify(args.terms_hash) !== JSON.stringify(s.terms_hash)
        || !args.counter_hash || JSON.stringify(args.counter_hash) !== JSON.stringify(s.counter_hash)) fail('INVALID', 'stale decision');
      // As the ledger's group guard (T8): refused before anything is signed (REFUSED, not a gate).
      if (groupBlocked(args.deal_id)) fail('REFUSED', 'another table in this group already agreed');
      if (!s.can_owner_accept || !ownerMandateAllows(d)) fail('PERMISSION', 'owner accept is unavailable');
      d.transcript.push({ seq: d.transcript.length + 1, by: 'you', typ: 'ACCEPT', price: null, at: nowUnix(), verified: true });
      const agreed = d.transcript.some((s) => s.by === 'them' && s.typ === 'ACCEPT');
      const deal = transition(args.deal_id, agreed ? 'AGREED' : 'NEGOTIATING', { decided_by: { type: 'human', at: nowUnix() } });
      if (agreed) closeGroup(args.deal_id);
      return deal;
    },
    unlock: (_a, opts) => {
      if (label !== 'approval') fail('UNSUPPORTED', 'unlock runs only in the approval window');
      if (opts?.token !== TOKEN) fail('PERMISSION', 'missing approval capability');
      // Simulates Windows Hello success. The real shell never unlocks on cancel or failure.
      state.settings = { ...state.settings, locked: false };
      lastPrivileged = nowUnix();
      save();
      emit('settings:changed', state.settings);
      return null;
    },
    deal_countersign: (args, opts) => {
      const { deal_id } = args;
      privileged(opts, deal_id);
      notWhileChecking(deal_id);
      boundToChecks(args);
      const d = find(deal_id);
      if (!['AGREED', 'APPROVED'].includes(d.deal.state)) fail('INVALID', `cannot countersign in ${d.deal.state}`);
      return transition(deal_id, 'AWAITING_APPROVAL', { paypal: { ...d.deal.paypal, order: '7XK' + deal_id.slice(-5) }, decided_by: { type: 'human', at: nowUnix() } }, true);
    },
    deal_capture: (args, opts) => {
      const { deal_id } = args;
      privileged(opts, deal_id);
      notWhileChecking(deal_id);
      boundToChecks(args);
      const d = find(deal_id);
      if (d.deal.state !== 'AUTHORIZED') fail('INVALID', `cannot capture in ${d.deal.state}`);
      const deal = transition(deal_id, 'CAPTURED', { paypal: { ...d.deal.paypal, capture: 'CAP' + deal_id.slice(-5) }, decided_by: { type: 'human', at: nowUnix() } });
      d.evidence = { ...d.evidence, receipt: 'PAYPAL_VERIFIED', reconciliation: 'pending_reporting' };
      save();
      emit('receipt:created', { deal_id, evidence: d.evidence, mode: deal.mode, state: 'CAPTURED', on_silence: 'captured · pending in PayPal reporting' });
      return deal;
    },
    deal_void: ({ deal_id }, opts) => {
      privileged(opts, deal_id);
      notWhileChecking(deal_id);
      if (find(deal_id).deal.state !== 'AUTHORIZED') fail('INVALID', 'only an authorization can be voided');
      return transition(deal_id, 'VOIDED', { decided_by: { type: 'human', at: nowUnix() } });
    },
    shield_release: (args, opts) => {
      const { deal_id } = args;
      privileged(opts, deal_id);
      boundToChecks(args, 'shield');
      const d = find(deal_id);
      if (d.deal.shield === 'BLOCK') fail('PERMISSION', 'a BLOCK cannot be released');
      // As Pipeline::owner_release_hold: only a HOLD with a named rule, released for these terms
      // and that rule, recorded as the owner's decision. The HOLD reads ASK while it applies.
      const terms = handlers.approval_summary({ deal_id }).terms_hash;
      if (JSON.stringify(args.terms_hash) !== JSON.stringify(terms)) fail('INVALID', 'stale decision');
      if (d.deal.shield !== 'HOLD' || !d.deal.shield_rule) fail('PERMISSION', 'only a pause can be released');
      const at = nowUnix();
      return transition(deal_id, d.deal.state, {
        shield: 'ASK',
        shield_release: { terms_hash: terms, rules: [d.deal.shield_rule], at },
        decided_by: { type: 'human', at },
      });
    },
    // As table-app rescue_approve under the owner's ticket: one invoice for this cycle's
    // discounted amount is made and sent (SETTLING → AWAITING_APPROVAL). Nothing is paid here; only
    // PayPal's PAID, read back and receipted, would count, and never on a replayed failure.
    rescue_approve: (args, opts) => {
      const { deal_id } = args;
      privileged(opts, deal_id);
      notWhileChecking(deal_id);
      boundToChecks(args);
      const d = find(deal_id);
      const s = handlers.approval_summary({ deal_id });
      if (args.attempt !== s.attempt || JSON.stringify(args.terms_hash) !== JSON.stringify(s.terms_hash)) fail('INVALID', 'Invalid or stale wallet command');
      if (d.deal.kind !== 'rescue') fail('INVALID', 'Invalid or stale wallet command');
      if (!state.settings.payment_executor_configured) fail('UNAVAILABLE', 'Enter PayPal sandbox credentials');
      if (!rescueReleasable(d)) fail('INVALID', 'Invalid or stale wallet command');
      const invoice = `INV2-${deal_id.slice(-4)}-${deal_id.slice(-8, -4)}`;
      const view = state.rescue?.[deal_id];
      if (view) state.rescue = { ...state.rescue, [deal_id]: { ...view, invoice } };
      d.display = { ...d.display, deadline: nowUnix() + 30 * 86400, on_silence: RESCUE_SENT_SILENCE };
      return transition(deal_id, 'AWAITING_APPROVAL', { paypal: { ...d.deal.paypal, order: invoice }, decided_by: { type: 'human', at: nowUnix() } });
    },
    open_paypal_in_browser: (args, opts) => {
      const { deal_id } = args;
      privileged(opts, deal_id);
      boundToChecks(args);
      const s = handlers.approval_summary({ deal_id });
      if (args.attempt !== s.attempt || JSON.stringify(args.terms_hash) !== JSON.stringify(s.terms_hash)) fail('INVALID', 'stale browser decision');
      const d = find(deal_id);
      if (d.deal.state !== 'AWAITING_APPROVAL' || d.deal.mode !== 'sandbox' || ['HOLD', 'BLOCK'].includes(d.deal.shield ?? '') || (d.display.deadline ?? 0) <= nowUnix()) fail('INVALID', 'browser approval is unavailable');
      // The real shell opens the core-verified link in the system browser. The mock does not
      // open anything that looks like PayPal; it only moves the Tumbler to its hand-off form.
      emit('tumbler:handoff', { deal_id, approve_until: d.display.deadline as number });
      emit('tumbler:form', 'handoff');
      return null;
    },
    set_credentials: (kind, opts) => {
      privileged(opts);
      // Real shell: a Rust-owned native dialog collects the secret. Nothing crosses IPC.
      state.credentialsStoredAt = { paypal_sandbox: state.credentialsStoredAt?.paypal_sandbox ?? null, channel3: state.credentialsStoredAt?.channel3 ?? null, [kind]: nowUnix() };
      state.settings = kind === 'channel3' ? { ...state.settings, channel3_configured: true } : { ...state.settings, payment_executor_configured: true };
      save();
      emit('settings:changed', state.settings);
      return null;
    },
    // Like the ledger's list_mandates: only active rows (superseded and revoked versions stay as history).
    mandate_list: () => state.mandates.filter((m) => activeMandate(m.payload.id) === m).map((m) => ({ ...m, agent: state.mandateSlots?.[m.payload.id] ?? 'negotiator' })),
    mandate_sign: (args, opts) => {
      privileged(opts);
      const id = args.id ?? fakeUlid(`M-${Date.now()}`);
      const prev = state.mandates.filter((m) => m.payload.id === id).reduce((v, m) => Math.max(v, m.payload.version), 0);
      const m = { payload: { id, version: prev + 1, agent_key: fakeHash(`agent:${args.agent}`) as unknown as (typeof state.mandates)[number]['payload']['agent_key'], clauses: args.clauses, not_before: args.not_before, expires: args.expires }, owner_sig: Array.from(fakeHash(`sig:${id}:${prev + 1}`)) };
      state.mandates = [...state.mandates, m];
      state.mandateSlots = { ...state.mandateSlots, [id]: args.agent };
      state.settings = { ...state.settings, first_run: false };
      save();
      emit('settings:changed', state.settings);
      return m;
    },
    mandate_revoke: ({ id }, opts) => {
      privileged(opts);
      // The ledger marks the active row revoked; it never deletes signed history.
      const m = activeMandate(id) ?? fail('NOT_FOUND', 'no active mandate with this id');
      state.revokedMandates = [...(state.revokedMandates ?? []), `${id}:${m.payload.version}`];
      save();
      return null;
    },
    band_set: ({ deal_id, ceiling, floor }, opts) => {
      privileged(opts, deal_id);
      const d = find(deal_id);
      // As Runtime::band: only an unsettled deal with no PayPal order; re-sign the deal's own
      // active mandate version with the band moved, then rebind the deal to the new version.
      if (!['PAIRING', 'LISTED', 'NEGOTIATING', 'AGREED'].includes(d.deal.state) || d.deal.paypal.order) fail('INVALID', 'the band can move only before settlement');
      const base = activeMandate(d.deal.mandate_id);
      if (!base || base.payload.version !== d.deal.mandate_version) fail('NOT_FOUND', 'the deal\'s mandate version is not active');
      let changed = false;
      const clauses = base.payload.clauses.map((c) => {
        if (c.type !== 'band' || !c.item_refs.includes(d.deal.terms.item_ref)) return c;
        changed = true;
        return { ...c, floor, ceiling };
      });
      if (!changed) fail('INVALID', 'no band clause covers this item');
      const version = state.mandates.filter((m) => m.payload.id === base.payload.id).reduce((v, m) => Math.max(v, m.payload.version), 0) + 1;
      const next = { payload: { ...base.payload, version, clauses }, owner_sig: Array.from(fakeHash(`sig:${base.payload.id}:${version}`)) };
      state.mandates = [...state.mandates, next];
      if (d.display.band) d.display = { ...d.display, band: { ...d.display.band, ceiling, floor } };
      transition(deal_id, d.deal.state, { mandate_version: version }, true);
      return next;
    },
    pairing_create: ({ side, payee }) => ({
      code: 'otter-basil-' + Math.floor(Math.random() * 9000 + 1000),
      bundle: { identity: { code_hash: fakeHash('code'), owner_key: fakeHash('owner') as never, agent_key: fakeHash('agent') as never, side, payee, expires: nowUnix() + 3600, in_reply_to: null }, owner_signature: [], agent_signature: [] },
    }),
    pairing_join: ({ code, side, payee }) => {
      if (code === 'HOUSE' && state.settings.house === 'unavailable') fail('UNAVAILABLE', 'this build has no HOUSE release pin');
      const result: ResultOf<'pairing_join'> = {
        house_table: code === 'HOUSE' ? { negotiation_deadline: nowUnix() + 3600, deal_id: fakeUlid('house-table'), terms: state.deals.find((d) => d.deal.id === fakeUlid('D-0201'))?.deal.terms ?? PRACTICE_TERMS, category: 'office' } : null,
        pairing_id: fakeHash(`pair:${code}`),
        words: ['otter', 'basil', 'quartz', 'meadow'],
        reply: { identity: { code_hash: fakeHash(code), owner_key: fakeHash('o2') as never, agent_key: fakeHash('a2') as never, side, payee, expires: nowUnix() + 3600, in_reply_to: fakeHash('code') }, owner_signature: [], agent_signature: [] },
      };
      state.pairingResults = { ...state.pairingResults, [code]: result };
      state.pendingPairings = [...(state.pendingPairings ?? []).filter((p) => JSON.stringify(p.pairing_id) !== JSON.stringify(result.pairing_id)), {
        pairing_id: result.pairing_id, words: result.words, house: code === 'HOUSE', expires: nowUnix() + 3600,
        display_context: code === 'HOUSE' ? 'House seller' : side === 'buyer' ? 'Pair with a seller' : 'Pair with a buyer',
      }];
      save();
      return result;
    },
    pairing_poll: ({ code }) => state.pairingResults?.[code] ?? null,
    // As Rust: aborting restricts, so no capability; the approval window may end only the pairing
    // it was opened for, by id. Idempotent once nothing is left.
    pairing_abort: ({ pairing_id, code }) => {
      if (!pairing_id === !code) fail('INVALID', 'abort by pairing id or by your own code, not both');
      if (label === 'approval' && (code || JSON.stringify(pairing_id) !== selectedPairing)) fail('PERMISSION', 'this approval window may abort only its own pairing');
      if (pairing_id) state.pendingPairings = state.pendingPairings?.filter((p) => JSON.stringify(p.pairing_id) !== JSON.stringify(pairing_id));
      if (code && state.pairingResults) {
        const gone = state.pairingResults[code];
        state.pairingResults = Object.fromEntries(Object.entries(state.pairingResults).filter(([c]) => c !== code));
        if (gone) state.pendingPairings = state.pendingPairings?.filter((p) => JSON.stringify(p.pairing_id) !== JSON.stringify(gone.pairing_id));
      }
      save();
      return null;
    },
    // No money, no pairing: wakes the hosted HOUSE (idle -> waking -> ready) as settings report.
    house_wake: () => {
      if (state.settings.house === 'unavailable') fail('UNAVAILABLE', 'HOUSE release identity is not pinned in this build');
      if (state.settings.house === 'waking') fail('UNAVAILABLE', 'House is already waking');
      state.settings = { ...state.settings, house: 'ready' };
      save();
      emit('settings:changed', state.settings);
      return 'ready';
    },
    pairing_confirm: ({ pairing_id, words, display_name }, opts) => {
      privileged(opts);
      const pending = state.pendingPairings?.find((p) => JSON.stringify(p.pairing_id) === JSON.stringify(pairing_id));
      if (!pending || pending.expires <= nowUnix() || JSON.stringify(pending.words) !== JSON.stringify(words) || !display_name || display_name.length > 32 || /[\x00-\x1f]/.test(display_name)) fail('INVALID', 'pairing words or context do not match');
      const key = 'kp_' + display_name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
      state.counterparties = [...state.counterparties, { key_id: key, display_name: /[:/@\\]/.test(display_name) ? 'Paired counterparty' : display_name, house: pending.house, first_seen: nowUnix(), deals_closed: 0,
        pairing: pending.house ? 'house_pinned' : 'words_confirmed', declared_payee: pending.house ? 'HOUSE' : null }];
      state.pendingPairings = state.pendingPairings?.filter((p) => p !== pending);
      if (pending.house) state.settings = { ...state.settings, house_connected: true };
      save();
      if (pending.house) emit('settings:changed', state.settings);
      emit('pairing:pinned', { pairing_id, key_id: key, house: pending.house });
      return key;
    },
    settings_write: (prefs) => {
      state.settings = { ...state.settings, preferences: prefs };
      save();
      emit('settings:changed', state.settings);
      return null;
    },
    deal_create: (_args, opts) => {
      privileged(opts);
      return fail('UNAVAILABLE', 'deal creation is wired in the mock only through the scripted demo');
    },
    deal_join: (_args, opts) => {
      privileged(opts);
      return fail('UNAVAILABLE', 'deal_join is not simulated in the browser mock');
    },
    quit_summary: () => {
      const pending = forecastDeals().filter((d) => quitPending(d.deal));
      const f = forecast();
      const lines = f ? mockQuitLines(pending, f) : { while_off: null, at_paypal: null };
      const shown = JSON.stringify([pending.map((d) => [d.deal.id, d.deal.state]), lines]);
      return { confirmation_id: fakeHash(`quit:${shown}`), pending: pending.map((d) => d.deal.id), on_quit: ON_QUIT, ...lines };
    },
    quit_confirm: ({ confirmation_id }) => {
      // Rust refuses a confirmation over deals or lines that changed since they were shown.
      if (JSON.stringify(handlers.quit_summary(null).confirmation_id) !== JSON.stringify(confirmation_id)) fail('INVALID', 'what the quit confirm showed has changed');
      return null;
    },
    // Safe projections generated from Rust (see lib/pending.ts).
    approval_selection: () => (degraded() ? pendingFail('approval_selection') : label === 'approval' ? selected : fail('PERMISSION', 'approval-only')),
    deal_display: ({ deal_id }) => (degraded() ? pendingFail('deal_display') : find(deal_id).display),
    deal_transcript: ({ deal_id }) => (degraded() ? pendingFail('deal_transcript') : find(deal_id).transcript),
    counterparty_list: () => (degraded() ? pendingFail('counterparty_list') : state.counterparties),
    // Untrusted words, as Rust returns them: latest signed NOTE, capped at 280 characters, main only.
    counterparty_note: ({ deal_id }) => {
      find(deal_id);
      const n = state.notes?.[deal_id];
      return n ? { ...n, text: [...n.text].slice(0, 280).join('') } : null;
    },
    // As Runtime::mandate_simulate: read-only, approval only, no token or unlock (it moves nothing).
    mandate_simulate: ({ draft, from, to }) => {
      const now = nowUnix();
      const end = to ?? now;
      const start = from ?? end - 7 * 86400;
      if (start > end || end - start > 31 * 86400) fail('INVALID', 'Invalid or stale wallet command');
      const prev = draft.id ? state.mandates.filter((m) => m.payload.id === draft.id).reduce((v, m) => Math.max(v, m.payload.version), 0) : 0;
      const payload: MandatePayload = { id: draft.id ?? fakeUlid('draft'), version: prev + 1, agent_key: fakeHash(`agent:${draft.agent}`) as unknown as MandatePayload['agent_key'], clauses: draft.clauses, not_before: draft.not_before, expires: draft.expires };
      const bad = mockValidate(payload);
      if (bad) fail('REFUSED', `mandate clause ${bad.clause}: ${bad.reason}`);
      const lines: SimulatedLine[] = [];
      let notSimulated = 0;
      for (const d of state.deals) {
        const deal = d.deal;
        const at = deal.created_at ?? 0;
        const inScope = draft.id ? deal.mandate_id === draft.id : (state.mandateSlots?.[deal.mandate_id] ?? null) === draft.agent;
        if (!inScope || (at !== 0 && (at < start || at > end))) continue;
        const category = state.categories?.[deal.id];
        const cp = state.counterparties.find((c) => c.key_id === deal.counterparty);
        let before: SimulatedVerdict = { type: 'not_simulated' };
        let after: SimulatedVerdict = { type: 'not_simulated' };
        if (category && cp && at !== 0) {
          const youRounds = d.transcript.filter((t) => t.by === 'you' && (t.typ === 'OFFER' || t.typ === 'COUNTER')).length;
          const intent: MockIntent = { deal, category, paired: cp.pairing !== 'unpaired', house: cp.house, declaredPayee: cp.declared_payee ?? null, roundsUsed: Math.max(0, youRounds - 1) };
          // Daily budget: deals of the same mandate that agreed earlier that UTC day (the mock keeps
          // no agreement order, so earlier-created deals past agreement stand in for it).
          const day = Math.floor(at / 86400);
          const earlier = state.deals.filter((o) => o.deal.id !== deal.id && o.deal.mandate_id === deal.mandate_id && (o.deal.created_at ?? 0) < at
            && Math.floor((o.deal.created_at ?? 0) / 86400) === day && !['PAIRING', 'LISTED', 'NEGOTIATING', 'REFUSED', 'WITHDRAWN', 'EXPIRED', 'VOIDED', 'AUTO_VOIDED'].includes(o.deal.state));
          const usage = { dealsToday: earlier.length, totalToday: earlier.reduce((t, o) => t + o.deal.terms.unit_price.minor * o.deal.terms.qty, 0) };
          const inForce = activeMandate(deal.mandate_id);
          before = inForce ? mockCheck(inForce.payload, intent, usage, now) : { type: 'refuse', clause: 1, reason: 'mandate is not active' };
          after = mockCheck(payload, intent, usage, now);
        } else notSimulated += 1;
        const t = deal.terms;
        const valid = t.qty > 0 && t.unit_price.minor > 0 && t.currency === t.unit_price.currency;
        lines.push({ deal_id: deal.id, label: d.display.label, title: d.display.title, item_ref: deal.terms.item_ref, kind: deal.kind, side: deal.side, at, amount: valid ? { minor: t.unit_price.minor * t.qty, currency: t.currency } : null, unit_price: t.unit_price, before, after });
      }
      lines.sort((a, b) => a.at - b.at || a.label.localeCompare(b.label));
      return { from: start, to: end, lines, not_simulated: notSimulated };
    },
    // As Runtime::sign_envelope: privileged like mandate_sign; an unusable limit set is REFUSED.
    envelope_sign: (args, opts) => {
      privileged(opts);
      const now = nowUnix();
      const bad = args.max_out_day.currency !== args.currency || args.max_held.currency !== args.currency ? 'currency differs across wallet limits'
        : args.max_out_day.minor <= 0 || args.max_held.minor <= 0 || args.max_deals_day <= 0 ? 'a wallet limit of zero allows nothing'
          : args.expires <= now ? 'expires: the wallet limits would already have run out' : null;
      if (bad) fail('REFUSED', `wallet limit ${bad}`);
      const version = (state.envelope?.payload.version ?? 0) + 1;
      const payload = { version, currency: args.currency, max_out_day: args.max_out_day, max_held: args.max_held, max_deals_day: args.max_deals_day, expires: args.expires };
      state.envelope = { payload, signedAt: now };
      save();
      emit('attention:changed', attention());
      return { payload, owner_sig: Array.from(fakeHash(`limits:${version}`)) };
    },
    // As Runtime::envelope_view: limits and numbers only, every window.
    envelope_get: () => exposureView(),
    // As Runtime::rescue_replay: approval only, privileged; a labelled REPLAY failure under the
    // latest signed fixes rule. Its one fix is computed here, never typed; the window is rebound to it.
    rescue_replay: (args, opts) => {
      privileged(opts);
      const m = rescueMandate();
      if (!m) fail('INVALID', RESCUE_NO_RULES);
      const email = args.subscriber_email.trim();
      if (!validEmail(email)) fail('INVALID', 'That is not an email address.');
      if (!validSubscriptionId(args.subscription_id)) fail('INVALID', 'That is not a PayPal subscription id.');
      if (args.amount.minor <= 0 || !args.plan.trim()) fail('INVALID', 'Invalid or stale wallet command');
      const lever = leverOf(m)!;
      const offer = proposeDiscount(args.amount, lever);
      if (!offer) fail('REFUSED', 'mandate clause 8: no discount your rules allow fits this renewal');
      const now = nowUnix();
      const label = `D-${String(300 + state.deals.length).padStart(4, '0')}`;
      const id = fakeUlid(`${label}:${now}`);
      const deal: Deal = {
        id, created_at: now, updated_at: now, kind: 'rescue', side: 'seller', counterparty: `sub:${args.subscription_id}`,
        terms: { item_ref: args.plan.trim(), qty: 1, unit_price: offer.invoice, currency: offer.invoice.currency, delivery: { type: 'digital_now' } },
        state: 'AGREED', mandate_id: m.payload.id, mandate_version: m.payload.version, transcript_head: fakeHash(`${id}:head`),
        paypal: { order: null, authorization: null, capture: null, subscription: args.subscription_id }, mode: 'replay', market: null, shield: null,
      };
      const deadline = now + 5 * 86400;
      state.deals.push({
        deal,
        display: { deal_id: id, label, title: `${args.plan.trim()} · replayed renewal`, deadline, on_silence: RESCUE_SILENCE, band: null },
        evidence: { deal_id: id, receipt: 'NONE', reconciliation: 'not_applicable', money_check: null },
        transcript: [],
        attention: { deal_id: id, label, kind: 'gate', module: 'rescue', headline: `Approve rescue lever ${formatMoney(offer.invoice)}`, counterparty: null, clause: null, urgency: 'calm',
          amount_minor: offer.invoice.minor, currency: offer.invoice.currency, mode: 'replay', deadline, on_silence: RESCUE_SILENCE, actions: ['review', 'withdraw', 'let_lapse', 'snooze30', 'open_in_table'], money_check: null },
      });
      const view: RescueView = { deal_id: id, source: 'replay', offer, text: invoiceText(offer), failed_payments: 1, next_retry_at: null, recipient: maskEmail(email), invoice: null, counted: false };
      state.rescue = { ...state.rescue, [id]: view };
      state.categories = { ...state.categories, [id]: 'service' };
      selected = id;
      save();
      emit('deal:changed', { deal, mode: deal.mode });
      emit('attention:changed', attention());
      setTimeout(() => deliver('approval:summary', handlers.approval_summary({ deal_id: id })), 0);
      return deal;
    },
    // As Runtime::rescue_book: every rescue case and the counted money, per currency.
    rescue_book: () => ({
      cases: state.deals.filter((d) => d.deal.kind === 'rescue').flatMap((d) => (state.rescue?.[d.deal.id] ? [state.rescue[d.deal.id]!] : [])),
      recovered: rescueRecovered(),
      watching: state.rescueWatches ?? [],
      watch_reads_today: state.rescueWatchReadsToday ?? 0,
      watch_reads_max: RESCUE_WATCH_READS_DAY,
    }),
    // As Runtime::open_group (T8): open buyer haggles for one item under one set of rules, one
    // table per seller, none holding our ACCEPT. Grouping only restricts; no money moves.
    deal_group_open: ({ deal_ids }) => {
      const tables = deal_ids.map(find);
      const first = tables[0]?.deal;
      const grouped = new Set(groups().flatMap((g) => g.deal_ids));
      const ok = !!first && tables.length >= 2 && tables.length <= 8
        && new Set(deal_ids).size === deal_ids.length && new Set(tables.map((d) => d.deal.counterparty)).size === tables.length
        && tables.every((d) => d.deal.side === 'buyer' && d.deal.kind === 'haggle' && ['PAIRING', 'LISTED', 'NEGOTIATING'].includes(d.deal.state)
          && !grouped.has(d.deal.id) && d.deal.mandate_id === first.mandate_id && d.deal.terms.item_ref === first.terms.item_ref && !acceptOut(d));
      if (!ok || !first) fail('INVALID', 'Invalid or stale wallet command');
      const g: MockGroup = { group_id: fakeUlid(`G:${deal_ids.join(',')}:${nowUnix()}`), item_ref: first.terms.item_ref, opened_at: nowUnix(), winner: null, deal_ids: [...deal_ids] };
      state.groups = [...(state.groups ?? []), g];
      save();
      for (const d of tables) emit('deal:changed', { deal: d.deal, mode: d.deal.mode });
      return groupView(g);
    },
    // As Runtime::group_views: every group, newest first, typed signed prices only.
    deal_groups: () => [...groups()].sort((a, b) => b.opened_at - a.opened_at).map(groupView),
    // As Runtime::rescue_watch_add: approval only, privileged, under signed rescue rules; at most
    // RESCUE_WATCH_MAX at once. Nothing is checked here (the mock never reads PayPal).
    rescue_watch_add: (args, opts) => {
      privileged(opts);
      if (!rescueMandate()) fail('INVALID', RESCUE_NO_RULES);
      const email = args.subscriber_email.trim();
      if (!validEmail(email)) fail('INVALID', 'That is not an email address.');
      const id = args.subscription_id.trim();
      if (!validSubscriptionId(id)) fail('INVALID', 'That is not a PayPal subscription id.');
      if (!/^[A-Za-z0-9\-_.:@+]{1,128}$/.test(args.plan)) fail('INVALID', 'Invalid or stale wallet command');
      const list = state.rescueWatches ?? [];
      const existing = list.find((w) => w.subscription_id === id);
      if (!existing && list.length >= RESCUE_WATCH_MAX) fail('INVALID', RESCUE_WATCH_FULL);
      const now = nowUnix();
      const view: RescueWatchView = existing
        ? { ...existing, recipient: maskEmail(email), plan: args.plan, next_read_at: now }
        : { subscription_id: id, recipient: maskEmail(email), plan: args.plan, state: 'waiting', added_at: now, last_read_at: null, next_read_at: now };
      state.rescueWatches = existing ? list.map((w) => (w.subscription_id === id ? view : w)) : [...list, view];
      save();
      return state.rescueWatches;
    },
    // As Runtime::rescue_watch_stop: approval only, privileged; a fix it already opened is unchanged.
    rescue_watch_stop: ({ subscription_id }, opts) => {
      privileged(opts);
      const list = state.rescueWatches ?? [];
      if (!list.some((w) => w.subscription_id === subscription_id.trim())) fail('INVALID', 'That subscription isn’t being watched.');
      state.rescueWatches = list.filter((w) => w.subscription_id !== subscription_id.trim());
      save();
      return state.rescueWatches;
    },
    // As Runtime::safety_record: main only, a read; counted from the same week deal_history serves.
    safety_record: () => safetyRecordOf(state, state.history ?? buildMockState(nowUnix()).history ?? [], nowUnix(), {
      broken: params.get('records') === 'broken', violation: params.get('safety') === 'violation',
    }),
  };

  // ---- the preview world (director and preview stage only; no money operation) ----------------
  const byLabel = (l: string) => state.deals.find((d) => d.display.label === l);
  function setOffset(seconds: number): void {
    setClockOffset(seconds);
    try {
      localStorage.setItem(CLOCK_KEY, String(clockOffset()));
    } catch {
      /* storage blocked: the channel still carries it to open windows */
    }
    channel?.postMessage({ kind: 'clock', offset: clockOffset() } satisfies Envelope);
  }
  function sweep(): string[] {
    const now = nowUnix();
    const lapsed: MockDeal[] = [];
    for (const d of state.deals) {
      const due = d.display.deadline;
      const to = ON_DEADLINE[d.deal.state];
      if (due === null || due > now || !to) continue;
      const from = d.deal.state;
      d.deal = { ...d.deal, state: to, updated_at: now, decided_by: { type: 'safe_default', deadline: due } };
      d.attention = null;
      const audit = state.audit ?? [];
      state.audit = [...audit, { seq: audit.length + 1, at: now, actor: 'policy', action: 'deal.transition', deal_id: d.deal.id, decided_by: d.deal.decided_by ?? null, from, to }];
      // The Rewind and "Who decided" read the same step Rust's deal_history would project.
      const history = state.history ?? buildMockState(nowUnix()).history ?? [];
      const kind = to === 'AUTO_VOIDED' ? 'auto_voided' : to === 'WITHDRAWN' ? 'lapsed' : 'expired';
      const paypal = to === 'AUTO_VOIDED' ? { type: 'call' as const, method: 'void' as const, outcome: 'ok' as const } : { type: 'none' as const };
      // The default cites the rungs recorded for this deadline (attention-ladder-1); it never waits on one.
      const rungs = (state.rungs ?? []).filter((r) => r.deal_id === d.deal.id && r.deadline === due).map((r) => r.mark);
      state.history = [...history, { at: now, deal_id: d.deal.id, seq: history.reduce((m, h) => Math.max(m, h.seq), 0) + 1, kind, state_after: to, authority: { type: 'safe_default' }, paypal, rungs }];
      lapsed.push(d);
    }
    if (lapsed.length) save();
    for (const d of lapsed) {
      emit('deal:changed', { deal: d.deal, mode: d.deal.mode });
      emit('receipt:created', { deal_id: d.deal.id, evidence: d.evidence, mode: d.deal.mode, state: d.deal.state, on_silence: DEADLINE_SILENCE });
    }
    emit('attention:changed', attention());
    return lapsed.map((d) => d.display.label);
  }
  const world: MockWorld = {
    deal: byLabel,
    attention,
    settings: () => ({ ...state.settings, locked: isLocked() }),
    setOffset,
    advance(seconds) {
      if (seconds > 0) setOffset(clockOffset() + Math.trunc(seconds));
      return sweep();
    },
    sweep,
    rewind(l, upTo, interim) {
      const d = byLabel(l) ?? fail('NOT_FOUND', `no deal ${l}`);
      const stash = (state.stash ??= {});
      const orig = (stash[l] ??= JSON.parse(JSON.stringify(d)) as MockDeal);
      const steps = orig.transcript.filter((t) => t.seq <= upTo);
      const full = steps.length >= orig.transcript.length;
      const priced = steps.filter((t) => t.price && t.typ !== 'SETTLE');
      const price = full ? orig.deal.terms.unit_price : priced[priced.length - 1]?.price ?? orig.deal.terms.unit_price;
      d.transcript = steps;
      d.deal = {
        ...d.deal,
        state: full ? orig.deal.state : interim?.state ?? orig.deal.state,
        shield: full ? orig.deal.shield : interim ? interim.shield : orig.deal.shield,
        terms: { ...d.deal.terms, unit_price: price },
        transcript_head: fakeHash(`${l}:head:${steps.length}`),
        updated_at: nowUnix(),
      };
      if (d.display.band) d.display = { ...d.display, band: { ...d.display.band, rounds_used: steps.filter((t) => t.by === 'you' && (t.typ === 'OFFER' || t.typ === 'COUNTER')).length } };
      d.attention = full ? orig.attention : null;
      save();
      emit('deal:changed', { deal: d.deal, mode: d.deal.mode });
      emit('attention:changed', attention());
    },
    reset(at) {
      setOffset(at === undefined ? 0 : at - (nowUnix() - clockOffset()));
      state = fresh();
      lastPrivileged = nowUnix();
      save();
    },
    emit,
  };

  // The approval window gets its summary pushed shortly after it opens, as the shell does.
  const opened = selected;
  if (label === 'approval' && opened) {
    setTimeout(() => {
      try {
        deliver('approval:summary', handlers.approval_summary({ deal_id: opened }));
      } catch {
        /* unknown deal in the URL: the page shows NOT_FOUND from its own fetch */
      }
    }, 120);
  }
  if (label === 'tumbler') void form;

  return {
    kind: 'mock',
    label,
    world,
    async invoke<K extends CommandName>(cmd: K, args: ArgsOf<K>, opts?: InvokeOptions): Promise<ResultOf<K>> {
      await new Promise((r) => setTimeout(r, 40)); // IPC is async; keep the UI honest about it
      gate(cmd, args, opts);
      const h = handlers[cmd] as (a: ArgsOf<K>, o?: InvokeOptions) => ResultOf<K>;
      return h(args, opts);
    },
    async listen<E extends EventName>(event: E, cb: (payload: PayloadOf<E>) => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(cb as (p: unknown) => void);
      listeners.set(event, set);
      return () => set.delete(cb as (p: unknown) => void);
    },
  };
}

/** Inject a Rust-shaped event into every open mock window (preview controls only). */
export function mockInject<E extends EventName>(event: E, payload: EventContract[E]): void {
  const env: Envelope = { kind: 'event', event, targets: TARGETS[event], payload };
  new BroadcastChannel(worldKeys(STORE_KEY, CHANNEL, firstRunPreview()).channel).postMessage(env);
}

/** Reset the shared mock world (used by the preview's "reset sample data" control). */
export function resetMockState(): void {
  try {
    localStorage.removeItem(worldKeys(STORE_KEY, CHANNEL, firstRunPreview()).store);
    localStorage.removeItem(CLOCK_KEY);
  } catch {
    /* storage blocked: nothing was stored either */
  }
}
