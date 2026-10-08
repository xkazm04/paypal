// Rescue module page, in plain words (docs/ux/UX-GUIDE.md, docs/ux/ROUND-1.md): a failed renewal gets
// one fix for one subscriber, or nothing.
// Round 2: in Simple, a money strip (at risk, in progress, recovered) and, on each fix card, what the
// subscriber would get plus a Why? (./rescue/Panels.tsx, facts in ./rescue/preview.ts).
// Owner: the rescue agent. Styles: ./rescue.css, scoped under .mod-rescue. Pure logic: ./rescue/model.ts.
//
// Simple (default): the answer, then one decision card per failed renewal. The options are cards,
// "Do nothing" is picked at the start (silence never moves money) and the closed list of fixes sits
// beside it; the one gold button hands the choice to the approval window (approval_open), the only
// place the discount is approved (hold to approve). The discount, its invoice wording and every
// recovered number come from the wallet (rescue_book); the other three fixes are not built yet.
// Below: invoices with the subscriber and money that came back.
// Detailed: the lever matrix (prototype/pages/rescue/variant-3) in place of the cards and lists, with
// the inspector following the focused cell. A plan-wide price change is the one thing never offered.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Deal } from '@bindings/Deal';
import type { RescueBook } from '@bindings/RescueBook';
import type { RescueView } from '@bindings/RescueView';
import { clockLabel, formatMinor, formatMoney, shortId } from '../../../lib/format';
import { useMutation, useNow, useQuery } from '../../../lib/hooks';
import {
  percentWords, RESCUE_APPROVE_DOES, RESCUE_COUNTED, RESCUE_REPLAY_ABOUT as RESCUE_REPLAY_ABOUT_TEXT, RESCUE_REPLAY_NOT_COUNTED, RESCUE_SENT_NOT_COUNTED, RESCUE_WATCH_ABOUT, rescueSourceWord, ruleSentence, silenceWords, stateWord, subscriberName, timeLeftWords, watchingWords,
} from '../../../lib/words';
import { ModeBadge, WalletNotice } from '../../../shared/honesty';
import { Glyph } from '../../../shared/modules';
import {
  AnswerBar, Btn, Chip, DecisionCard, DetailToggle, Dot, Explainer, Group, Hourglass, Icon, Inspector, Kv, PageHead, Popover, Row, Section, Silence, useDetail,
  type ChipTone, type DecisionOption, type ExplainerStep,
} from '../../../shared/ui';
import { chipClass, dealTotal, moneyNow, sumByCurrency, type ChipClass } from '../logic';
import { useCpLookup } from '../ui';
import { useWorld } from '../world';
import type { ModuleProps } from './common';
import { cellState, COLS, LEVERS, leverOf, moveCell, pickable, recovered, rulesFor, splitRows, viewFor, type Col, type LeverKey, type NotCountedWhy } from './rescue/model';
import { FixGet, FixGetOff, FixWhy, RescueMoney } from './rescue/Panels';
import { fixQuestion, fixWhy, previewFor, rescueStrip } from './rescue/preview';
import './rescue.css';

