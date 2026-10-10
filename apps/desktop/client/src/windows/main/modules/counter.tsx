// Counter (shop) module page - the "Counter board" (prototype/pages/counter/variant-1).
// Owner: the counter agent. Styles: ./counter.css, scoped under .mod-counter. Pure logic: ./counter/model.ts.
//
// Simple (default): the answer ("is anyone buying?"), live orders as cards (who, what, amount, state,
// time left, the default on silence), and the catalog as a plain price list: item, lowest price
// (editable), orders now. Detailed: one dense line per order, the catalog ledger with filters and the
// vs-market column. Both keep the one sticky draft bar whose only exit is the approval window.
// Layer 2: the Inspector shows the selected order or item. Main never signs: floors are a seller
// mandate, signed only in approval.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import type { Deal } from '@bindings/Deal';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import type { Money } from '@bindings/Money';
import { clockLabel, exponent, formatMinor, formatMoney, shortId } from '../../../lib/format';
import { useMutation, useNow, useQuery } from '../../../lib/hooks';
import { Countdown, ModeBadge, WalletNotice } from '../../../shared/honesty';
import {
  AnswerBar, Btn, Chip, DetailToggle, Explainer, Field, Group, Icon, Inspector, Kv, Loading, PageHead, Popover, Row, Section, Seg, Silence, useDetail, useLayer, useLayerCount, useToast,
  type ChipTone, type ExplainerStep,
} from '../../../shared/ui';
import { chipClass, dealTotal, isLive, isTerminal, moneyNow, pairingFact, PENDING_BACKEND, stripFor, sumByCurrency, type ChipClass } from '../logic';
import { houseWords, moneyCheckNow, silenceWords, stateWord, timeLeftWords } from '../../../lib/words';
import { Glyph } from '../../../shared/modules';
import { useCpLookup } from '../ui';
import { useWorld } from '../world';
import type { ModuleProps } from './common';
import { NoteText } from './shield/NoteChip';
import {
  buildCatalog, currencyMark, draftFloor, itemName, draftImpact, draftState, floorText, fmtShort, matchesFilter, matchesQuery, minorToText, parseMoneyText, scaleOf,
  sellerMandates, stepFloor, underDraft, vsMarket, type CatalogFilter, type CatalogRow, type FloorDraft, type Impact,
} from './counter/model';
import './counter.css';

type Sel = { kind: 'deal' | 'item'; id: string } | null;

const TONE: Record<ChipClass, ChipTone | undefined> = { live: 'teal', wait: 'gold', held: 'coral', done: 'ok', bad: 'red', off: undefined };
const stateText = (d: Deal) => stateWord(d.state, { side: d.side, kind: d.kind }).text;
/** Shop rules are one signed seller mandate: Layer 1 names it, the id and version stay in tooltips. */
const mandateTip = (m: MandateListEntry) => `Shop rules, version ${m.payload.version} · ${shortId(m.payload.id)}`;
const UNK_CATALOG = 'Your shop’s catalog is not connected yet, so list price, stock and listing details are not known here. Nothing is guessed.';
const CODE_ONLY = 'Named from the item code in your shop rules. Its own name shows once an order names it or your catalog is connected.';

const HOW_COUNTER: readonly ExplainerStep[] = [
  { icon: 'store', title: 'Agents shop here', text: 'Other people’s agents place orders at your shop.' },
  { icon: 'tag', title: 'Never below your price', text: 'Your lowest prices are signed rules.' },
  { icon: 'money', title: 'Buyers pay on PayPal', text: 'You are paid when the buyer approves.' },
];

