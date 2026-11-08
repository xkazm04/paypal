// The board's model: everything the Switchboard shows, derived in one pure function (boardFromWorld)
// from what the World already reads, plus the hook that gathers the inputs. Read-only; nothing here
// can move money, and no counterparty free text enters the model (deal labels come from deal_display,
// which carries none).
//
// THE FATE OF A DEAL (the one mapping, `fateOf`; tests/useBoardModel.test.ts walks it over the mock world):
//
//   needs    the deal has an attention item of kind `gate` or `hold` (the wallet is waiting for the owner).
//            This wins over everything else: a deal the owner must look at is never filed as stopped.
//   stopped  beadKind says `stopped` or `off`: refused, mismatch, dispute, failed, unconfirmed, blocked by
//            the scam shield, withdrawn, lapsed (expired), voided, auto-voided, refunded.
//   paid     beadKind says `settled`: PayPal confirmed the money (a buyer's receipt that is only the
//            seller's word is NOT paid: it stays `moving` and reads "Seller says paid").
//   moving   everything else in motion, including money held at PayPal (that is a gauge on the strip, not
//            a column) and a seller-attested receipt waiting for PayPal's statement.
//
// Absent values are `null` and drawn dashed ("not available yet"); never 0, never green.
import { useMemo } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import type { ExposureView } from '@bindings/ExposureView';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import type { Module } from '@bindings/Module';
import type { SafetyRecord } from '@bindings/SafetyRecord';
import { FATES, MODULE_KEYS, type BoardDeal, type BoardMoney, type BoardSetupStep, type DigestInput, type Fate } from '../../../lib/assistant';
import { clockNow } from '../../../lib/clock';
import { rulesInForce, type GettingStarted } from '../../../lib/firstRun';
import { useQuery } from '../../../lib/hooks';
import { meterRow, readLimits, type LimitsReading } from '../../../lib/limits';
import { BOARD_FATE, stateWord } from '../../../lib/words';
import { beadKind, dealTotal, isSettled } from '../logic';
import { releasable } from '../modules/shield/matrix';
import { useStart } from '../setup/start';
import { useAttention, useDeals, useNeeds, useSettings, useWorldSelector, type World } from '../world';

// ---- the fate -------------------------------------------------------------------------------

/** The column a deal sits in. `need` is its attention item, if it has one. See the table above. */
export function fateOf(deal: Deal, need?: Pick<AttentionItem, 'kind'> | null): Fate {
  if (need && (need.kind === 'gate' || need.kind === 'hold')) return 'needs';
  const bead = beadKind(deal);
  if (bead === 'stopped' || bead === 'off') return 'stopped';
  if (bead === 'settled') return 'paid';
  return 'moving';
}

// ---- types ----------------------------------------------------------------------------------

/** A deal as one key on the board: the contract's BoardDeal plus what only the board draws. */
export type BoardKey = BoardDeal & {
  /** What the deal is, in the owner's words (deal_display title). */
  title: string;
  /** The deal's deadline in Unix seconds (needs-you keys only), else null. */
  deadline_s: number | null;
  /** When the deal last changed (Unix seconds), else null. */
  stamp_s: number | null;
  /** Buyer or seller side, for the words. */
  side: Deal['side'];
  /** Why it needs the owner (the attention headline, in plain words); needs-you keys only. */
  why: string | null;
  /** The approval window can take this deal: it needs the owner and offers a review, or is a live scam-check
   *  pause the owner may release there; never a closed mismatch (the console's own rule, Decision.tsx). */
  review: boolean;
};

export type BoardCell = { module: Module; fate: Fate; keys: BoardKey[]; count: number; soonest_s: number | null };
export type BoardWeek = { days: number[]; total: number; today: number };

export type BoardInstruments = {
  limits: LimitsReading | null;
  /** The currency of the money numbers; null when unknown or mixed. */
  currency: string | null;
  room_left_minor: number | null;
  day_cap_minor: number | null;
  out_today_minor: number | null;
  deals_today: number | null;
  deals_cap: number | null;
  held_at_paypal_minor: number | null;
  held_before_minor: number | null;
  held_cap_minor: number | null;
  paid_out_minor: number | null;
  paid_in_minor: number | null;
  /** intact | broken | null (not read / not available). */
  records: 'intact' | 'broken' | null;
  records_count: number | null;
};

export type BoardModel = {
  ready: boolean;
  firstRun: boolean;
  keys: BoardKey[];
  byId: ReadonlyMap<string, BoardKey>;
  cells: Record<Module, Record<Fate, BoardCell>>;
  rowCount: Record<Module, number>;
  colCount: Record<Fate, number>;
  week: Record<Module, BoardWeek>;
  money: BoardMoney;
  instruments: BoardInstruments;
  setup: BoardSetupStep[];
  rulesInForce: number | null;
  digest: DigestInput;
  deals: BoardDeal[];
};