type Peek = { id: string; col: Col | null };
const TONE: Record<ChipClass, ChipTone | undefined> = { live: 'teal', wait: 'coral', held: 'coral', done: 'ok', bad: 'red', off: undefined };
/** The wallet's rescue read, shared by the page's parts (null until it answers or on an older shell). */
function useRescueBook(): { book: RescueBook | null; error: ReturnType<typeof useQuery<'rescue_book'>>['error'] } {
  const q = useQuery('rescue_book', null, { refreshOn: ['deal:changed', 'receipt:created', 'attention:changed'] });
  // The watch list changes in the approval window; read it again when this window is back in front.
  const refetch = q.refetch;
  useEffect(() => {
    const again = () => void refetch();
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, [refetch]);
  return { book: q.data ?? null, error: q.error };
}

/** A small mark per fix, so a column reads before its label does. */
const MARK: Record<Col, ReactNode> = {
  NONE: <Hourglass />,
  DISCOUNT_THIS_CYCLE: <span className="mk">%</span>,
  PAUSE: <span className="mk">❚❚</span>,
  RETRY_AFTER_FIX: <span className="mk">↻</span>,
  DOWNGRADE: <span className="mk">↓</span>,
};
/** What each fix does, in a few words (the cell's second line). */
const GIST: Record<LeverKey, string> = {
  DISCOUNT_THIS_CYCLE: 'cheaper bill',
  PAUSE: 'pause a while',
  RETRY_AFTER_FIX: 'fix card first',
  DOWNGRADE: 'cheaper plan',
};
/** Column names short enough for the matrix; the full name is in the tooltip and the inspector. */
const HEAD: Record<LeverKey, string> = { DISCOUNT_THIS_CYCLE: 'Discount', PAUSE: 'Pause', RETRY_AFTER_FIX: 'Retry later', DOWNGRADE: 'Downgrade' };
const wordOf = (d: Deal) => stateWord(d.state, { side: d.side, kind: d.kind });
const retryWords = (deadline: number | null, now: number) => (deadline ? `retry in ${timeLeftWords(deadline - now).replace(/ \d+ h$/, '')}` : 'no retry set');
const coarse = (deadline: number, now: number) => timeLeftWords(deadline - now).replace(/ \d+ h$/, '');

const HOW_RESCUE: readonly ExplainerStep[] = [
  { icon: 'renew', title: 'A renewal failed', text: 'A subscriber’s payment didn’t go through.' },
  { icon: 'tag', title: 'Pick one fix', text: 'One fix, for that one subscriber.' },
  { icon: 'shield', title: 'Doing nothing is safe', text: 'PayPal retries on its own. Nothing is sent without you.' },
];

/** The fixes in the owner's words: a name, and what it does in one short line. */
const PICK: Record<LeverKey, { name: string; does: string }> = {
  DISCOUNT_THIS_CYCLE: { name: 'Offer a discount', does: 'A cheaper invoice for this month only' },
  PAUSE: { name: 'Pause for a while', does: 'Pause now, restart on a date you agree' },
  RETRY_AFTER_FIX: { name: 'Retry later', does: 'They fix their card first, then you collect' },
  DOWNGRADE: { name: 'Smaller plan', does: 'Move them to a cheaper plan' },
};
/** Why a fix is not available for this renewal, calmly (model codes: REPLAY, retry <24h). */
const WHY_OFF: Record<string, string> = { REPLAY: 'Not for a replay: no real balance to collect', 'retry <24h': 'Not now: PayPal retries within a day', NOT_BUILT: 'Not available yet' };
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** The Rescue page. The root (.module.mod-rescue, --mc) comes from ModuleView. */
export function Rescue({ deals, nav }: ModuleProps) {
  const w = useWorld();
  const now = useNow();
  const cp = useCpLookup();
  const [detail, setDetail] = useDetail('rescue');
  const detailed = detail === 'detailed';
  const [picked, setPicked] = useState<Record<string, Col>>({});
  const deadlineOf = (d: Deal) => w.needOf(d.id)?.deadline ?? w.display(d).deadline;
  const rows = useMemo(() => splitRows(deals, (d) => w.needOf(d.id)?.deadline ?? w.display(d).deadline), [deals, w]);
  const all = [...rows.failing, ...rows.inflight, ...rows.settled];
  const failIds = rows.failing.map((d) => d.id);
  const [peek, setPeek] = useState<Peek | null>(null);
  const cur: Peek | null = peek && all.some((d) => d.id === peek.id) ? peek : all[0] ? { id: all[0].id, col: null } : null;
  const curDeal = cur ? all.find((d) => d.id === cur.id) : undefined;
  const table = useRef<HTMLTableElement>(null);
  const nc = COLS.length + 3;

  const focusCell = (id: string, col: Col) => {
    const el = table.current?.querySelector<HTMLButtonElement>(`[data-cell="${CSS.escape(`${id}|${col}`)}"]`);
    el?.focus();
  };
  const onCellKey = (e: KeyboardEvent<HTMLButtonElement>, id: string, col: Col) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const to = moveCell(failIds, { id, col }, e.key);
    if (!to) return;
    e.preventDefault();
    e.stopPropagation(); // digits pick a column here, not a module (App's 1-6)
    setPeek(to);
    focusCell(to.id, to.col);
  };

  const { book, error: bookError } = useRescueBook();
  const label = (d: Deal) => w.display(d).label;
  // A subscriber has no wallet: name them by their subscription when the wallet has no entry.
  const nameOf = (d: Deal) => { const c = cp(d.counterparty); return c.known ? c.name : subscriberName(d.counterparty) ?? c.name; };
  const colName = (col: Col | null) => (!col || col === 'NONE' ? 'Do nothing' : leverOf(col).name);
  const pick = (id: string, col: Col) => setPicked((p) => ({ ...p, [id]: col }));
  const ans = answerFor(rows, w.deals.data ?? [], book, nameOf, (d) => !!w.needOf(d.id));

  return (
    <>
      <PageHead title="Rescue" icon={<Glyph module="rescue" />} focusKey="rescue" sub="Failed renewals · pick one fix for one subscriber, or do nothing"
        actions={<><DetailToggle value={detail} onChange={setDetail} /><ReplayButton /><MandateInfo nav={nav} /><RecoveredButton deals={w.deals.data ?? []} book={book} label={label} /></>} />
      <AnswerBar tone={ans.tone} title={ans.title} sub={ans.sub} icon={ans.tone === 'calm' ? 'renew' : undefined} />
      {bookError ? <WalletNotice error={bookError} what="Fixes and recovered money can’t be read" /> : null}
      {!detailed ? <RescueMoney strip={rescueStrip(rows, w.deals.data ?? [], book)} /> : null}
      <Explainer id="rescue" title="How rescue works" steps={HOW_RESCUE} />
      <WatchRow book={book} failed={!!bookError} />

      {!detailed ? (
        <>
          {rows.failing.map((d) => (
            <FailedCard key={d.id} deal={d} view={viewFor(book, d.id)} name={nameOf(d)} deadline={deadlineOf(d)} now={now}
              col={picked[d.id] ?? 'NONE'} onPick={(c) => pick(d.id, c)} onOpen={() => nav.onDeal(d.id)} />
          ))}
          {rows.inflight.length ? (
            <Section title="Fixes in progress" end={<>{rows.inflight.length} waiting for the subscriber</>}>
              <Group>
                {rows.inflight.map((d) => <ProgressRow key={d.id} deal={d} view={viewFor(book, d.id)} name={nameOf(d)} onOpen={() => nav.onDeal(d.id)} />)}
              </Group>
            </Section>
          ) : null}
          {rows.settled.length ? (
            <Section title="Recovered money" end="a rescue counts once PayPal shows it paid">
              <Group>
                {rows.settled.map((d) => <ProgressRow key={d.id} deal={d} view={viewFor(book, d.id)} name={nameOf(d)} onOpen={() => nav.onDeal(d.id)} />)}
              </Group>
            </Section>
          ) : null}
        </>
      ) : (
        <>
          <Group className="mwrap">
            <table className="ui-table mx" ref={table}>
              <colgroup><col className="c-who" />{COLS.map((c) => <col key={c} />)}<col className="c-never" /><col className="c-act" /></colgroup>
              <thead>
                <tr>
                  <th>Subscriber</th>
                  <th className="def" title="The default: nothing is sent, PayPal retries on its own"><span className="th">{MARK.NONE}Do nothing</span></th>
                  {LEVERS.map((l) => <th key={l.key} title={`${l.name}: ${l.effect}`}><span className="th">{MARK[l.key]}{HEAD[l.key]}</span></th>)}
                  <th className="never" title="A price change for everyone on the plan is never offered here">Price</th>
                  <th aria-label="Decision" />
                </tr>
              </thead>
              <tbody>
                {rows.failing.length ? rows.failing.map((d, ri) => {
                  const dl = deadlineOf(d);
                  const need = w.needOf(d.id);
                  return (
                    <tr key={d.id} className={cur?.id === d.id ? 'on' : ''} role="radiogroup" aria-label={`Fix for ${nameOf(d)}`}>
                      <Who deal={d} name={nameOf(d)} need={!!need} silence={need ? 'nothing is sent' : undefined} />
                      {COLS.map((col) => (
                        <td key={col}>
                          <Cell deal={d} view={viewFor(book, d.id)} col={col} deadline={dl} now={now} peek={cur?.id === d.id && cur.col === col}
                            onFocus={() => setPeek({ id: d.id, col })} onKey={(e) => onCellKey(e, d.id, col)} />
                        </td>
                      ))}
                      {ri === 0 ? <NeverCell rows={rows.failing.length} /> : null}
                      <td className="act">{need ? <HandOff dealId={d.id} label="Review ↗" sm quiet title={need.headline} /> : <span className="dim">—</span>}</td>
                    </tr>
                  );
                }) : <tr><td colSpan={nc}><div className="ui-empty">No failed renewals. Nothing to rescue.</div></td></tr>}
                {rows.inflight.length ? <tr className="gs"><td colSpan={nc}>Fix sent · waiting for the subscriber</td></tr> : null}
                {rows.inflight.map((d) => <SpanRow key={d.id} deal={d} view={viewFor(book, d.id)} name={nameOf(d)} on={cur?.id === d.id} onPeek={() => setPeek({ id: d.id, col: null })} />)}
                {rows.settled.length ? <tr className="gs"><td colSpan={nc}>Done</td></tr> : null}
                {rows.settled.map((d) => <SpanRow key={d.id} deal={d} view={viewFor(book, d.id)} name={nameOf(d)} on={cur?.id === d.id} onPeek={() => setPeek({ id: d.id, col: null })} />)}
              </tbody>
            </table>
          </Group>

          {curDeal && cur ? (
            <Inspector title={<>{nameOf(curDeal)} · {failingNow(curDeal) ? colName(cur.col) : wordOf(curDeal).text}</>}
              sub={<>{w.display(curDeal).title} · <span className="mono">{label(curDeal)}</span> · <Btn sm kind="plain" onClick={() => nav.onDeal(curDeal.id)}>Open deal →</Btn></>}>
              <div className="rsc-l2">
                {failingNow(curDeal) ? <CellDetail deal={curDeal} view={viewFor(book, curDeal.id)} col={cur.col ?? 'NONE'} deadline={deadlineOf(curDeal)} now={now} />
                  : <DeskDetail deal={curDeal} view={viewFor(book, curDeal.id)} deadline={deadlineOf(curDeal)} />}
              </div>
            </Inspector>
          ) : null}
        </>
      )}
    </>
  );
}