/** The Counter page. The root (.module.mod-counter, --mc) comes from ModuleView. */
export function Counter({ deals, nav }: ModuleProps) {
  const w = useWorld();
  const cp = useCpLookup();
  const toast = useToast();
  const now = useNow();
  const [detail, setDetail] = useDetail('counter');
  const detailed = detail === 'detailed';
  const mq = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  const seller = useMemo(() => sellerMandates(mq.data ?? []), [mq.data]);
  const mandate = seller[0] ?? null;
  const rows = useMemo(() => buildCatalog(seller, deals, w.deals.data ?? [], (d) => w.display(d).title), [seller, deals, w]);
  const rowOf = useMemo(() => new Map(rows.map((r) => [r.itemRef, r])), [rows]);

  const [draft, setDraft] = useState<FloorDraft>({});
  const [filter, setFilter] = useState<CatalogFilter>('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Sel>(null);
  const [armed, setArmed] = useState(false);
  const { diff, errors } = useMemo(() => draftState(rows, draft), [rows, draft]);
  const impact = useMemo(() => draftImpact(diff), [diff]);
  const hasDraft = diff.length > 0 || errors.length > 0;
  const layers = useLayerCount();
  const search = useRef<HTMLInputElement>(null);

  const live = deals.filter(isLive);
  const past = deals.filter((d) => !isLive(d));
  const selDeal = sel?.kind === 'deal' ? deals.find((d) => d.id === sel.id) : undefined;
  const selRow = sel?.kind === 'item' ? rowOf.get(sel.id) : undefined;
  const select = (kind: 'deal' | 'item', id: string) => setSel((s) => (s && s.kind === kind && s.id === id ? null : { kind, id }));

  // Esc with an unsigned draft warns once (a layer, so it runs before App's "back one level").
  useLayer(() => {
    setArmed(true);
    toast('Your price change is not signed yet. Press Esc again to leave and discard it.', 'gold');
  }, 'other', hasDraft && !armed);
  useEffect(() => { if (!hasDraft) setArmed(false); }, [hasDraft]);

  const open = useMutation('approval_open');
  const review = async () => {
    const e = errors[0];
    if (e) { toast(<>Fix {errors.length === 1 ? 'one price' : `${errors.length} prices`} first: {itemName(e.row)} · {e.error}.</>, 'bad'); return; }
    if (!diff.length) { toast(<>No price differs from your shop rules. Nothing to sign.</>); return; }
    // One seller mandate holds one band, so one floor goes over per hand-off (the first change).
    const first = diff[0];
    const src = first?.row.source;
    const r = await open.run(src && first ? { deal_id: null, target: 'mandate', draft: { type: 'floor', mandate_id: src.mandateId, item_ref: first.row.itemRef, floor: first.to } } : { deal_id: null, target: 'mandate' });
    if (r === null) {
      toast(src ? <>The approval window is open with the new lowest price, {formatMoney(first.to)}. Check it and sign there{diff.length > 1 ? `; ${diff.length - 1} more price${diff.length > 2 ? 's' : ''} follow one at a time` : ''}.</>
        : <>The approval window is open on your rules. This item has no lowest price yet, so add it there.</>, 'gold');
    }
  };

  // Page keys: Ctrl+Enter reviews the draft, "/" filters the catalog (paused while a layer is open).
  const reviewRef = useRef(review);
  reviewRef.current = review;
  const ownLayers = (hasDraft && !armed ? 1 : 0) + (sel ? 1 : 0); // the draft guard and the inspector are this page's own
  useEffect(() => {
    const k = (e: globalThis.KeyboardEvent) => {
      if (layers > ownLayers) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && hasDraft) { e.preventDefault(); void reviewRef.current(); return; }
      if (e.key === '/' && !typing && search.current) { e.preventDefault(); search.current.focus(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [layers, ownLayers, hasDraft]);

  const setFloor = (item: string, text: string | undefined) => setDraft((d) => {
    const n = { ...d };
    if (text === undefined) delete n[item]; else n[item] = text;
    return n;
  });

  const shown = detailed ? rows.filter((r) => matchesFilter(r, filter, draft) && matchesQuery(r, q)) : rows;
  const FILTERS: Array<[CatalogFilter, string]> = [['all', 'All'], ['live', 'With orders'], ['over', 'Above market'], ['draft', 'Changed']];
  const catPending = !!PENDING_BACKEND.counter;

  return (
    <>
      <PageHead title="Counter" icon={<Glyph module="counter" />} focusKey="counter" sub="Your shop · other people’s agents buy here, never below your lowest prices"
        actions={<><DetailToggle value={detail} onChange={setDetail} /><MandateButton mandate={mandate} count={seller.length} floors={rows.filter((r) => r.signed).length} nav={nav} /></>} />
      <ShopAnswer live={live} past={past} nameOf={(d) => cp(d.counterparty).name} needs={(d) => !!w.needOf(d.id)} now={now} deadlineOf={(d) => w.needOf(d.id)?.deadline ?? w.display(d).deadline} />
      <Explainer id="counter" title="How your shop works" steps={HOW_COUNTER} />

      <Section title={<>Orders at your counter <span className="n">{live.length} open</span></>} end={detailed ? 'buyers pay on PayPal · collected for you automatically' : undefined}>
        {detailed ? (
          <Group empty="Nobody is at your counter. Orders appear here the moment another wallet’s agent checks out.">
            {live.length ? live.map((d) => (
              <SeatRow key={d.id} deal={d} cpName={cp(d.counterparty).name} selected={sel?.kind === 'deal' && sel.id === d.id}
                withdraws={underDraft(d, rowOf.get(d.terms.item_ref), draft)} onOpen={() => select('deal', d.id)} />
            )) : null}
          </Group>
        ) : live.length ? (
          <div className="orders">
            {live.map((d) => (
              <OrderCard key={d.id} deal={d} cpName={cp(d.counterparty).name} now={now} selected={sel?.kind === 'deal' && sel.id === d.id}
                withdraws={underDraft(d, rowOf.get(d.terms.item_ref), draft)} onOpen={() => select('deal', d.id)} />
            ))}
          </div>
        ) : <Group empty="Nobody is at your counter. Orders appear here the moment another wallet’s agent checks out." />}
      </Section>

      <Section className="catsec" title={detailed ? <>Catalog <span className="n">{rows.length} item{rows.length === 1 ? '' : 's'}</span></> : <>Your lowest prices <span className="n">{rows.length} item{rows.length === 1 ? '' : 's'}</span></>}
        end={catPending ? <Chip tone="dashed" title={UNK_CATALOG}>catalog not connected yet</Chip> : undefined}>
        {mq.error ? <WalletNotice error={mq.error} what="Your shop rules" /> : null}
        {detailed ? (
          <div className="cat-tools">
            <Seg label="Catalog filters" value={filter} onChange={setFilter}
              options={FILTERS.map(([v, l]) => ({ value: v, label: <>{l}<span className="cnt">{rows.filter((r) => matchesFilter(r, v, draft)).length}</span></> }))} />
            <Field ref={search} search type="search" className="catq" placeholder="Filter items  /" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.stopPropagation(); setQ(''); } }} aria-label="Filter catalog items" />
          </div>
        ) : null}
        {!mq.data && !mq.error ? <Loading what="your shop rules" /> : (
          <Group>
            <table className={`ui-table cat ${detailed ? '' : 'plain'}`}>
              <thead><tr>
                <th>Item</th>{catPending ? null : <th className="num">List price</th>}<th title="Your agent never quotes below this price. It is part of your signed shop rules.">Lowest price</th>
                {detailed ? <th className="hide-s">vs market</th> : null}<th>Orders now</th>{catPending ? null : <th>Listing</th>}
              </tr></thead>
              <tbody>
                {shown.length ? shown.map((r) => (
                  <CatalogLine key={r.itemRef} row={r} draft={draft} selected={sel?.kind === 'item' && sel.id === r.itemRef} detailed={detailed}
                    onSelect={() => select('item', r.itemRef)} onDeal={(id) => select('deal', id)} labelOf={(d) => w.display(d).label}
                    onText={(t) => setFloor(r.itemRef, t)} catPending={catPending} />
                )) : (
                  <tr><td colSpan={(catPending ? 3 : 5) + (detailed ? 1 : 0)}><div className="ui-empty">{rows.length ? <>No item matches. <Btn sm kind="plain" onClick={() => { setFilter('all'); setQ(''); }}>Show all</Btn></> : 'No items yet. They appear once your shop rules name one or an order arrives.'}</div></td></tr>
                )}
              </tbody>
            </table>
          </Group>
        )}
      </Section>

      <Section title="Earlier this week" end={`${past.length} closed`}>
        <Group empty="Nothing closed yet this week.">
          {past.length ? past.map((d) => {
            const disp = w.display(d);
            const t = dealTotal(d);
            return (
              <Row key={d.id} className="past" id={detailed ? disp.label : undefined} selected={sel?.kind === 'deal' && sel.id === d.id} onOpen={() => select('deal', d.id)}
                title={<>{disp.title} · <span className="cp">{cp(d.counterparty).name}</span>{d.updated_at ? <span className="dim"> · {clockLabel(d.updated_at)}</span> : null}</>}>
                {d.mode !== 'sandbox' ? <ModeBadge mode={d.mode} /> : null}
                <Chip tone={TONE[chipClass(d)]}>{stateText(d)}</Chip>
                <span className={`amt ${chipClass(d) === 'done' ? 'okc' : 'struck'}`}>{formatMinor(t.minor, t.currency)}</span>
              </Row>
            );
          }) : null}
        </Group>
      </Section>

      <DraftBar mandate={mandate} diff={diff} errors={errors} impact={impact} locked={w.locked} pending={open.pending}
        onDiscard={() => { setDraft({}); toast(<>Change discarded. {mandate ? 'Your shop rules stay as they are.' : 'Nothing was signed.'}</>); }}
        onReview={() => void review()} labelOf={(d) => w.display(d).label} />
      {open.error ? <WalletNotice error={open.error} what="Approval window" /> : null}

      {selDeal ? (
        <Inspector title={<>{cp(selDeal.counterparty).name} · {w.display(selDeal).title}</>} sub={<>Order · <span className="mono">{w.display(selDeal).label}</span></>} onClose={() => setSel(null)}>
          <div className="ctr-l2"><DealDetail deal={selDeal} row={rowOf.get(selDeal.terms.item_ref)} draft={draft} mandate={mandate} onOpenDeal={() => nav.onDeal(selDeal.id)} /></div>
        </Inspector>
      ) : selRow ? (
        <Inspector title={itemName(selRow)} sub="Item" onClose={() => setSel(null)}>
          <div className="ctr-l2"><ItemDetail row={selRow} draft={draft} mandate={mandate} onDeal={(id) => select('deal', id)} labelOf={(d) => w.display(d).label} /></div>
        </Inspector>
      ) : null}
    </>
  );
}

// ---- Layer 1 pieces ------------------------------------------------------------------------------

function StateChip({ deal }: { deal: Deal }) {
  return <Chip tone={TONE[chipClass(deal)]} title={stateWord(deal.state, { side: deal.side, kind: deal.kind }).means}>{stateText(deal)}</Chip>;
}

/** The order's path as a few segments: done, current (gold while waiting on the buyer, green once paid). */
function MiniBar({ deal }: { deal: Deal }) {
  const steps = stripFor(deal);
  return (
    <span className="qdots" role="img" aria-label={`step ${steps.findIndex((s) => s.status === 'cur') + 1} of ${steps.length}: ${stateText(deal)}`}>
      {steps.map((s) => <i key={s.state} className={s.status === 'done' ? 'd' : s.status === 'cur' ? `c ${s.tone ?? ''}` : ''} />)}
    </span>
  );
}

function SeatRow({ deal, cpName, selected, withdraws, onOpen }: { deal: Deal; cpName: string; selected: boolean; withdraws: boolean; onOpen: () => void }) {
  const w = useWorld();
  const disp = w.display(deal);
  const need = w.needOf(deal.id);
  const t = dealTotal(deal);
  const silence = need?.on_silence ?? disp.on_silence ?? 'no money moves';
  const deadline = need?.deadline ?? disp.deadline;
  return (
    <Row className="seat" id={disp.label} selected={selected} need={!!need} onOpen={onOpen}
      title={<><span className="cp">{cpName}</span> · {disp.title}</>} sub={<Silence text={silence} />}>
      <span className="flags">
        {withdraws ? <Chip tone="coral" title="Your new lowest price is above this quote. Signing the change withdraws it; no money moves.">would be withdrawn</Chip> : null}
        {deal.mode !== 'sandbox' ? <ModeBadge mode={deal.mode} /> : null}
      </span>
      <MiniBar deal={deal} />
      <span className="c-chip"><StateChip deal={deal} /></span>
      <span className="cd">{deadline ? <Countdown deadline={deadline} /> : null}</span>
      <span className="amt">{formatMinor(t.minor, t.currency)}</span>
    </Row>
  );
}

/** The answer at the top: is anyone buying, and what is waiting. Numbers come from the orders alone. */
function ShopAnswer({ live, past, nameOf, needs, now, deadlineOf }: {
  live: Deal[]; past: Deal[]; nameOf: (d: Deal) => string; needs: (d: Deal) => boolean; now: number; deadlineOf: (d: Deal) => number | null;
}) {
  const sum = (ds: Deal[]) => sumByCurrency(ds.map(dealTotal)).map((m) => formatMinor(m.minor, m.currency)).join(' · ');
  if (!live.length) {
    const paid = past.filter((d) => chipClass(d) === 'done');
    return <AnswerBar tone="calm" icon="store" title="Nobody is buying from your shop right now."
      sub={paid.length ? `${paid.length} order${paid.length === 1 ? ' was' : 's were'} paid to you this week: ${sum(paid)}.` : 'Orders appear here the moment another wallet’s agent checks out.'} />;
  }
  const asks = live.filter(needs).length;
  const soon = live.map((d) => ({ d, at: deadlineOf(d) })).filter((x): x is { d: Deal; at: number } => x.at !== null).sort((a, b) => a.at - b.at)[0];
  return (
    <AnswerBar tone={asks ? 'need' : 'calm'} icon="store"
      title={<>{live.length} order{live.length === 1 ? ' is' : 's are'} open at your shop, {sum(live)} in all.{asks ? ` ${asks} ${asks === 1 ? 'needs' : 'need'} you.` : ''}</>}
      sub={soon ? <>Closest deadline: {nameOf(soon.d)}, {timeLeftWords(soon.at - now)} left.</> : undefined} />
  );
}

/** One live order as a card: who, what, how much, where it stands, how long it has, and what happens if nobody acts. */
function OrderCard({ deal, cpName, now, selected, withdraws, onOpen }: { deal: Deal; cpName: string; now: number; selected: boolean; withdraws: boolean; onOpen: () => void }) {
  const w = useWorld();
  const disp = w.display(deal);
  const need = w.needOf(deal.id);
  const t = dealTotal(deal);
  const silence = silenceWords(need?.on_silence ?? disp.on_silence ?? 'no money moves');
  const deadline = need?.deadline ?? disp.deadline;
  return (
    <article className={`ord ${need ? 'need' : ''} ${selected ? 'on' : ''}`} role="button" tabIndex={0} aria-label={`${disp.title} from ${cpName}, ${formatMinor(t.minor, t.currency)}, ${stateText(deal)}. Show details`}
      aria-current={selected ? 'true' : undefined} onClick={onOpen} onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onOpen(); } }}>
      <div className="o-top">
        <div className="o-what">
          <span className="o-title">{disp.title}</span>
          <span className="o-who">from <span className="cp">{cpName}</span></span>
        </div>
        <span className="o-amt">{formatMinor(t.minor, t.currency)}</span>
      </div>
      <div className="o-mid">
        <StateChip deal={deal} />
        {need ? <Chip tone="gold">needs you</Chip> : null}
        {withdraws ? <Chip tone="coral" title="Your new lowest price is above this quote. Signing the change withdraws it; no money moves.">would be withdrawn</Chip> : null}
        {deal.mode !== 'sandbox' ? <ModeBadge mode={deal.mode} /> : null}
        {deadline ? <span className="o-left"><Icon name="clock" size={13} />{timeLeftWords(deadline - now)} left</span> : null}
      </div>
      <MiniBar deal={deal} />
      <Silence className="o-sil" text={silence} />
    </article>
  );
}

