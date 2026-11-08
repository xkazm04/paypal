// spark abstract-first-home round 2: the six module lists, pure. Each module lists its OWN kind of item
// with its OWN key metadata, one line per item, cut from the same model functions its console page
// uses (so a row never says something its page would not):
//
//   tables   haggles            Offer (the attention amount, else the deal total) | Your limit (the signed
//                               fence, deal_display.band) | Time (time left, else the state word)
//   spend    agent purchases    Amount | Verdict (gate.ts outcomeOf / ruleLine: Paid, On hold, Refused,
//                               Asks you); the rule line is the sub
//   counter  live orders, then  Price | vs usual (counter model vsMarket) | Now (open orders on the item,
//            catalog items      or the order's state); catalog rows are non-deal rows `cat:<item_ref>`
//   book     every payment      Amount, signed (out −, in +) | Where (book model bucketOf); title = who
//   shield   checked payments   Amount | Verdict (shield word) | Why (the rule the core recorded, else
//                               the facts reasonsFor reads); title = who
//   rescue   failed renewals    At risk (atRiskOf: the missed cycle) | Next (PayPal's next retry, or the
//                               outcome)
//
// Sorting (ModuleList contract): needs by deadline, then moving, stopped, paid; newest first within a
// fate; non-deal rows after deal rows. Fate is the board's one mapping (useBoardModel fateOf).
// No React, no IO: the hook (useModuleLists.ts) gathers the inputs. Money only through lib/format.
import type { AttentionItem } from '@bindings/AttentionItem';
import type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
import type { Deal } from '@bindings/Deal';
import type { DealDisplay } from '@bindings/DealDisplay';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import type { Money } from '@bindings/Money';
import type { Module } from '@bindings/Module';
import type { RescueBook } from '@bindings/RescueBook';
import { MODULE_KEYS, type Fate } from '../../../../lib/assistant/contract';
import { shortId, shortMoney } from '../../../../lib/format';
import { BOARD_FATE, headlineWords, houseWords, SHIELD, shieldRuleWord, shieldWord, SPEND, stateWord, subscriberName, TABLES, tablesShortWho } from '../../../../lib/words';
import { shortTitle, silenceParts, timeLeft } from '../model';
import { dealTotal, isLive, mandatesGoverning } from '../../logic';
import { BUCKET_LABEL, bucketOf, dirOf, type Bucket } from '../../modules/book/model';
import { buildCatalog, itemName, sellerMandates, vsMarket, type CatalogRow } from '../../modules/counter/model';
import { atRiskOf, isFailing, isReplay, isRescueDeal, paypalRetry, retryLeft, viewFor } from '../../modules/rescue/model';
import { reasonsFor, shieldNeed } from '../../modules/shield/matrix';
import { gateColumns, laneCells, outcomeOf, ruleLine, type GateColumn, type RuleLine } from '../../modules/spend/gate';
import { bandOf, fenceKey, fits } from '../../modules/tables/ladder';
import { shieldSets } from '../../console/areas/shield/model';
import { fateOf } from '../../switchboard/useBoardModel';
import type { CellTone, ModuleList, ModuleRow, RowCell } from './rows';
import { ROWS, ROWS_COLUMNS, ROWS_EMPTY } from './words';

export type Who = { name: string; house: boolean; known: boolean; entry?: CounterpartyDisplay };

/** counterparty_list as a lookup, worded exactly as lib/display useCounterparties words it (house
 *  name, subscriber, else the short key id). Pure, so the hook and the tests share it. */
export function whoFrom(list: readonly CounterpartyDisplay[] | null | undefined): (key: string) => Who {
  const map = new Map((list ?? []).map((c) => [c.key_id, c]));
  return (key) => {
    const c = map.get(key);
    return c ? { name: c.house ? houseWords(c.display_name) : c.display_name, house: c.house, known: true, entry: c } : { name: subscriberName(key) ?? shortId(key), house: false, known: false };
  };
}

/** What the lists are cut from: the World's deals, needs and displays, plus the three reads the module
 *  pages use for their own columns (mandate_list, counterparty_list via `who`, rescue_book). */
export type ListInputs = {
  deals: readonly Deal[];
  needs: readonly AttentionItem[];
  display: (d: Deal) => Pick<DealDisplay, 'title' | 'deadline' | 'band'>;
  moduleOfDeal: (d: Deal) => Module;
  who: (key: string) => Who;
  /** mandate_list, or null while it is not read (spend and counter then say less, never guess). */
  mandates: readonly MandateListEntry[] | null;
  rescue: Pick<RescueBook, 'cases'> | null;
  nowSec: number;
};

// ---- shared ---------------------------------------------------------------------------------