// ---- the answer ------------------------------------------------------------------------------------

/** One sentence for the top of the screen, from the rows alone. Only a really paid rescue turns it green. */
function answerFor(rows: ReturnType<typeof splitRows>, deals: readonly Deal[], book: RescueBook | null, nameOf: (d: Deal) => string, needs: (d: Deal) => boolean): { tone: 'calm' | 'need' | 'done'; title: ReactNode; sub: ReactNode } {
  const r = recovered(deals, book);
  const got = r.totals.map((t) => formatMinor(t.minor, t.currency)).join(' · ');
  const n = rows.failing.length;
  const waiting = rows.inflight.length;
  if (n) {
    const first = rows.failing[0] as Deal;
    // What failed is the renewal at the plan's price; the fix's invoice is the discounted amount.
    const t = viewFor(book, first.id)?.offer.cycle ?? dealTotal(first);
    const asks = rows.failing.some(needs);
    const sums = sumByCurrency(rows.failing.map((d) => viewFor(book, d.id)?.offer.cycle ?? dealTotal(d))).map((m) => formatMinor(m.minor, m.currency)).join(' · ');
    return {
      tone: asks ? 'need' : 'calm',
      title: n === 1 ? <>{cap(nameOf(first))}’s {formatMinor(t.minor, t.currency)} renewal failed.{asks ? ' Your call.' : ' PayPal retries on its own.'}</>
        : <>{n} renewals failed, {sums} in all.{asks ? ' Your call on each.' : ' PayPal retries on its own.'}</>,
      sub: <>If you do nothing, PayPal retries the payment by itself.</>,
    };
  }
  return {
    tone: got ? 'done' : 'calm',
    title: <>No renewal is failing right now.</>,
    sub: <>{waiting ? `${waiting} fix${waiting === 1 ? ' is' : 'es are'} waiting for the subscriber.` : 'Nothing to rescue.'}{got ? ` ${got} recovered so far.` : ''}</>,
  };
}