const INTERACTIVE = 'button, a, input, select, textarea, label';

function CatalogLine({ row, draft, selected, detailed, onSelect, onDeal, onText, labelOf, catPending }: {
  row: CatalogRow; draft: FloorDraft; selected: boolean; detailed: boolean; onSelect: () => void; onDeal: (id: string) => void; onText: (t: string | undefined) => void; labelOf: (d: Deal) => string; catPending: boolean;
}) {
  const text = floorText(row, draft);
  const changed = draft[row.itemRef] !== undefined;
  const st = draftState([row], draft);
  const bad = st.errors[0];
  const inDraft = !!st.diff[0];
  const f = draftFloor(row, draft);
  const vm = vsMarket(f, row.market);
  const live = row.deals.filter(isLive);
  const unit = 10 ** exponent(row.currency);
  const step = (dir: 1 | -1, big: boolean) => onText(stepFloor(row, draft, dir * unit * (big ? 10 : 1)));
  const signedText = row.signed ? minorToText(row.signed.minor, row.currency) : '';
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); step(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey); }
  };
  const onBlur = () => {
    if (!changed) return;
    const minor = parseMoneyText(text, row.currency);
    if (minor === null) return; // keep the bad text visible with its "fix" chip
    const norm = minorToText(minor, row.currency);
    onText(norm === signedText ? undefined : norm);
  };
  const onRowClick = (e: MouseEvent<HTMLTableRowElement>) => { if (!(e.target as HTMLElement).closest(INTERACTIVE)) onSelect(); };
  const title = itemName(row);
  // No order has named this item and the catalog is not connected, so its only name is the code in
  // your shop rules: Simple shows a plain name made from that code; the code itself is shown only in
  // Detailed (and the item's details), as a quiet tag.
  const coded = row.title === null;
  return (
    <tr className={`item ${bad ? 'bad' : inDraft ? 'draft' : ''}`} aria-selected={selected} onClick={onRowClick}>
      <td className="it">
        <button type="button" className="ititle" onClick={onSelect} title={coded ? `${CODE_ONLY} Code: ${row.itemRef}` : row.itemRef}>
          {title}{coded && detailed ? <> <span className="sku" aria-label={`Item code ${row.itemRef}`}>{row.itemRef}</span></> : null}
        </button>
      </td>
      {catPending ? null : <td className="num"><span className="unk" title={UNK_CATALOG}>unknown</span></td>}
      <td>
        <span className="fl">
          <Btn sm tabIndex={-1} aria-label="Lower the lowest price by 1" onClick={() => step(-1, false)}>−</Btn>
          <span className="cur-in">
            <span className="cur" aria-hidden="true">{currencyMark(row.currency)}</span>
            <Field id={`fl-${row.itemRef}`} inputMode="decimal" autoComplete="off" value={text} placeholder="none"
              aria-label={`Lowest price for ${title}${row.signed ? `, signed ${formatMoney(row.signed)}` : ', none signed'}`} aria-invalid={!!bad}
              onChange={(e) => onText(e.target.value === signedText && row.signed ? undefined : e.target.value)} onKeyDown={onKey} onBlur={onBlur} />
          </span>
          <Btn sm tabIndex={-1} aria-label="Raise the lowest price by 1" onClick={() => step(1, false)}>+</Btn>
        </span>
        <span className="fnote">
          {bad ? <Chip tone="red" title={bad.error}>fix</Chip>
            : changed ? <Btn sm kind="plain" title="Back to the signed price" onClick={() => onText(undefined)}>↺ {row.signed ? fmtShort(row.signed.minor, row.currency) : 'none'}</Btn> : null}
        </span>
      </td>
      {detailed ? <td className="hide-s"><span className={`vm ${vm.cls}`} title={vm.long}>{vm.short}</span></td> : null}
      <td className="ctr">
        {live.length ? live.map((d) => {
          const t = dealTotal(d);
          return <Chip key={d.id} tone="teal" onClick={() => onDeal(d.id)} title="Show this order">{detailed ? `${labelOf(d)} ` : ''}{fmtShort(t.minor, t.currency)}{detailed ? '' : ' order'}</Chip>;
        }) : <span className="dim">—</span>}
      </td>
      {catPending ? null : <td><span className="unk" title={UNK_CATALOG}>unknown</span></td>}
    </tr>
  );
}