type Ctx = ListInputs & { needOf: ReadonlyMap<string, AttentionItem> };
/** A row plus what only the sort needs. */
type Item = { row: ModuleRow; stamp: number; order: number };

const FATE_ORDER: Record<Fate, number> = { needs: 0, moving: 1, stopped: 2, paid: 3 };
const stampOf = (d: Deal): number => d.updated_at ?? d.created_at ?? 0;
const money = (m: Money): string => shortMoney(m.minor, m.currency);
const num = (text: string, tone?: CellTone): RowCell => (tone ? { text, num: true, tone } : { text, num: true });
const word = (text: string, tone?: CellTone): RowCell => (tone ? { text, tone } : { text });
const NONE: RowCell = { text: ROWS.none, tone: 'quiet' };

/** The ModuleList order: needs by deadline (none last), then moving, stopped, paid, newest first
 *  inside a fate; non-deal rows (fate null) after every deal row, in the order they were given. */
export function compareRows(a: Item, b: Item): number {
  const fa = a.row.fate === null ? 9 : FATE_ORDER[a.row.fate];
  const fb = b.row.fate === null ? 9 : FATE_ORDER[b.row.fate];
  if (fa !== fb) return fa - fb;
  if (a.row.fate === null) return a.order - b.order;
  if (a.row.fate === 'needs') {
    const d = (a.row.deadline_s ?? Infinity) - (b.row.deadline_s ?? Infinity);
    if (d) return d;
  }
  return b.stamp - a.stamp || a.row.title.localeCompare(b.row.title) || a.row.id.localeCompare(b.row.id);
}

/** A deal row's frame: id, fate and deadline from the board's mapping; the module fills the rest. */
function dealRow(c: Ctx, module: Module, d: Deal, title: string, cells: RowCell[], sub: string | null, only?: AttentionItem | null): Item {
  // `only` narrows the decision the row answers to (null: none of this module's); omitted, the deal's own.
  const need = only === undefined ? c.needOf.get(d.id) : only ?? undefined;
  const fate = fateOf(d, need);
  const deadline_s = fate === 'needs' ? need?.deadline ?? null : null;
  return { row: { id: d.id, module, deal_id: d.id, title, cells, sub, fate, deadline_s }, stamp: stampOf(d), order: 0 };
}

/** Why it needs the owner, in plain words (the attention headline), or null. */
const whyOf = (c: Ctx, d: Deal): string | null => {
  const need = c.needOf.get(d.id);
  return need && fateOf(d, need) === 'needs' ? headlineWords(need.headline) : null;
};

/** The state word of a deal as its pages say it, toned by its fate. */
const stateCell = (d: Deal, fate: Fate): RowCell => word(fate === 'needs' ? BOARD_FATE.needs.short : stateWord(d.state, { side: d.side, kind: d.kind }).text, fate);

/** Time left on a deadline ("2 h 14 min left"), warn when it is short; null without a clock. */
function timeCell(deadline: number | null | undefined, now: number): RowCell | null {
  const t = timeLeft(deadline ?? null, now);
  return t ? word(t.text, t.urgent ? 'warn' : 'needs') : null;
}

// ---- tables: haggles ------------------------------------------------------------------------

function tablesRows(c: Ctx, deals: readonly Deal[]): Item[] {
  return deals.map((d) => {
    const disp = c.display(d);
    const need = c.needOf.get(d.id);
    const fate = fateOf(d, need);
    const offer: Money = fate === 'needs' && need && need.amount_minor ? { minor: need.amount_minor, currency: need.currency } : dealTotal(d);
    const band = bandOf(disp.band);
    const fence = band?.[fenceKey(d.side)] ?? null;
    // Over the limit is drawn on the unit price, as the band binds it (ladder.fits; Rust re-checks clause 4).
    const unit = fate === 'needs' && need && need.amount_minor ? Math.round(need.amount_minor / Math.max(1, d.terms.qty)) : d.terms.unit_price.minor;
    const outside = band !== null && fence !== null && !fits(unit, band);
    const time = fate === 'needs' ? timeCell(need?.deadline, c.nowSec) ?? stateCell(d, fate) : isLive(d) ? timeCell(disp.deadline, c.nowSec) ?? stateCell(d, fate) : stateCell(d, fate);
    const cells = [
      num(money(offer), outside ? 'warn' : undefined),
      fence !== null ? num(shortMoney(fence, d.terms.currency), 'quiet') : NONE,
      fate === 'moving' && time.tone === 'needs' ? { ...time, tone: 'moving' as const } : time,
    ];
    const sub = whyOf(c, d) ?? TABLES.withWho(tablesShortWho(c.who(d.counterparty)));
    return dealRow(c, 'tables', d, shortTitle(disp.title), cells, sub);
  });
}