// ---- Simple: one decision per failed renewal -------------------------------------------------------

/** A renewal whose one fix waits for the owner (Rust: AGREED). */
const failingNow = (d: Deal) => d.kind === 'rescue' && d.state === 'AGREED';

/** The option cards of one renewal: a radio group. Arrow keys and 0-4 move between the fixes that are open to it. */
function Picks({ deal, view, deadline, now, col, onPick }: { deal: Deal; view: RescueView | undefined; deadline: number | null; now: number; col: Col; onPick: (c: Col) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const off = (c: Col) => !pickable(cellState(deal, c, deadline, now, view));
  const go = (to: Col) => {
    onPick(to);
    box.current?.querySelector<HTMLButtonElement>(`[data-col="${to}"]`)?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, from: Col) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const step = e.key === 'ArrowDown' ? 'ArrowRight' : e.key === 'ArrowUp' ? 'ArrowLeft' : e.key;
    let to = moveCell([deal.id], { id: deal.id, col: from }, step)?.col ?? null;
    if (!to) return;
    e.preventDefault();
    e.stopPropagation(); // digits pick a fix here, not a module (App's 1-6)
    if (step === 'ArrowRight' || step === 'ArrowLeft') {
      while (to && off(to)) to = moveCell([deal.id], { id: deal.id, col: to }, step)?.col ?? null;
    }
    if (to && !off(to)) go(to);
  };
  const amount = view?.offer.cycle ?? dealTotal(deal);
  return (
    <div className="rs-picks" role="radiogroup" aria-label="What to do about this renewal" ref={box}>
      {COLS.map((c) => {
        const st = cellState(deal, c, deadline, now, view);
        const isOff = !pickable(st);
        const on = c === col && !isOff;
        const name = c === 'NONE' ? 'Do nothing' : PICK[c].name;
        const does = c === 'NONE' ? (deadline ? `PayPal retries in ${coarse(deadline, now)}` : 'This month stays unpaid')
          : st.kind === 'offer' ? `${percentWords(st.offer.discount_bp)} off: ${formatMoney(st.offer.invoice)} instead of ${formatMoney(st.offer.cycle)}`
            : st.kind === 'off' ? WHY_OFF[st.code] ?? st.why : st.kind === 'unknown' ? st.why : '';
        const button = (
          <button key={c} type="button" role="radio" data-col={c} aria-checked={on} disabled={isOff} tabIndex={on ? 0 : -1}
            className={`rs-pick ${on ? 'on' : ''} ${c === 'NONE' ? 'def' : ''} ${isOff ? 'off' : ''}`} onClick={() => onPick(c)} onKeyDown={(e) => onKey(e, c)}
            title={c === 'NONE' ? 'The safe default: nothing is sent' : st.kind === 'off' || st.kind === 'unknown' ? st.why : `${leverOf(c).name}: ${leverOf(c).effect}`}>
            <span className="mk">{MARK[c]}</span>
            <span className="l">{name}</span>
            <span className="m">{does}</span>
            {on ? <span className="tick"><Icon name="check" size={14} label="Selected" /></span> : null}
          </button>
        );
        // The card also shows what the subscriber would get, and a Why? (a sibling of the radio, never inside it).
        return (
          <div key={c} className={`rs-fix ${on ? 'on' : ''} ${c === 'NONE' ? 'def' : ''} ${isOff ? 'off' : ''}`}>
            {button}
            {isOff ? <FixGetOff /> : <FixGet preview={previewFor(c, { item: deal.terms.item_ref, amount, retryAt: deadline, view })} />}
            <div className="rs-why"><FixWhy question={fixQuestion(c)} lines={fixWhy(c, { amount, retryAt: deadline, offCode: st.kind === 'off' ? st.code : undefined, offer: view?.offer })} /></div>
          </div>
        );
      })}
    </div>
  );
}