export type BoardInputs = {
  ready: boolean;
  deals: readonly Deal[];
  needs: readonly Pick<AttentionItem, 'deal_id' | 'kind' | 'deadline' | 'on_silence' | 'amount_minor' | 'currency' | 'headline' | 'actions'>[];
  display: (d: Deal) => { label: string; title: string };
  moduleOfDeal: (d: Deal) => Module;
  exposure: ExposureView | null | undefined;
  nowSec: number;
  rulesInForce: number | null;
  gs: GettingStarted | null;
  safety: Pick<SafetyRecord, 'intact' | 'records'> | null | undefined;
};

const stamp = (d: Deal): number | null => d.updated_at ?? d.created_at ?? null;

/** Local midnights of the seven days of the current Monday-to-Sunday week, then the next Monday. */
export function weekDayEdges(nowSec: number): number[] {
  const d = new Date(nowSec * 1000);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return Array.from({ length: 8 }, (_, i) => Math.floor(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i).getTime() / 1000));
}

function weekOf(keys: readonly BoardKey[], edges: readonly number[], nowSec: number): BoardWeek {
  const days = new Array<number>(7).fill(0);
  for (const k of keys) {
    const t = k.stamp_s;
    if (t === null || t < edges[0]! || t >= edges[7]!) continue;
    const i = edges.findIndex((e, j) => j < 7 && t >= e && t < edges[j + 1]!);
    if (i >= 0) days[i]! += 1;
  }
  const today = Math.max(0, edges.findIndex((e, j) => j < 7 && nowSec >= e && nowSec < edges[j + 1]!));
  return { days, total: days.reduce((a, b) => a + b, 0), today };
}

/** Needs-you keys: soonest deadline first, no deadline last. Others: most recent first. */
const byUrgency = (a: BoardKey, b: BoardKey): number =>
  (a.deadline_s ?? Infinity) - (b.deadline_s ?? Infinity) || (b.stamp_s ?? 0) - (a.stamp_s ?? 0) || a.label.localeCompare(b.label);
const byRecent = (a: BoardKey, b: BoardKey): number => (b.stamp_s ?? 0) - (a.stamp_s ?? 0) || a.label.localeCompare(b.label);

const emptyCells = (): Record<Module, Record<Fate, BoardCell>> =>
  Object.fromEntries(MODULE_KEYS.map((m) => [m, Object.fromEntries(FATES.map((f) => [f, { module: m, fate: f, keys: [], count: 0, soonest_s: null }]))])) as unknown as Record<Module, Record<Fate, BoardCell>>;