function DraftBar({ mandate, diff, errors, impact, locked, pending, onDiscard, onReview, labelOf }: {
  mandate: MandateListEntry | null; diff: ReturnType<typeof draftState>['diff']; errors: ReturnType<typeof draftState>['errors']; impact: Impact[];
  locked: boolean; pending: boolean; onDiscard: () => void; onReview: () => void; labelOf: (d: Deal) => string;
}) {
  const [a, setA] = useState<HTMLElement | null>(null);
  const on = diff.length > 0 || errors.length > 0;
  const withdrawn = impact.filter((x) => x.kind === 'withdraw').length;
  if (!on) {
    return (
      <footer className="tray" aria-live="polite">
        {mandate ? <Chip tone="ok" title={mandateTip(mandate)}>Shop rules in force</Chip> : <Chip tone="dashed">no shop rules signed</Chip>}
        <span className="ui-hint grow">{mandate ? <>until {clockLabel(mandate.payload.expires)} · change a lowest price above to start a change</> : 'Set a lowest price above to create your shop rules.'}</span>
      </footer>
    );
  }
  return (
    <footer className="tray on" aria-live="polite">
      <Chip tone="gold" title={mandate ? `Becomes version ${mandate.payload.version + 1} of your shop rules` : 'Becomes your first shop rules'}>Unsigned change</Chip>
      <span className="diffs">
        {diff.map((d) => (
          <span key={d.row.itemRef}>{itemName(d.row)} <span className="money gold">{d.from ? fmtShort(d.from.minor, d.from.currency) : 'none'}→{fmtShort(d.to.minor, d.to.currency)}</span></span>
        ))}
      </span>
      {errors.length ? <Chip tone="red" title={errors.map((x) => `${itemName(x.row)}: ${x.error}`).join(' · ')}>{errors.length} to fix</Chip> : null}
      {impact.length ? <Chip tone={withdrawn ? 'coral' : 'line'} onClick={(e) => { const t = e.currentTarget; setA((x) => (x ? null : t)); }}>
        {withdrawn ? `${withdrawn} quote${withdrawn === 1 ? '' : 's'} withdrawn` : `${impact.length} open · unaffected`} ›
      </Chip> : null}
      {a ? <Popover anchor={a} onClose={() => setA(null)} title="If you sign this draft"><div className="ctr-pop"><ImpactList impact={impact} labelOf={labelOf} /></div></Popover> : null}
      <Silence text={mandate ? 'your prices stay as signed' : 'nothing is signed'} />
      <Btn sm onClick={onDiscard}>Discard</Btn>
      <Btn sm kind="gold" locked={locked} disabled={!!errors.length || !diff.length || pending} onClick={onReview}
        title="Opens the approval window, the only place your rules are signed">
        Review &amp; sign ↗
      </Btn>
    </footer>
  );
}