/** One failed renewal as one decision. The gold button only opens the approval window, carrying the chosen fix. */
function FailedCard({ deal, view, name, deadline, now, col, onPick, onOpen }: {
  deal: Deal; view: RescueView | undefined; name: string; deadline: number | null; now: number; col: Col; onPick: (c: Col) => void; onOpen: () => void;
}) {
  const w = useWorld();
  const need = w.needOf(deal.id);
  const open = useMutation('approval_open');
  const disp = w.display(deal);
  const t = view?.offer.cycle ?? dealTotal(deal);
  const lever = col !== 'NONE' && pickable(cellState(deal, col, deadline, now, view)) ? col : undefined;
  // The fix picked here travels as a draft: the approval window shows it and still decides.
  const args = lever ? { deal_id: deal.id, target: 'deal' as const, draft: { type: 'lever' as const, lever } } : { deal_id: deal.id };
  const options: DecisionOption[] = need ? [{
    kind: 'gold',
    label: <>{w.locked ? <Icon name="hold" size={13} /> : null} {lever ? `Review ${leverOf(lever).short.toLowerCase()}` : 'Review & approve'} ↗</>,
    means: lever ? 'Shows this fix in the approval window, where you approve it. Nothing is sent yet.' : 'Opens the approval window. Nothing is sent until you approve there.',
    onClick: () => void open.run(args),
    disabled: open.pending,
    title: `${need.headline} · Opens the approval window, the only place a fix can be approved`,
  }] : [];
  return (
    <DecisionCard className="rs-card"
      context={<>{disp.title}{deal.mode !== 'sandbox' ? <ModeBadge mode={deal.mode} /> : null}
        {view && view.source !== 'replay' && deal.mode === 'sandbox' ? <Chip tone="line" title="PayPal reported this failed renewal">{rescueSourceWord(view.source).toLowerCase()}</Chip> : null}</>}
      question={<>{cap(name)}’s renewal failed. What should happen?</>}
      why={<>PayPal couldn’t take the payment, so nothing was recovered yet.{view ? <> The invoice would go to <span className="mono">{view.recipient}</span>.</> : null}</>}
      amount={formatMinor(t.minor, t.currency)}
      options={options}
      silence={need ? silenceWords(need.on_silence) : 'nothing is sent, PayPal retries on its own'}
      deadline={need?.deadline ?? null}
      onDetails={onOpen} detailsLabel="Open deal">
      <Picks deal={deal} view={view} deadline={deadline} now={now} col={col} onPick={onPick} />
      {open.error ? <WalletNotice error={open.error} what="Approval window" /> : null}
    </DecisionCard>
  );
}

/** Whether this rescue counts as money you got back, in the wallet's words. */
function CountChip({ deal, view }: { deal: Deal; view: RescueView | undefined }) {
  const cls = chipClass(deal);
  if (view?.counted) return <Chip tone="ok" title={RESCUE_COUNTED}>counts as recovered</Chip>;
  if (cls === 'done' || deal.mode === 'replay') return <Chip tone="line" title={deal.mode === 'replay' ? RESCUE_REPLAY_NOT_COUNTED : 'PayPal hasn’t shown this paid with a saved receipt, so it doesn’t count yet.'}>not counted</Chip>;
  if (deal.state === 'AWAITING_APPROVAL' || deal.state === 'SETTLING') return <Chip tone="line" title={RESCUE_SENT_NOT_COUNTED}>not paid yet</Chip>;
  return null;
}

/** A renewal that is no longer waiting on a fix: invoice with the subscriber, or closed. */
function ProgressRow({ deal, view, name, onOpen }: { deal: Deal; view: RescueView | undefined; name: string; onOpen: () => void }) {
  const w = useWorld();
  const need = w.needOf(deal.id);
  const t = dealTotal(deal);
  const wd = wordOf(deal);
  const cls = chipClass(deal);
  return (
    <Row className="rs-row" need={!!need} onOpen={onOpen} title={<span className="nm">{cap(name)}</span>}
      sub={need ? <Silence text={silenceWords(need.on_silence)} deadline={need.deadline} /> : deskLine(deal, view)}>
      {deal.mode !== 'sandbox' ? <ModeBadge mode={deal.mode} /> : null}
      <Chip tone={TONE[cls]} title={wd.means}>{wd.text}</Chip>
      <CountChip deal={deal} view={view} />
      <span className={`amt ${view?.counted ? 'okc' : ''}`}>{formatMinor(t.minor, t.currency)}</span>
    </Row>
  );
}

// ---- Layer 1 ---------------------------------------------------------------------------------------

function Who({ deal, name, need, silence }: { deal: Deal; name: string; need: boolean; silence?: string }) {
  const wd = wordOf(deal);
  return (
    <td className="who">
      <div className="l1">
        <span className="needd">{need ? <span title="needs you"><Dot className="gold" /></span> : null}</span>
        <span className="nm" title={name}>{name}</span>
      </div>
      <div className="l2">
        <Chip tone={TONE[chipClass(deal)]} title={wd.means}>{wd.text}</Chip>
        {deal.mode !== 'sandbox' ? <ModeBadge mode={deal.mode} /> : null}
        {silence ? <Silence text={silence} /> : null}
      </div>
    </td>
  );
}

