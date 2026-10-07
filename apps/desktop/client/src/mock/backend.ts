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
import type { AttentionSnapshot } from '@bindings/AttentionSnapshot';
import type { Deal } from '@bindings/Deal';
import type { DealState } from '@bindings/DealState';
import type { EventContract } from '@bindings/EventContract';
import type { Form } from '@bindings/Form';
import type { ArgsOf, Backend, CommandName, EventName, InvokeOptions, PayloadOf, ResultOf, WindowLabel } from '../lib/contract';
import { WalletError } from '../lib/contract';
import { nowUnix } from '../lib/format';
import { buildMockState, fakeHash, fakeUlid, type MockState } from './fixtures';

type Envelope = { kind: 'event'; event: EventName; targets: WindowLabel[]; payload: unknown } | { kind: 'state'; state: MockState };

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

export const STORE_KEY = 'the-table-mock-state-v5'; // v5: wave-0 port-gap facts (decided_by, …)
const DEGRADE_KEY = 'the-table-mock-degrade';
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
const ALL: WindowLabel[] = ['main', 'tumbler', 'approval'];
const ROUTE: WindowLabel[] = ['main', 'tumbler'];
const REVIEW: WindowLabel[] = ['main', 'approval'];
const GATES: Record<CommandName, WindowLabel[]> = {
  get_settings: ALL, attention_list: ALL, deal_withdraw: ALL, deal_display: ALL,
  list_deals: ['main'], get_deal: ['main'], deal_evidence: ['main'], deal_reconcile: ['main'], engine_status: ['main'],
  engine_select: ['main'], agent_start: ['main'], agent_runs: ['main'], resume_all_agents: ['main'],
  pairing_create: ['main'], pairing_join: ['main'], pairing_poll: ['main'],
  main_open: ROUTE, approval_open: ROUTE, settings_write: ROUTE, pause_all_agents: ROUTE,
  deal_let_lapse: ROUTE, quit_summary: ROUTE, quit_confirm: ROUTE,
  mandate_list: REVIEW, counterparty_list: REVIEW, deal_transcript: REVIEW, counterparty_note: ['main'], house_wake: ['main'], pairing_abort: ['main', 'approval'], approval_handoff: ['approval'], audit_page: ['main'], owner_facts: REVIEW, book_query: ['main'], deal_export_proof: REVIEW, proof_check: ['main'], deal_history: ['main'],
  tumbler_set_form: ['tumbler'], tumbler_pin: ['tumbler'], tumbler_drag: ['tumbler'], tumbler_snap: ['tumbler'], deal_snooze: ['tumbler'],
  market_refresh: ['approval'], approval_selection: ['approval'], approval_pairing: ['approval'], approval_summary: ['approval'],
  approval_token: ['approval'], unlock: ['approval'], deal_owner_accept: ['approval'], deal_countersign: ['approval'],
  deal_capture: ['approval'], deal_void: ['approval'], shield_release: ['approval'], rescue_approve: ['approval'],
  open_paypal_in_browser: ['approval'], set_credentials: ['approval'], mandate_sign: ['approval'], mandate_revoke: ['approval'],
  band_set: ['approval'], pairing_confirm: ['approval'], deal_create: ['approval'], deal_join: ['approval'],
};

function fail(code: WalletError['code'], message: string): never {
  throw new WalletError({ code, message });
}