export function boardFromWorld(i: BoardInputs): BoardModel {
  const needOf = new Map(i.needs.map((n) => [n.deal_id, n]));
  const keys: BoardKey[] = i.deals.map((d) => {
    const need = needOf.get(d.id);
    const fate = fateOf(d, need);
    const disp = i.display(d);
    const total = dealTotal(d);
    return {
      id: d.id,
      module: i.moduleOfDeal(d),
      fate,
      label: disp.label,
      title: disp.title,
      state_word: fate === 'needs' ? BOARD_FATE.needs.word : stateWord(d.state, { side: d.side, kind: d.kind }).text,
      amount_minor: need && fate === 'needs' ? need.amount_minor : total.minor,
      currency: need && fate === 'needs' ? need.currency : total.currency,
      deadline_ms: fate === 'needs' && need?.deadline != null ? need.deadline * 1000 : null,
      on_silence: fate === 'needs' ? need?.on_silence ?? null : null,
      deadline_s: fate === 'needs' && need?.deadline != null ? need.deadline : null,
      stamp_s: stamp(d),
      side: d.side,
      why: fate === 'needs' ? need?.headline ?? null : null,
      review: fate === 'needs' && d.state !== 'MISMATCH' && (!!need?.actions.includes('review') || releasable(d)),
    };
  });

  const cells = emptyCells();
  for (const k of keys) cells[k.module][k.fate].keys.push(k);
  const rowCount = Object.fromEntries(MODULE_KEYS.map((m) => [m, 0])) as Record<Module, number>;
  const colCount = Object.fromEntries(FATES.map((f) => [f, 0])) as Record<Fate, number>;
  for (const m of MODULE_KEYS) {
    for (const f of FATES) {
      const c = cells[m][f];
      c.keys.sort(f === 'needs' ? byUrgency : byRecent);
      c.count = c.keys.length;
      c.soonest_s = c.keys.reduce<number | null>((s, k) => (k.deadline_s !== null && (s === null || k.deadline_s < s) ? k.deadline_s : s), null);
      rowCount[m] += c.count;
      colCount[f] += c.count;
    }
  }

  const edges = weekDayEdges(i.nowSec);
  const week = Object.fromEntries(MODULE_KEYS.map((m) => [m, weekOf(keys.filter((k) => k.module === m), edges, i.nowSec)])) as Record<Module, BoardWeek>;

  // ---- money ----
  const limits = readLimits(i.exposure);
  const row = i.exposure ? meterRow(i.exposure) : null;
  const cap = i.exposure?.status === 'active' ? i.exposure.limits ?? null : null;
  const currency = row?.currency ?? null;
  const out = row ? row.out_today.minor : null;
  const paidIn = (() => {
    if (!currency) return null;
    const seller = i.deals.filter((d) => d.side === 'seller' && isSettled(d) && dealTotal(d).currency === currency);
    return seller.reduce((s, d) => s + dealTotal(d).minor, 0);
  })();
  const money: BoardMoney = {
    room_left_minor: cap && out !== null ? Math.max(0, cap.max_out_day.minor - out) : null,
    day_cap_minor: cap ? cap.max_out_day.minor : null,
    held_minor: row ? row.held.minor + row.committed.minor : null,
    paid_today_minor: row ? row.paid_today.minor : null,
    deals_today: row ? row.deals_today : null,
    deals_cap: cap ? cap.max_deals_day : null,
    currency,
  };
  const instruments: BoardInstruments = {
    limits,
    currency,
    room_left_minor: money.room_left_minor,
    day_cap_minor: money.day_cap_minor,
    out_today_minor: out,
    deals_today: money.deals_today,
    deals_cap: money.deals_cap,
    held_at_paypal_minor: row ? row.held.minor : null,
    held_before_minor: row ? row.committed.minor : null,
    held_cap_minor: cap ? cap.max_held.minor : null,
    paid_out_minor: money.paid_today_minor,
    paid_in_minor: paidIn,
    records: i.safety ? (i.safety.intact ? 'intact' : 'broken') : null,
    records_count: i.safety ? i.safety.records : null,
  };

  const setup: BoardSetupStep[] = (i.gs?.steps ?? []).map((s) => ({ key: s.key, done: s.state === 'done' ? true : s.state === 'unknown' ? null : false }));
  const firstRun = i.gs?.show === true;
  const deals: BoardDeal[] = keys.map(({ id, module, fate, label, state_word, amount_minor, currency: cur, deadline_ms, on_silence }) => ({ id, module, fate, label, state_word, amount_minor, currency: cur, deadline_ms, on_silence }));
  const digest: DigestInput = { now_ms: i.nowSec * 1000, first_run: firstRun, deals, money, rules_in_force: i.rulesInForce, setup };
  return { ready: i.ready, firstRun, keys, byId: new Map(keys.map((k) => [k.id, k])), cells, rowCount, colCount, week, money, instruments, setup, rulesInForce: i.rulesInForce, digest, deals };
}

// ---- the hook -------------------------------------------------------------------------------

const NO_DEALS: readonly Deal[] = [];
const NO_MANDATES: readonly MandateListEntry[] | undefined = undefined;
const selDisplay = (w: World) => w.display;
const selModuleOf = (w: World) => w.moduleOfDeal;
const selReady = (w: World) => w.ready;

/** The board's model from the World (deals, needs, displays), the exposure fold, the signed rules, the
 *  getting-started steps and the safety record. Recomputes when one of those changes, not on a clock tick. */
export function useBoardModel(): BoardModel {
  const deals = useDeals().data ?? NO_DEALS;
  const needs = useNeeds();
  const display = useWorldSelector(selDisplay);
  const moduleOfDeal = useWorldSelector(selModuleOf);
  const ready = useWorldSelector(selReady);
  const exposure = useAttention().data?.exposure;
  const settings = useSettings().data;
  const gs = useStart();
  const mandates = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  const safety = useQuery('safety_record', null);
  const mdata = mandates.data ?? NO_MANDATES;
  const sdata = safety.data;
  return useMemo(() => {
    const nowSec = clockNow();
    return boardFromWorld({
      ready: ready && !!settings,
      deals, needs, display, moduleOfDeal, exposure, nowSec,
      rulesInForce: mdata ? rulesInForce(mdata, nowSec) : null,
      gs, safety: sdata,
    });
  }, [ready, settings, deals, needs, display, moduleOfDeal, exposure, mdata, gs, sdata]);
}