function Cell({ deal, view, col, deadline, now, peek, onFocus, onKey }: {
  deal: Deal; view: RescueView | undefined; col: Col; deadline: number | null; now: number; peek: boolean; onFocus: () => void; onKey: (e: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const st = cellState(deal, col, deadline, now, view);
  const key = `${deal.id}|${col}`;
  const common = { 'data-cell': key, role: 'radio', onFocus, onClick: onFocus, onKeyDown: onKey } as const;
  if (st.kind === 'default') {
    return (
      <button type="button" {...common} className={`cell def ${peek ? 'peek' : ''}`} aria-checked tabIndex={0}
        aria-label="Do nothing: nothing is sent. The default.">
        <span className="v">Nothing sent</span><span className="s">{retryWords(deadline, now)}</span>
      </button>
    );
  }
  const lever = leverOf(col as LeverKey);
  if (st.kind === 'offer') {
    return (
      <button type="button" {...common} className={`cell offer ${peek ? 'peek' : ''}`} aria-checked={false} tabIndex={-1}
        title={`${lever.name}: ${formatMoney(st.offer.invoice)} instead of ${formatMoney(st.offer.cycle)}`} aria-label={`${lever.name}: ${formatMoney(st.offer.invoice)}, ${percentWords(st.offer.discount_bp)} off`}>
        <span className="v money">{formatMoney(st.offer.invoice)}</span><span className="s">{percentWords(st.offer.discount_bp)} off</span>
      </button>
    );
  }
  const off = st.kind === 'off';
  const why = off ? (st.code === 'REPLAY' ? 'a replay' : st.code === 'NOT_BUILT' ? GIST[col as LeverKey] : 'retry due soon') : 'not shown';
  return (
    <button type="button" {...common} className={`cell ${off ? 'off' : 'unknown'} ${peek ? 'peek' : ''}`} aria-checked={false} aria-disabled tabIndex={-1}
      title={`${lever.name}: ${st.why}`} aria-label={`${lever.name}: ${st.why}`}>
      <span className="v">{off && st.code !== 'NOT_BUILT' ? 'Not now' : 'Not yet'}</span><span className={`s ${off && st.code !== 'NOT_BUILT' ? 'why' : ''}`}>{why}</span>
    </button>
  );
}

function NeverCell({ rows }: { rows: number }) {
  const [a, setA] = useState<HTMLElement | null>(null);
  return (
    <td className="neverc" rowSpan={rows}>
      <Btn sm kind="plain" className="x" aria-label="Why a price change for everyone is never offered" onClick={(e) => { const t = e.currentTarget; setA((x) => (x ? null : t)); }}>✕</Btn>
      <div>never</div>
      {a ? (
        <Popover anchor={a} onClose={() => setA(null)} title="Never a price change for everyone">
          <p className="rsc-pop">Changing the plan price would change it for every subscriber, not just the one who is struggling. No fix, agent or approval can do that from here, by design.</p>
        </Popover>
      ) : null}
    </td>
  );
}

/** One line for a rescue that is no longer waiting on a fix. */
function deskLine(d: Deal, view: RescueView | undefined): string {
  if (d.state === 'SETTLING') return 'Invoice being made · nothing is paid yet';
  if (d.state === 'AWAITING_APPROVAL') return `Invoice sent${view ? ` to ${view.recipient}` : ''} · waiting for the subscriber to pay`;
  if (view?.counted) return 'Paid on PayPal · receipt saved';
  if (chipClass(d) === 'done') return d.mode === 'replay' ? 'Paid to you · a replay, never counted' : 'Paid to you';
  return moneyNow(d);
}

function SpanRow({ deal, view, name, on, onPeek }: { deal: Deal; view: RescueView | undefined; name: string; on: boolean; onPeek: () => void }) {
  const w = useWorld();
  const need = w.needOf(deal.id);
  const t = dealTotal(deal);
  return (
    <tr className={`sr ${on ? 'on' : ''}`} onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) onPeek(); }}>
      <Who deal={deal} name={name} need={!!need} silence={need ? need.on_silence : undefined} />
      <td className="span" colSpan={COLS.length + 1}>
        <button type="button" className="spanline" onClick={onPeek} onFocus={onPeek}>
          <span className="t">{deskLine(deal, view)}</span>
          <span className="money">{formatMinor(t.minor, t.currency)}</span>
          <CountChip deal={deal} view={view} />
          <span className="chev" aria-hidden="true" />
        </button>
      </td>
      <td className="act">{need ? <HandOff dealId={deal.id} label="Review ↗" sm quiet title={need.headline} /> : <span className="dim">—</span>}</td>
    </tr>
  );
}

const WHY_NOT: Record<NotCountedWhy, string> = {
  REPLAY: 'a replayed failure, never counted',
  scripted: 'a practice-agent row',
  failing: 'renewal still failing · nothing recovered yet',
  sent: 'invoice not paid yet',
  unverified: 'paid, but not shown paid by PayPal with a saved receipt',
  closed: 'closed · nothing recovered',
};

function RecoveredButton({ deals, book, label }: { deals: Deal[]; book: RescueBook | null; label: (d: Deal) => string }) {
  const [a, setA] = useState<HTMLElement | null>(null);
  const r = useMemo(() => recovered(deals, book), [deals, book]);
  const total = r.totals.length ? r.totals.map((t) => formatMinor(t.minor, t.currency)).join(' · ') : 'none yet';
  return (
    <>
      <button type="button" className="recov" onClick={(e) => { const t = e.currentTarget; setA((x) => (x ? null : t)); }} aria-haspopup="dialog">
        <span className="k">Recovered</span><span className={`money ${r.totals.length ? 'okc' : ''}`}>{total}</span>
      </button>
      {a ? (
        <Popover anchor={a} onClose={() => setA(null)} title={`Recovered · ${total}`}>
          <div className="rsc-pop">
            <h4>Counts</h4>
            <ul className="rules">{r.counted.length ? r.counted.map((d) => { const t = dealTotal(d); return <li key={d.id} className="ok">{label(d)} · {wordOf(d).text.toLowerCase()} · <span className="money">{formatMinor(t.minor, t.currency)}</span></li>; })
              : <li className="unk">no rescued payment yet</li>}</ul>
            <h4>Doesn’t count</h4>
            <ul className="rules">{r.notCounted.length ? r.notCounted.map(({ deal, why }) => <li key={deal.id} className="x">{label(deal)} · {WHY_NOT[why as NotCountedWhy] ?? why}</li>) : <li className="unk">nothing</li>}</ul>
            <p className="ui-hint">Only an invoice PayPal shows paid, with its receipt saved, counts, and only for a renewal PayPal reported failed. Replays never do, and sent is not paid. Each currency is added up on its own.</p>
          </div>
        </Popover>
      ) : null}
    </>
  );
}