export function mockBackend(label: WindowLabel): Backend {
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('the-table-mock') : null;
  const listeners = new Map<EventName, Set<(p: unknown) => void>>();
  let state: MockState = load() ?? buildMockState(nowUnix());
  let lastPrivileged = nowUnix();
  let form: Form = state.settings.preferences.form;
  const params = new URLSearchParams(location.search);
  const selected: string | null = label === 'approval' ? params.get('deal') : null;
  const selectedPairing = label === 'approval' ? params.get('pairing') : null;

  function load(): MockState | null {
    try {
      const raw = sessionStorage.getItem(STORE_KEY) ?? localStorage.getItem(STORE_KEY);
      return raw ? (JSON.parse(raw) as MockState) : null;
    } catch {
      return null;
    }
  }
  function save(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
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
    return { view: o.view as BookView, metrics: metrics as BookQuery['metrics'], filters: filters as BookQuery['filters'], group_by: group_by as BookQuery['group_by'], range: (o.range ?? null) as BookQuery['range'], limit };
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
  const attention = (): AttentionSnapshot => {
    const items = state.deals
      .map((d) => d.attention)
      .filter((a): a is NonNullable<typeof a> => a !== null)
      .filter((a) => (label === 'approval' ? a.deal_id === selected : true))
      .filter((a) => a.kind !== 'gate' || (state.snoozed?.[a.deal_id] ?? 0) <= nowUnix() || (a.deadline ?? Infinity) - nowUnix() <= 900)
      .map((a) => {
        const left = a.deadline === null ? Infinity : a.deadline - nowUnix();
        return { ...a, urgency: left <= 15 * 60 ? ('now' as const) : left <= 2 * 3600 ? ('soon' as const) : ('calm' as const) };
      })
      .sort((x, y) => (x.deadline ?? Infinity) - (y.deadline ?? Infinity));
    return {
      items,
      stopped_today: state.stoppedToday,
      in_motion: state.inMotion,
      wallet_spend_today_minor: state.walletSpendTodayMinor,
      wallet_spend_today_currency: 'USD',
      engine_estimate_today_usd: state.engineEstimateTodayUsd,
      locked: isLocked(),
    };
  };
  // ?locked=1 starts the window idle-locked, for screenshots of the LOCKED states.
  const forceLocked = params.get('locked') === '1';
  const isLocked = () => forceLocked || state.settings.locked || nowUnix() - lastPrivileged > IDLE_LOCK_SECONDS;

  /** The real shell's privileged gate: approval label AND token AND unlocked AND selected. */
  function privileged(opts: InvokeOptions | undefined, dealId?: string): void {
    if (label !== 'approval') fail('PERMISSION', 'privileged commands run only in the approval window');
    if (opts?.token !== TOKEN) fail('PERMISSION', 'missing approval capability');
    if (isLocked()) fail('LOCKED', 'idle for more than 15 minutes · unlock with Windows Hello');
    if (dealId !== undefined && dealId !== selected) fail('PERMISSION', 'this approval window is bound to another deal');
    lastPrivileged = nowUnix();
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
  function openWindow(page: string, name: string, features?: string): void {
    window.open(page, name, features);
  }

  const handlers: { [K in CommandName]: (args: ArgsOf<K>, opts?: InvokeOptions) => ResultOf<K> } = {
    get_settings: () => ({ ...state.settings, locked: isLocked() }),
    list_deals: () => state.deals.map((d) => d.deal),
    get_deal: ({ deal_id }) => find(deal_id).deal,
    deal_evidence: ({ deal_id }) => find(deal_id).evidence,
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
      state.settings = { ...state.settings, selected_engine: engine };
      save();
      emit('settings:changed', state.settings);
      return null;
    },
    agent_start: ({ deal_id }) => {
      const run = { run: fakeUlid(`run:${deal_id}:${Date.now()}`), deal_id, engine: state.settings.selected_engine, mode: 'scripted_engine' as const, state: 'running' as const };
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
    market_refresh: ({ deal_id }, opts) => {
      privileged(opts, deal_id);
      const d = find(deal_id);
      return d.deal.market ?? fail('UNAVAILABLE', 'no market reference for this item');
    },
    attention_list: () => attention(),
    main_open: ({ deal_id }) => {
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
      } else if (deal_id) find(deal_id);
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
          case 'state': return d.state;
          case 'counterparty': return d.counterparty;
          case 'decided_by': return d.decided_by ? JSON.stringify(d.decided_by) : null;
          case 'amount': return d.terms.unit_price.minor * d.terms.qty;
          case 'created_at': return d.created_at ?? null;
          case 'vs_market_pct': return d.market && d.market.median.minor ? Math.trunc(((d.terms.unit_price.minor - d.market.median.minor) * 10000) / d.market.median.minor) : null;
          case 'day': return d.created_at ? new Date(d.created_at * 1000).toISOString().slice(0, 10) : null;
          default: return null;
        }
      };
      const keep = (d: Deal) => q.filters.every((f) => {
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
        const row: Record<string, unknown> = { currency: m.terms.currency, mode: m.mode };
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
          if (m === 'recovered_sum') out.recovered_sum = ds.filter((d) => d.kind === 'rescue' && ['CAPTURED', 'RECEIPTED'].includes(d.state) && d.mode === 'sandbox').reduce((s, d) => s + d.terms.unit_price.minor * d.terms.qty, 0);
        }
        return out as JsonValue;
      });
      return { query: q, rows };
    },
    // As Runtime::audit_page: newest first, `before` exclusive, 1..=200, closed facts only.
    audit_page: ({ before, limit }) => {
      if (limit < 1 || limit > 200) fail('INVALID', 'limit is 1 to 200');
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
      return {
        deal: d.deal,
        evidence: d.evidence,
        attempt: 1,
        terms_hash: fakeHash(`${deal_id}:terms`),
        counter_hash: d.transcript.some((s) => s.by === 'them' && s.typ === 'COUNTER') ? fakeHash(`${deal_id}:counter:${d.transcript.length}`) : null,
        can_owner_accept: !locked && d.deal.side === 'buyer' && d.deal.kind === 'haggle' && d.deal.state === 'NEGOTIATING'
          && !shieldStops && d.deal.mode === 'sandbox' && (d.display.deadline ?? 0) > nowUnix()
          && d.transcript.some((s) => s.by === 'them' && s.typ === 'COUNTER')
          && !d.transcript.some((s) => s.by === 'you' && s.typ === 'ACCEPT') && ownerMandateAllows(d),
        locked,
        can_release: !locked && state.settings.payment_executor_configured && !buyerHaggle && d.deal.shield !== 'BLOCK' && d.deal.state !== 'MISMATCH',
        can_open_paypal: !locked && d.deal.state === 'AWAITING_APPROVAL' && !shieldStops,
        unavailable_reason: d.deal.kind === 'rescue'
          ? 'rescue executor not attached yet (P3)'
          : buyerHaggle
            ? 'buyer haggle resources belong to the seller · you approve on PayPal and accept the signed receipt'
            : null,
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
      if (d.attention?.kind !== 'gate' || (d.attention.deadline ?? 0) - nowUnix() <= 2700) fail('INVALID', 'snooze requires a gate more than 45 minutes away');
      state.snoozed = { ...state.snoozed, [deal_id]: nowUnix() + 1800 };
      save();
      emit('attention:changed', attention());
      return null;
    },
    deal_owner_accept: (args, opts) => {
      privileged(opts, args.deal_id);
      const d = find(args.deal_id);
      const s = handlers.approval_summary({ deal_id: args.deal_id });
      if (args.attempt !== s.attempt || JSON.stringify(args.terms_hash) !== JSON.stringify(s.terms_hash)
        || !args.counter_hash || JSON.stringify(args.counter_hash) !== JSON.stringify(s.counter_hash)) fail('INVALID', 'stale decision');
      if (!s.can_owner_accept || !ownerMandateAllows(d)) fail('PERMISSION', 'owner accept is unavailable');
      d.transcript.push({ seq: d.transcript.length + 1, by: 'you', typ: 'ACCEPT', price: null, at: nowUnix(), verified: true });
      return transition(args.deal_id, d.transcript.some((s) => s.by === 'them' && s.typ === 'ACCEPT') ? 'AGREED' : 'NEGOTIATING', { decided_by: { type: 'human', at: nowUnix() } });
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
    deal_countersign: ({ deal_id }, opts) => {
      privileged(opts, deal_id);
      const d = find(deal_id);
      if (!['AGREED', 'APPROVED'].includes(d.deal.state)) fail('INVALID', `cannot countersign in ${d.deal.state}`);
      return transition(deal_id, 'AWAITING_APPROVAL', { paypal: { ...d.deal.paypal, order: '7XK' + deal_id.slice(-5) }, decided_by: { type: 'human', at: nowUnix() } }, true);
    },
    deal_capture: ({ deal_id }, opts) => {
      privileged(opts, deal_id);
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
      if (find(deal_id).deal.state !== 'AUTHORIZED') fail('INVALID', 'only an authorization can be voided');
      return transition(deal_id, 'VOIDED', { decided_by: { type: 'human', at: nowUnix() } });
    },
    shield_release: ({ deal_id }, opts) => {
      privileged(opts, deal_id);
      const d = find(deal_id);
      if (d.deal.shield === 'BLOCK') fail('PERMISSION', 'a BLOCK cannot be released');
      return transition(deal_id, d.deal.state, { shield: 'ASK' });
    },
    rescue_approve: (args, opts) => {
      privileged(opts, args.deal_id);
      return fail('UNAVAILABLE', 'rescue executor not attached yet (P3) · no fake mutation');
    },
    open_paypal_in_browser: (args, opts) => {
      const { deal_id } = args;
      privileged(opts, deal_id);
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
        house_table: code === 'HOUSE' ? { negotiation_deadline: nowUnix() + 3600, deal_id: fakeUlid('house-table'), terms: find(fakeUlid('D-0201')).deal.terms, category: 'office' } : null,
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
      save();
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
    quit_summary: () => ({ confirmation_id: fakeHash('quit'), pending: attention().items.map((i) => i.deal_id), on_quit: 'While the wallet is closed: agents stop, nothing is polled, nothing is paid. PayPal-side windows still run out on their own - an unapproved order expires, an authorization lapses - and none of that moves money.' }),
    quit_confirm: () => null,
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
  };

  // The approval window gets its summary pushed shortly after it opens, as the shell does.
  if (label === 'approval' && selected) {
    setTimeout(() => {
      try {
        deliver('approval:summary', handlers.approval_summary({ deal_id: selected }));
      } catch {
        /* unknown deal in the URL: the page shows NOT_FOUND from its own fetch */
      }
    }, 120);
  }
  if (label === 'tumbler') void form;

  return {
    kind: 'mock',
    label,
    async invoke<K extends CommandName>(cmd: K, args: ArgsOf<K>, opts?: InvokeOptions): Promise<ResultOf<K>> {
      await new Promise((r) => setTimeout(r, 40)); // IPC is async; keep the UI honest about it
      if (!GATES[cmd].includes(label)) fail('PERMISSION', `${cmd} is not available to ${label}`);
      if (label === 'approval' && ['deal_display', 'deal_transcript'].includes(cmd)) {
        if ((args as ArgsOf<'deal_display'>).deal_id !== selected) fail('PERMISSION', 'not the selected deal');
      }
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
  new BroadcastChannel('the-table-mock').postMessage(env);
}

/** Reset the shared mock world (used by the preview's "reset sample data" control). */
export function resetMockState(): void {
  localStorage.removeItem(STORE_KEY);
}