// ---- spend: agent purchases -----------------------------------------------------------------

function spendRows(c: Ctx, deals: readonly Deal[]): Item[] {
  // Each purchase is read against the rule set that governs it, as SpendLayer reads its lanes.
  const list = c.mandates ?? [];
  const m = mandatesGoverning(list, 'purchase')[0] ?? null;
  const byId = new Map(list.map((e) => [e.payload.id, e]));
  const byVersion = new Map(list.map((e) => [`${e.payload.id}|${e.payload.version}`, e]));
  const colsOf = new Map<MandateListEntry, GateColumn[]>();
  const cols = (e: MandateListEntry): GateColumn[] => {
    let x = colsOf.get(e);
    if (!x) { x = gateColumns(e.payload.clauses); colsOf.set(e, x); }
    return x;
  };
  return deals.map((d) => {
    const need = c.needOf.get(d.id);
    const fate = fateOf(d, need);
    const own = !!m && d.mandate_id === m.payload.id;
    const drawn = own ? m : byVersion.get(`${d.mandate_id}|${d.mandate_version}`) ?? byId.get(d.mandate_id) ?? null;
    const laneCols = drawn ? cols(drawn) : [];
    const line: RuleLine = laneCols.length ? ruleLine(laneCells(d, laneCols, need, { version: drawn!.payload.version }), laneCols) : { kind: 'unknown', text: SPEND.otherRules };
    const out = outcomeOf(d);
    const verdict: RowCell = out.kind === 'refused' ? word(out.label, 'stopped')
      : fate === 'needs' && line.kind === 'ask' ? word(ROWS.asksYou, 'needs')
      : out.kind === 'paid' ? word(out.label, 'paid')
      : out.kind === 'voided' ? word(out.label, 'quiet')
      : word(out.label, fate);
    const amount = num(money(dealTotal(d)), out.kind === 'refused' || out.kind === 'voided' ? 'quiet' : undefined);
    return dealRow(c, 'spend', d, shortTitle(c.display(d).title), [amount, verdict], whyOf(c, d) ?? line.text);
  });
}

// ---- counter: live orders, then the catalog -------------------------------------------------

const VS_TONE: Record<ReturnType<typeof vsMarket>['cls'], CellTone> = { over: 'warn', above: 'quiet', at: 'quiet', under: 'quiet', none: 'quiet' };

function counterRows(c: Ctx, deals: readonly Deal[]): Item[] {
  const catalog = buildCatalog(sellerMandates(c.mandates ?? []), deals, c.deals, (d) => c.display(d).title);
  const rowOf = new Map<string, CatalogRow>(catalog.map((r) => [r.itemRef, r]));
  // The orders still open are deal rows (a reply that names one selects it); ended ones live in their item's row.
  const orders = deals.filter((d) => isLive(d) || c.needOf.has(d.id)).map((d) => {
    const need = c.needOf.get(d.id);
    const fate = fateOf(d, need);
    const vm = vsMarket(d.terms.unit_price, rowOf.get(d.terms.item_ref)?.market ?? null);
    const now = fate === 'needs' ? timeCell(need?.deadline, c.nowSec) ?? stateCell(d, fate) : stateCell(d, fate);
    const cells = [num(money(dealTotal(d))), word(vm.short, VS_TONE[vm.cls]), now];
    return dealRow(c, 'counter', d, shortTitle(c.display(d).title), cells, whyOf(c, d) ?? c.who(d.counterparty).name);
  });
  // Items with open orders first, then by name (buildCatalog's order).
  const openOn = (r: CatalogRow) => r.deals.filter(isLive).length;
  const items = catalog
    .map((r, i) => ({ r, i, open: openOn(r) }))
    .sort((a, b) => (b.open > 0 ? 1 : 0) - (a.open > 0 ? 1 : 0) || a.i - b.i)
    .map(({ r, open }, order): Item => {
      const vm = vsMarket(r.signed, r.market);
      const cells = [r.signed ? num(money(r.signed)) : NONE, word(vm.short, VS_TONE[vm.cls]), open ? num(ROWS.open(open), 'moving') : NONE];
      return {
        row: { id: `cat:${r.itemRef}`, module: 'counter', deal_id: null, title: shortTitle(itemName(r)), cells, sub: vm.cls === 'none' ? null : vm.long, fate: null, deadline_s: null },
        stamp: 0, order,
      };
    });
  return [...orders, ...items];
}

// ---- book: every payment --------------------------------------------------------------------

const BUCKET_TONE: Record<Bucket, CellTone> = { captured: 'paid', held: 'moving', motion: 'moving', unconfirmed: 'warn', stopped: 'stopped' };