const IMPACT_CHIP: Record<Impact['kind'], [ChipTone, string]> = { withdraw: ['coral', 'withdrawn'], stays: ['teal', 'stays'], keeps: ['line', 'keeps terms'] };

function ImpactList({ impact, labelOf }: { impact: Impact[]; labelOf: (d: Deal) => string }) {
  if (!impact.length) return <p className="ui-hint">No open quote or order is on a changed item.</p>;
  return (
    <ul className="imp">
      {impact.map((x) => {
        const t = dealTotal(x.deal);
        const amt = formatMinor(t.minor, t.currency);
        const [tone, label] = IMPACT_CHIP[x.kind];
        return (
          <li key={x.deal.id}><Chip tone={tone}>{label}</Chip>
            <span>{labelOf(x.deal)} · {x.kind === 'withdraw' ? `the ${amt} quote is under the new lowest price. Signing withdraws it · no money moves.` : x.kind === 'stays' ? `the ${amt} quote is at or above the new lowest price and stays valid.` : `the order was issued at ${amt}; the buyer already holds it, so it keeps its price.`}</span>
          </li>
        );
      })}
    </ul>
  );
}

function MandateButton({ mandate, count, floors, nav }: { mandate: MandateListEntry | null; count: number; floors: number; nav: ModuleProps['nav'] }) {
  const [a, setA] = useState<HTMLElement | null>(null);
  return (
    <>
      <Btn sm onClick={(e) => { const t = e.currentTarget; setA((x) => (x ? null : t)); }} aria-haspopup="dialog">
        {mandate ? 'Shop rules' : 'No shop rules'}
      </Btn>
      {a ? (
        <Popover anchor={a} onClose={() => setA(null)} title={mandate ? 'Your shop rules' : 'No shop rules yet'}>
          {mandate ? (
            <Kv items={[
              ['Promise', 'your agent never quotes below a lowest price'],
              ['Prices set', `${floors} item${floors === 1 ? '' : 's'}`],
              ['In force', `${clockLabel(mandate.payload.not_before)} → ${clockLabel(mandate.payload.expires)}`],
              ['Signed for', `the ${mandate.agent} agent`],
              count > 1 && ['Also', `${count - 1} more rule set${count === 2 ? '' : 's'} cover shop orders; this is the first`],
              ['Changed in', 'the approval window only'],
              ['Version', <span className="dim">{mandateTip(mandate)}</span>],
            ]} />
          ) : <p className="ui-hint">No signed rules cover your shop yet, so your agent will not quote anyone.</p>}
          <p><Btn sm onClick={() => { setA(null); nav.onSheet('mandates'); }}>Open agent rules</Btn></p>
        </Popover>
      ) : null}
    </>
  );
}