/** The owner's watched subscriptions: how many, today's checks, and where to change the list (the
 *  approval window, like every other owner setting). Checking only reads PayPal. */
function WatchRow({ book, failed }: { book: RescueBook | null; failed: boolean }) {
  const open = useMutation('approval_open');
  const n = book?.watching.length ?? 0;
  const failing = book?.watching.filter((w) => w.state === 'fix_opened' || w.state === 'failed_no_fix').length ?? 0;
  const sub = !book
    ? failed ? 'Can’t be read right now' : 'Reading…'
    : n === 0
      ? 'Watch a subscription and your wallet checks it with PayPal for a failed renewal. Checking never moves money.'
      : failing
        ? `${failing} with a failed renewal · checked with PayPal every few hours; checking never moves money`
        : 'Checked with PayPal every few hours for a failed renewal; checking never moves money';
  return (
    <Group className="rsc-watch">
      <Row title={book ? watchingWords(n) : 'Watched subscriptions'} sub={sub}>
        {book && n ? <Chip tone="line" title={RESCUE_WATCH_ABOUT}>{book.watch_reads_today} of {book.watch_reads_max} checks today</Chip> : null}
        <Btn sm onClick={() => void open.run({ deal_id: null, target: 'rescue_watch' })} disabled={open.pending} title={`${RESCUE_WATCH_ABOUT} Opens the approval window.`}>
          {n ? 'Manage ↗' : 'Watch a subscription ↗'}
        </Btn>
      </Row>
      {open.error ? <WalletNotice error={open.error} what="Approval window" /> : null}
    </Group>
  );
}

/** Replaying a failed renewal is recorded in the approval window (PayPal can’t fail a test renewal). */
function ReplayButton() {
  const open = useMutation('approval_open');
  return (
    <>
      <Btn sm onClick={() => void open.run({ deal_id: null, target: 'rescue' })} disabled={open.pending} title={`${RESCUE_REPLAY_ABOUT_TEXT} Opens the approval window.`}>Replay a renewal ↗</Btn>
      {open.error ? <WalletNotice error={open.error} what="Approval window" /> : null}
    </>
  );
}

function MandateInfo({ nav }: { nav: ModuleProps['nav'] }) {
  const [a, setA] = useState<HTMLElement | null>(null);
  const q = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  const rescue = (q.data ?? []).filter((m) => !m.refusal && m.payload.clauses.some((c) => c.type === 'lever'));
  const lever = rescue.at(-1)?.payload.clauses.find((c) => c.type === 'lever');
  return (
    <>
      <Btn sm kind="plain" onClick={(e) => { const t = e.currentTarget; setA((x) => (x ? null : t)); }} aria-haspopup="dialog">Rescue rules ⓘ</Btn>
      {a ? (
        <Popover anchor={a} onClose={() => setA(null)} title="Your rescue rules">
          <div className="rsc-pop">
            {q.error ? <WalletNotice error={q.error} what="Your rules" /> : (
              <Kv items={[
                ['Signed', rescue.length ? <span title={rescue.map((m) => `${shortId(m.payload.id)} v${m.payload.version}`).join(' · ')}>{rescue.length} rule set{rescue.length === 1 ? '' : 's'} cover rescues</span> : 'no signed rules cover rescues yet'],
                ['Fixes', lever ? ruleSentence(lever) : <span className="unk">no fixes allowed yet</span>],
                ['Scope', 'one fix acts on one subscriber only'],
                ['Never', 'a price change for everyone on the plan'],
                ['Invoice', 'a fixed wording from your wallet, never written by an agent'],
              ]} />
            )}
            <p><Btn sm onClick={() => { setA(null); nav.onSheet('mandates'); }}>Open agent rules</Btn></p>
          </div>
        </Popover>
      ) : null}
    </>
  );
}

// ---- Layer 2: the inspector -------------------------------------------------------------------------

function Decision({ deal, lever }: { deal: Deal; lever?: LeverKey }) {
  const w = useWorld();
  const need = w.needOf(deal.id);
  if (!need) return null;
  return (
    <Section title="Your decision">
      <div className="decide"><HandOff dealId={deal.id} label={lever ? `Review ${leverOf(lever).short.toLowerCase()} ↗` : 'Review & approve ↗'} title={need.headline} lever={lever} /></div>
      <p className="sil"><Silence text={need.on_silence} deadline={need.deadline} /></p>
      <p className="ui-hint">{RESCUE_APPROVE_DOES}</p>
    </Section>
  );
}