function bookRows(c: Ctx): Item[] {
  return c.deals.map((d) => {
    const need = c.needOf.get(d.id);
    const fate = fateOf(d, need);
    const bucket = bucketOf(d);
    const t = dealTotal(d);
    const signed = `${dirOf(d) === 'out' ? '−' : '+'}${money(t)}`;
    const where = fate === 'needs' ? word(BOARD_FATE.needs.short, 'needs') : word(BUCKET_LABEL[bucket], BUCKET_TONE[bucket]);
    const cells = [num(signed, bucket === 'stopped' ? 'quiet' : dirOf(d) === 'in' ? 'paid' : undefined), where];
    return dealRow(c, 'book', d, c.who(d.counterparty).name, cells, shortTitle(c.display(d).title));
  });
}

// ---- shield: checked payments ---------------------------------------------------------------

function shieldRows(c: Ctx): Item[] {
  const sets = shieldSets(c.deals, c.moduleOfDeal, (id) => c.needOf.get(id));
  return sets.checked.map((d) => {
    const own = shieldNeed(d, c.needOf.get(d.id));
    const closed = d.shield === 'HOLD' && !own && !d.shield_release;
    const verdict: RowCell = closed ? word(SHIELD.closedChip, 'stopped')
      : !d.shield ? NONE
      : d.shield === 'BLOCK' ? word(shieldWord(d.shield).text, 'warn')
      : d.shield === 'CLEAR' ? word(shieldWord(d.shield).text, 'quiet')
      : word(shieldWord(d.shield).text, own ? 'needs' : 'quiet');
    const who = c.who(d.counterparty);
    const reason: RowCell = d.shield_rule
      ? word(shieldRuleWord(d.shield_rule).text, shieldRuleWord(d.shield_rule).tone === 'red' ? 'warn' : 'quiet')
      : own ? word(reasonsFor(d, who.entry, c.nowSec)[0]?.text ?? ROWS.none, 'quiet') : NONE;
    const amount = num(money(dealTotal(d)), d.shield === 'BLOCK' ? 'quiet' : undefined);
    // The shield's fate reads only its own decision (or a live HOLD's): a payment it cleared whose
    // decision waits in another module is not paused here, as the Shield page says.
    return dealRow(c, 'shield', d, who.name, [amount, verdict, reason], own ? headlineWords(own.headline) : shortTitle(c.display(d).title), own ?? null);
  });
}

// ---- rescue: failed renewals ----------------------------------------------------------------

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function rescueRows(c: Ctx): Item[] {
  return c.deals.filter(isRescueDeal).map((d) => {
    const need = c.needOf.get(d.id);
    const fate = fateOf(d, need);
    const view = viewFor(c.rescue, d.id);
    let next: RowCell;
    if (isFailing(d) && isLive(d)) {
      const at = paypalRetry(view, c.nowSec);
      next = at !== null ? word(ROWS.retryIn(retryLeft(at, c.nowSec)), fate) : word(isReplay(d, view) ? ROWS.replay : ROWS.retryUnknown, 'quiet');
    } else if (view?.counted) next = word(ROWS.recovered, 'paid');
    else next = stateCell(d, fate);
    const who = c.who(d.counterparty);
    const name = who.known ? who.name : subscriberName(d.counterparty) ?? who.name;
    const sub = need && fate === 'needs' ? ROWS.ifNothing(silenceParts(need.on_silence).head) : shortTitle(c.display(d).title);
    return dealRow(c, 'rescue', d, cap(name), [num(money(atRiskOf(d, c.rescue))), next], sub);
  });
}

// ---- the six lists --------------------------------------------------------------------------

/** Every module's list, sorted, from one set of inputs. */
export function moduleLists(i: ListInputs): Record<Module, ModuleList> {
  const c: Ctx = { ...i, needOf: new Map(i.needs.map((n) => [n.deal_id, n])) };
  const byModule = new Map<Module, Deal[]>(MODULE_KEYS.map((m) => [m, []]));
  for (const d of i.deals) byModule.get(i.moduleOfDeal(d))?.push(d);
  const items: Record<Module, Item[]> = {
    tables: tablesRows(c, byModule.get('tables') ?? []),
    spend: spendRows(c, byModule.get('spend') ?? []),
    counter: counterRows(c, byModule.get('counter') ?? []),
    book: bookRows(c),
    shield: shieldRows(c),
    rescue: rescueRows(c),
  };
  const out = {} as Record<Module, ModuleList>;
  for (const m of MODULE_KEYS) {
    out[m] = { module: m, columns: ROWS_COLUMNS[m], rows: items[m].sort(compareRows).map((x) => x.row), empty: ROWS_EMPTY[m] };
  }
  return out;
}