// ---- Layer 2: the inspector ----------------------------------------------------------------------

const BY: Record<string, [ChipTone | undefined, string]> = { you: ['teal', 'your agent'], them: ['coral', 'their agent'], house: ['line', 'house'] };

function DealDetail({ deal, row, draft, mandate, onOpenDeal }: { deal: Deal; row: CatalogRow | undefined; draft: FloorDraft; mandate: MandateListEntry | null; onOpenDeal: () => void }) {
  const w = useWorld();
  const disp = w.display(deal);
  const need = w.needOf(deal.id);
  const c = useCpLookup()(deal.counterparty);
  const t = dealTotal(deal);
  const tr = useQuery('deal_transcript', { deal_id: deal.id }, { refreshOn: ['deal:changed'] });
  const steps = stripFor(deal);
  const pp = deal.paypal;
  const ids = [pp.order && `order ${pp.order}`, pp.authorization && `auth ${pp.authorization}`, pp.capture && `capture ${pp.capture}`].filter(Boolean).join(' · ');
  const silence = need?.on_silence ?? disp.on_silence;
  const live = isLive(deal);
  const check = need?.money_check;
  const now = check ? moneyCheckNow(isTerminal(deal)) : moneyNow(deal);
  return (
    <>
      <div className="l2-top">
        <StateChip deal={deal} />
        <span className="l2-amt">{formatMinor(t.minor, t.currency)}</span>
        {live && (need?.deadline ?? disp.deadline) ? <span className="cd"><Countdown deadline={(need?.deadline ?? disp.deadline) as number} /> left</span> : null}
        {deal.mode !== 'sandbox' ? <ModeBadge mode={deal.mode} /> : null}
        <span className="ui-spacer" />
        <Btn sm kind="plain" onClick={onOpenDeal}>Open deal ↗</Btn>
      </div>
      <ol className="steps" aria-label={`Order: ${stateText(deal)}`}>
        {steps.map((s) => <li key={s.state} className={`${s.status} ${s.status === 'cur' ? s.tone ?? '' : ''}`} aria-current={s.status === 'cur' ? 'step' : undefined} title={s.label}>{s.label}</li>)}
      </ol>
      <Kv className="l2-kv" items={[
        ['Buyer', <><span className="cp">{c.name}</span> · <span title={pairingFact(c.entry).why}>{pairingFact(c.entry).text}</span>{c.entry ? <> · first seen {clockLabel(c.entry.first_seen)} · {c.entry.deals_closed} closed before</> : null}</>],
        ['Item', <>{disp.title}{deal.terms.qty > 1 ? ` · ${deal.terms.qty} ×` : ''}{row?.signed ? <> · lowest price {formatMoney(row.signed)}</> : ' · no lowest price set'}</>],
        ['Money', now],
        [live ? 'If you do nothing' : 'Outcome', silence ?? (live ? 'no money moves' : now)],
        !!ids && ['PayPal ids', <span className="mono dim">{ids}</span>],
        ['Buyer key', <span className="mono dim" title={mandate ? mandateTip(mandate) : undefined}>{shortId(deal.counterparty)}{c.entry?.declared_payee ? ` · pays from ${houseWords(c.entry.declared_payee)}` : ''}</span>],
      ]} />
      {underDraft(deal, row, draft) ? <p className="l2-warn">Your new lowest price is above this quote: signing the change withdraws it. No money moves.</p> : null}
      {need ? (
        <Section title="Needs you">
          <HandOff dealId={deal.id} label="Review & approve ↗" />
          <p><Silence text={need.on_silence} deadline={need.deadline} /></p>
        </Section>
      ) : null}
      <Section title="What happened" end="signed by both sides">
        {tr.error ? <WalletNotice error={tr.error} what="Order history" /> : !tr.data ? <Loading what="the order history" /> : !tr.data.length ? (
          <p className="ui-hint">Nothing signed on this order yet.</p>
        ) : (
          <ol className="tl">
            {tr.data.map((s) => {
              const [tone, who] = BY[s.by] ?? [undefined, s.by];
              return <li key={s.seq}><time>{clockLabel(s.at)}</time><Chip tone={tone}>{who}</Chip><span>{s.typ.toLowerCase()}{s.price ? ` · ${formatMoney(s.price)}` : ''}{s.verified ? ' · verified' : ''}</span></li>;
            })}
          </ol>
        )}
      </Section>
      <Section title="Their words" end="unchecked, shown as plain text">
        <NoteText dealId={deal.id} from={c.name} />
      </Section>
    </>
  );
}