function CellDetail({ deal, view, col, deadline, now }: { deal: Deal; view: RescueView | undefined; col: Col; deadline: number | null; now: number }) {
  const st = cellState(deal, col, deadline, now, view);
  if (col === 'NONE') {
    return (
      <>
        <div className="chips"><Chip tone="ok">safe default</Chip></div>
        <Decision deal={deal} />
        <Section title="What happens">
          <ul className="rules">
            <li className="ok">Nothing is sent: no PayPal call, no email.</li>
            <li className="ok">{deadline ? `PayPal retries the payment by itself in ${timeLeftWords(deadline - now)} (${clockLabel(deadline)}). If that works, it is paid without a fix.` : 'PayPal has no retry scheduled. This month stays unpaid.'}</li>
            <li className="ok">If you never decide, nothing is ever sent.</li>
          </ul>
        </Section>
      </>
    );
  }
  const lever = leverOf(col);
  const offer = st.kind === 'offer' ? st.offer : null;
  return (
    <>
      <div className="chips">
        {offer ? <Chip tone="ok">inside your rules</Chip> : st.kind === 'off' && st.code !== 'NOT_BUILT' ? <Chip tone="red">not now</Chip> : <Chip tone="dashed" title={st.kind === 'off' || st.kind === 'unknown' ? st.why : undefined}>not available yet</Chip>}
      </div>
      <Decision deal={deal} lever={offer ? col : undefined} />
      <Section title="What it does · this subscriber only">
        {offer ? <p>One PayPal invoice for this cycle at <b className="money">{formatMoney(offer.invoice)}</b> instead of {formatMoney(offer.cycle)} ({percentWords(offer.discount_bp)} off). This cycle only; the plan and its price stay the same.</p>
          : st.kind === 'off' && st.code !== 'NOT_BUILT' ? <p className="red">{st.why}. This fix can’t be used for this renewal.</p> : <p>{lever.effect}. {st.kind === 'off' || st.kind === 'unknown' ? st.why : ''}.</p>}
        <details className="ui-disclosure calls-d"><summary>PayPal calls</summary>
          <ul className="calls">{lever.calls.map((c) => <li key={c}>{c}</li>)}</ul>
        </details>
      </Section>
      <Section title="Checks">
        <ul className="rules">{rulesFor(deal, col, deadline, now, view).map(([k, t]) => <li key={t} className={k}>{t}</li>)}</ul>
      </Section>
      <Section title="What the subscriber sees">
        {offer && view ? (
          <div className="rs-inv" aria-label="The invoice’s wording">
            <p className="it">{view.text.item}</p>
            <p className="nt">{view.text.note}</p>
            <p className="ui-hint">PayPal emails it to {view.recipient}. The wording is your wallet’s, the same for every subscriber; no agent writes it.</p>
          </div>
        ) : <p>{lever.hears}.</p>}
      </Section>
    </>
  );
}

function DeskDetail({ deal, view, deadline }: { deal: Deal; view: RescueView | undefined; deadline: number | null }) {
  const w = useWorld();
  const need = w.needOf(deal.id);
  const disp = w.display(deal);
  const t = dealTotal(deal);
  const pp = deal.paypal;
  const silence = need?.on_silence ?? disp.on_silence;
  const ids = [pp.subscription && `subscription ${pp.subscription}`, pp.order && `invoice ${pp.order}`].filter(Boolean).join(' · ');
  const wd = wordOf(deal);
  return (
    <>
      <div className="chips"><Chip tone={TONE[chipClass(deal)]} title={wd.means}>{wd.text}</Chip>{deal.mode !== 'sandbox' ? <ModeBadge mode={deal.mode} /> : null}<CountChip deal={deal} view={view} /></div>
      <Decision deal={deal} />
      <Kv items={[
        ['Money', <><span className="money">{formatMinor(t.minor, t.currency)}</span> · {deskLine(deal, view).toLowerCase()}</>],
        view ? ['Fix', `${percentWords(view.offer.discount_bp)} off ${formatMoney(view.offer.cycle)}, this cycle only`] : null,
        view ? ['Source', rescueSourceWord(view.source)] : null,
        deadline ? ['Deadline', clockLabel(deadline)] : null,
        silence ? ['If you do nothing', silence] : null,
        !!ids && ['PayPal ids', <span className="mono dim">{ids}</span>],
      ]} />
    </>
  );
}

/** Hands the decision to the approval window (approval_open). Never releases money itself. */
function HandOff({ dealId, label, sm, title, lever, quiet }: { dealId: string; label: ReactNode; sm?: boolean; title?: string; lever?: LeverKey; /** A row's hand-off beside the inspector's: not the page's one gold button. */ quiet?: boolean }) {
  const w = useWorld();
  const open = useMutation('approval_open');
  // The fix picked here travels as a draft: the approval window shows it and still decides.
  const args = lever ? { deal_id: dealId, target: 'deal' as const, draft: { type: 'lever' as const, lever } } : { deal_id: dealId };
  return (
    <>
      <Btn kind={quiet ? 'default' : 'gold'} sm={sm} locked={w.locked} disabled={open.pending} onClick={() => void open.run(args)}
        title={`${title ? `${title} · ` : ''}Opens the approval window, the only place a fix can be approved`}>{label}</Btn>
      {open.error ? <WalletNotice error={open.error} what="Approval window" /> : null}
    </>
  );
}