function ItemDetail({ row, draft, mandate, onDeal, labelOf }: { row: CatalogRow; draft: FloorDraft; mandate: MandateListEntry | null; onDeal: (id: string) => void; labelOf: (d: Deal) => string }) {
  const f = draftFloor(row, draft);
  const m = row.market;
  const changed = !!draftState([row], draft).diff[0];
  return (
    <>
      <div className="l2-top">
        <span className="mono dim">{row.itemRef}</span>
        <Chip tone="dashed" title={UNK_CATALOG}>catalog not connected yet</Chip>
      </div>
      <PriceScale row={row} floor={f} />
      <Kv className="l2-kv" items={[
        ['Lowest price', row.signed
          ? <><span className="money">{formatMoney(row.signed)}</span> signed{changed && f ? <> · changing to <span className="money gold">{formatMoney(f)}</span></> : null}</>
          : <>not set{changed && f ? <> · changing to <span className="money gold">{formatMoney(f)}</span></> : null}</>],
        row.ceiling && ['Highest price', <span className="money">{formatMoney(row.ceiling)}</span>],
        ['Market', m ? <span title={`p25 ${formatMoney(m.p25)} · median ${formatMoney(m.median)} · p75 ${formatMoney(m.p75)}`}>usually {formatMoney(m.p25)}–{formatMoney(m.p75)} · typical {formatMoney(m.median)} <span className="dim">· checked {clockLabel(m.retrieved_at)}</span></span> : <span className="dim">no market price to compare</span>],
        f && ['vs market', vsMarket(f, m).long],
        ['This week', row.deals.length ? <span className="wk">{row.deals.map((d) => {
          const t = dealTotal(d);
          return <span key={d.id}><Btn sm kind="plain" onClick={() => onDeal(d.id)}>{labelOf(d)}</Btn> {formatMinor(t.minor, t.currency)} <span className="dim">{stateText(d)}</span></span>;
        })}</span> : <span className="dim">no orders</span>],
        ['List price, stock', <span className="unk" title={UNK_CATALOG}>catalog not connected yet</span>],
      ]} />
      <p className="ui-hint">Lowest prices are part of your signed shop rules{mandate ? '' : ' (none yet)'}: change them here, sign in the approval window. Buyers approve every sale on PayPal.</p>
    </>
  );
}

/** Floor, the signed floor it replaces, the market band and the orders on one axis. List price is unknown, so it is not drawn. */
function PriceScale({ row, floor }: { row: CatalogRow; floor: Money | null }) {
  const cur = row.currency;
  const m = row.market && row.market.median.currency === cur ? row.market : null;
  const was = row.signed && floor && row.signed.minor !== floor.minor ? row.signed.minor : null;
  const qs = row.deals.filter((d) => dealTotal(d).currency === cur);
  const vals = [floor?.minor, was, m?.p25.minor, m?.median.minor, m?.p75.minor, ...qs.map((d) => dealTotal(d).minor)].filter((v): v is number => typeof v === 'number');
  const x = scaleOf(vals);
  if (!x || vals.length < 2) return <p className="ui-hint">Nothing to compare yet: {floor ? 'no market price or order for this item' : 'no lowest price set'}.</p>;
  const pct = (v: number) => `${x(v).toFixed(2)}%`;
  return (
    <>
      <div className="scale" aria-hidden="true">
        <div className="bar" />
        {floor ? <div className="below" style={{ width: pct(floor.minor) }} /> : null}
        {m ? <div className="band" style={{ left: pct(m.p25.minor), width: `${(x(m.p75.minor) - x(m.p25.minor)).toFixed(2)}%` }} /> : null}
        {m ? <div className="tk mkt dn" style={{ left: pct(m.median.minor) }}><i className={was !== null ? (was < m.median.minor ? 'r' : 'l') : ''}>typical {fmtShort(m.median.minor, cur)}</i></div> : null}
        {was !== null ? <div className="tk was dn" style={{ left: pct(was) }}><i className={m && was >= m.median.minor ? 'r' : 'l'}>was {fmtShort(was, cur)}</i></div> : null}
        {floor ? <div className="tk floor up" style={{ left: pct(floor.minor) }}><i className="l">lowest {fmtShort(floor.minor, cur)}</i></div> : null}
        {qs.map((d) => <div key={d.id} className={`dot ${chipClass(d) === 'done' ? 'sold' : ''}`} style={{ left: pct(dealTotal(d).minor) }} />)}
      </div>
      <div className="legend"><span className="lg-q">your order</span><span className="lg-s">sold</span><span className="lg-m">usual market range</span><span className="lg-b">below your lowest: never quoted</span></div>
    </>
  );
}

/** Hands the decision to the approval window (approval_open). Never releases money itself. */
function HandOff({ dealId, label }: { dealId: string; label: ReactNode }) {
  const w = useWorld();
  const open = useMutation('approval_open');
  return (
    <>
      <Btn kind="gold" sm locked={w.locked} disabled={open.pending} onClick={() => void open.run({ deal_id: dealId })} title="Opens the approval window - the only place money can be released">
        {label}
      </Btn>
      {open.error ? <WalletNotice error={open.error} what="Approval window" /> : null}
    </>
  );
}
