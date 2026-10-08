// Shield module page, told as a story (docs/ux/ROUND-1.md): one sentence answers "did anything
// suspicious happen?", a first-visit explainer shows the three steps, a decision card stands for
// every paused payment (the reasons as plain lines with icons), then stopped payments as one line
// each and the cleared ones folded into a count. The evidence matrix (each payee a column; the
// outcome rows on top, the checks this window can show below) sits behind Simple / Detailed, with
// its keyboard: arrows move the cursor, the Inspector explains the focused cell, O opens the deal,
// R hands a pause to the approval window (the typed-name release happens there), P shows only the
// outcome. Those keys act only while the matrix is on screen (Detailed).
// Releasing never happens in Main; a BLOCK has no release anywhere. Their words show only through
// <Quarantine> (NoteChip). Pure logic: ./shield/matrix.ts.
// Round 2: in Simple, a week strip of three tiles on top and, under each paused payment, "what's
// normal vs this payment", three check lights and a Why? on each reason (./shield/Panels.tsx, facts
// in ./shield/normal.ts).
// Owner: the shield agent. Styles: ./shield.css, scoped under .mod-shield.
import { useEffect, useMemo, useRef, useState, type ReactNode, Fragment } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import type { ShieldVerdict } from '@bindings/ShieldVerdict';
import { formatMinor, shortId } from '../../../lib/format';
import { useMutation, useNow, useQuery } from '../../../lib/hooks';
import { joinWords, shieldReleased, shieldRuleWord, shieldWord } from '../../../lib/words';
import { MinorMoney, WalletNotice } from '../../../shared/honesty';
import { Glyph, MODULE } from '../../../shared/modules';
import {
  AnswerBar, Btn, Chip, DecisionCard, DetailToggle, Explainer, Group, Hint, Icon, Inspector, Kv, PageHead, Popover, Row, Section, Seg, Sheet, Silence, useDetail, useLayerCount,
  type DecisionOption,
} from '../../../shared/ui';
import { canWithdraw, dealTotal, moneyNow, stateLabel } from '../logic';
import { useCpLookup, useToast } from '../ui';
import { useWorld } from '../world';
import type { ModuleProps } from './common';
import { NoteChip, NoteText } from './shield/NoteChip';
import { CheckLights, ComparePanel, ReasonWhy, WeekTiles } from './shield/Panels';
import { knownPayees, weekStrip } from './shield/normal';
import { bandGeometry, CHECKS, checkCell, moveCursor, overMedian, paypalLine, reasonsFor, releasable, ROWS, shieldNeed, STAGES, UNSHOWN, type CheckKey, type RowKey } from './shield/matrix';
import './shield.css';

const VerdictChip = ({ v }: { v: ShieldVerdict | null }) => {
  if (!v) return <Chip tone="dashed" title="The shield has not recorded a verdict for this deal">no verdict</Chip>;
  const w = shieldWord(v);
  return <Chip tone={w.tone} title={w.means}>{w.text}</Chip>;
};
const VERDICT_NOTE: Record<ShieldVerdict, string> = { CLEAR: '', ASK: '', HOLD: '', BLOCK: 'for good' };
const isCheck = (k: RowKey): k is CheckKey => CHECKS.some((c) => c.k === k);
const ROW_LABEL: Partial<Record<RowKey, string>> = { verdict: 'Shield says', paypal: 'PayPal', move: 'Your decision', words: 'Their note' };
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The Shield page. The root (.module.mod-shield, --mc) comes from ModuleView. */
export function Shield({ deals, nav }: ModuleProps) {
  const w = useWorld();
  const now = useNow();
  const toast = useToast();
  const layers = useLayerCount();
  const cpOf = useCpLookup();
  const [mode, setMode] = useDetail('shield');
  const detailed = mode === 'detailed';
  const cpList = useQuery('counterparty_list', null, { refreshOn: ['deal:changed'] });
  const known = useMemo(() => knownPayees(cpList.data), [cpList.data]);
  // Columns: this module's pauses and blocks, then every other deal the shield checked.
  const cols = useMemo(() => {
    const others = (w.deals.data ?? []).filter((d) => w.moduleOfDeal(d) !== 'shield' && d.shield);
    const rank = (d: Deal) => (shieldNeed(d, w.needOf(d.id)) ? 0 : 1);
    return [...deals, ...others.sort((a, b) => rank(a) - rank(b))];
  }, [deals, w]);
  const [cur, setCur] = useState({ r: ROWS.indexOf('verdict'), c: 0 });
  const [passes, setPasses] = useState(true);
  const [legendA, setLegendA] = useState<HTMLElement | null>(null);
  const [how, setHow] = useState(false);
  const [refuse, setRefuse] = useState<Deal | null>(null);
  const [showCleared, setShowCleared] = useState(false);
  const grid = useRef<HTMLTableElement>(null);
  const open = useMutation('approval_open');
  const withdraw = useMutation('deal_withdraw');

  const needOf = (d: Deal) => shieldNeed(d, w.needOf(d.id));
  const c = Math.min(cur.c, Math.max(0, cols.length - 1));
  const sel = cols[c] ?? null;
  const rowKey = ROWS[cur.r] ?? 'verdict';
  const focusCell = (r: number, col: number) => setTimeout(() => (grid.current?.querySelector(`[data-cell="${r}:${col}"]`) as HTMLElement | null)?.focus({ preventScroll: false }), 0);
  const go = (r: number, col: number, focus = true) => { setCur({ r, c: col }); if (focus) focusCell(r, col); };

  const release = async (d: Deal) => {
    const r = await open.run({ deal_id: d.id });
    if (r !== undefined) toast(<>The approval window is open · <b>type the payee&apos;s name there to release</b>. Releasing doesn&apos;t pay: you still approve on PayPal after.</>, 'gold');
  };

  // Page keys (paused while a layer is open, while typing, or while the matrix is not on screen).
  const ref = useRef({ cur, cols, c, sel, release, passes, detailed });
  ref.current = { cur, cols, c, sel, release, passes, detailed };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (layers > 0 || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || !ref.current.detailed) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const inGrid = !!t?.closest?.('.sh-mx');
      const onCell = !!t?.dataset?.cell;
      const free = inGrid || t === document.body || t?.tagName === 'H1' || !!t?.classList?.contains('view');
      if (!free) return;
      const s = ref.current;
      const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      const a = arrows[e.key];
      if (a && (onCell || free)) { e.preventDefault(); const n = moveCursor({ r: s.cur.r, c: s.c }, a[0], a[1], ROWS.length, s.cols.length); go(n.r, n.c); return; }
      if (e.key === 'Home' && onCell) { e.preventDefault(); go(s.cur.r, 0); return; }
      if (e.key === 'End' && onCell) { e.preventDefault(); go(s.cur.r, s.cols.length - 1); return; }
      if (e.key === 'Enter' && onCell) { e.preventDefault(); (t?.querySelector('button') as HTMLElement | null)?.focus(); return; } // focus only: Enter never releases
      const key = e.key.toLowerCase();
      if (key === 'o' && s.sel) { e.preventDefault(); nav.onDeal(s.sel.id); return; }
      if (key === 'p') { e.preventDefault(); setPasses((x) => !x); return; }
      if (key === 'r' && s.sel) {
        e.preventDefault();
        if (releasable(s.sel) && needOf(s.sel)) void s.release(s.sel);
        else toast(<>Nothing to release on {w.display(s.sel).title} · {s.sel.shield === 'BLOCK' ? 'a block can’t be released' : s.sel.shield ? `the shield says “${shieldWord(s.sel.shield).text}”` : 'the shield has no verdict'}.</>);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [layers, nav, toast, w]);

  // The story: paused payments need you, blocked ones are final, the rest is quiet.
  const paused = cols.filter((d) => d.shield !== 'BLOCK' && needOf(d));
  const blocked = cols.filter((d) => d.shield === 'BLOCK');
  const closed = cols.filter((d) => d.shield === 'HOLD' && !needOf(d));
  const cleared = cols.filter((d) => d.shield === 'CLEAR' && !needOf(d));
  // A hold the owner released goes on for its terms: it is not stopped, so it sits with you, not under "Stopped".
  const released = cols.filter((d) => d.shield !== 'BLOCK' && !!d.shield_release && !needOf(d));
  const other = cols.filter((d) => d.shield !== 'BLOCK' && d.shield !== 'HOLD' && d.shield !== 'CLEAR' && !d.shield_release && !needOf(d));
  const stopped = [...blocked, ...closed, ...other];

  const cellProps = (r: number, col: number, extra = '') => ({
    'data-cell': `${r}:${col}`,
    tabIndex: cur.r === r && c === col ? 0 : -1,
    'aria-selected': cur.r === r && c === col,
    className: `cell ${cur.r === r && c === col ? 'cur' : c === col ? 'colcur' : ''} ${extra}`,
    onClick: () => go(r, col, false),
    onFocus: () => { if (cur.r !== r || c !== col) setCur({ r, c: col }); },
  });

  const body: ReactNode[] = [];
  const grp = (k: string, t: string) => body.push(<tr key={`g-${k}`} className="grp"><th colSpan={cols.length + 1} scope="colgroup">{t}</th></tr>);
  ROWS.forEach((rk, r) => {
    if (rk === 'head') return;
    const chk = CHECKS.find((x) => x.k === rk);
    if (rk === 'newcp') grp('checks', 'Checks');
    if (rk === 'words') {
      body.push(
        <tr key="unshown" className="unshown">
          <th scope="row">Other checks</th>
          <td colSpan={cols.length} className={!passes ? 'faint' : ''}>
            <div className="rc"><span className="sh-unk" aria-hidden="true" /><span className="t">{UNSHOWN.map((k) => CHECKS.find((x) => x.k === k)!.short).join(' · ')}</span>
              <span className="d">their own results aren’t reported here; each counts in “Shield says”</span>
              <Btn kind="plain" sm className="sh-more" onClick={() => setHow(true)}>How it works ›</Btn></div>
          </td>
        </tr>,
      );
      grp('words', 'What they sent');
    }
    body.push(
      <tr key={rk} className={rk}>
        <th scope="row" title={chk ? `${chk.name}. ${chk.kind}.` : undefined}>{chk ? (rk === 'market' ? 'Price vs typical' : chk.short) : ROW_LABEL[rk]}</th>
        {cols.map((d, col) => <GridCell key={d.id} rk={rk} deal={d} need={needOf(d)} props={cellProps} r={r} col={col} passes={passes} now={now}
          onRelease={() => void release(d)} onRefuse={() => setRefuse(d)} onDeal={() => nav.onDeal(d.id)} />)}
      </tr>,
    );
  });

  // The answer, from the same lists the page shows.
  let answer: ReactNode;
  const clearedLine = cleared.length ? `${count(cleared.length, 'payment')} looked safe.` : '';
  const neverSent = stopped.every((d) => paypalLine(d)[0].startsWith('Nothing sent'));
  if (paused.length) {
    const lead = paused[0]!;
    const t = dealTotal(lead);
    answer = (
      <AnswerBar tone="need"
        title={paused.length === 1 ? <>A {formatMinor(t.minor, t.currency)} payment to {cpOf(lead.counterparty).name} is paused. Your call.</> : <>{paused.length} payments are paused for you. Your call.</>}
        sub={<>Nothing was sent to PayPal.{blocked.length ? ` ${count(blocked.length, 'payment')} blocked for good.` : ''} {clearedLine}</>} />
    );
  } else if (stopped.length) {
    const parts = [blocked.length ? `${blocked.length} blocked for good` : null, closed.length ? `${closed.length} paused, then closed` : null].filter((x): x is string => !!x);
    answer = (
      <AnswerBar tone="alert"
        title={`${count(stopped.length, 'payment')} ${stopped.length === 1 ? 'was' : 'were'} stopped for your safety.`}
        sub={<>{parts.length ? `${cap(joinWords(parts))}. ` : ''}{neverSent ? 'PayPal was never asked. ' : ''}Nothing needs you. {clearedLine}</>} />
    );
  } else {
    answer = <AnswerBar tone="calm" title="All quiet. Nothing suspicious happened." sub={cols.length ? clearedLine : 'The shield hasn’t had to check anyone yet.'} />;
  }

  return (
    <div className="sh-page">
      <PageHead title="Shield" icon={<Glyph module="shield" />} focusKey="shield"
        sub="Checks every payment for scam signs before PayPal is asked"
        actions={<>
          {detailed ? (
            <>
              <Seg label="Show" value={passes ? 'all' : 'decided'} onChange={(v) => setPasses(v === 'all')}
                options={[{ value: 'all', label: 'Everything' }, { value: 'decided', label: 'Outcome only', title: 'Fade the checks (P)' }]} />
              <Btn kind="plain" sm aria-label="How the shield works" onClick={(e) => { const t = e.currentTarget; setLegendA((x) => (x ? null : t)); }}>How it works ⓘ</Btn>
            </>
          ) : null}
          <DetailToggle value={mode} onChange={setMode} />
        </>} />
      {legendA && detailed ? (
        <Popover anchor={legendA} onClose={() => setLegendA(null)} title="How the shield works" className="mod-shield">
          <p className="sh-pop-lede">Before any money moves to a payee, the shield runs a few checks. A check can stop a payment, never approve one.</p>
          <div className="sh-legend">
            <span><VerdictChip v="CLEAR" /> nothing found</span>
            <span><VerdictChip v="HOLD" /> only you can release it</span>
            <span><VerdictChip v="BLOCK" /> stopped for good</span>
            <span><span className="sh-hatch" aria-hidden="true" /> no typical price to compare, so it asks you</span>
            <span><Chip tone="dashed">note ›</Chip> their own words, shown as plain text</span>
          </div>
          <Btn kind="plain" sm className="sh-gap" onClick={() => { setLegendA(null); setHow(true); }}>All the checks ›</Btn>
        </Popover>
      ) : null}

      {answer}

      {!detailed ? <WeekTiles strip={weekStrip(cols, now, (d) => !!needOf(d))} /> : null}

      <div className="sh-explain">
        <Explainer id="shield" title="How the shield works" steps={[
          { icon: 'eye', title: 'New payees get checked', text: 'Every payee is looked at before any PayPal call.' },
          { icon: 'tag', title: 'Odd prices pause it', text: 'A price far above typical stops the payment.' },
          { icon: 'you', title: 'Only you can unpause', text: 'Releasing happens in the approval window.' },
        ]} />
      </div>

      {paused.length ? (
        <section className="sh-decisions" aria-label="Needs you">
          {paused.map((d) => <PausedDecision key={d.id} deal={d} need={needOf(d)!} now={now} known={known} onRelease={() => void release(d)} onRefuse={() => setRefuse(d)} onDeal={() => nav.onDeal(d.id)} />)}
        </section>
      ) : null}
      {[open.error, withdraw.error].map((e, i) => (e ? <WalletNotice key={i} error={e} what={i ? 'Refuse' : 'Approval window'} /> : null))}

      {detailed ? (
        !cols.length ? <div className="ui-group"><div className="ui-empty">Nothing paused, nothing blocked. The shield hasn’t had to check anyone yet.</div></div> : (
          <div className="sh-mxwrap">
            <table className="sh-mx" role="grid" aria-label="Shield checks for each payee" aria-readonly="true" ref={grid}>
              <colgroup><col className="lab" />{cols.map((d) => <col key={d.id} />)}</colgroup>
              <thead>
                <tr>
                  <th className="corner" scope="col">Payee</th>
                  {cols.map((d, col) => <HeadCell key={d.id} deal={d} need={needOf(d)} props={cellProps(0, col, needOf(d) ? 'need' : '')} />)}
                </tr>
              </thead>
              <tbody>{body}</tbody>
            </table>
          </div>
        )
      ) : (
        <>
          {stopped.length ? (
            <Section title="Stopped" end={count(stopped.length, 'payment')}>
              <Group className="sh-list">{stopped.map((d) => <ShieldRow key={d.id} deal={d} onOpen={() => nav.onDeal(d.id)} />)}</Group>
            </Section>
          ) : null}
          {released.length ? (
            <Section title="You let these go on" end={count(released.length, 'payment')}>
              <Group className="sh-list">{released.map((d) => <ShieldRow key={d.id} deal={d} onOpen={() => nav.onDeal(d.id)} />)}</Group>
            </Section>
          ) : null}
          {cleared.length ? (
            <div className="sh-cleared">
              <button type="button" className="sh-cleared-b" aria-expanded={showCleared} onClick={() => setShowCleared((x) => !x)}>
                <Icon name="check" size={14} />{count(cleared.length, 'payment')} looked safe<span className="more">{showCleared ? 'Hide' : 'Show'}</span>
              </button>
              {showCleared ? <Group className="sh-list">{cleared.map((d) => <ShieldRow key={d.id} deal={d} onOpen={() => nav.onDeal(d.id)} />)}</Group> : null}
            </div>
          ) : null}
        </>
      )}

      {detailed && sel ? (
        <Inspector label="Shield details">
          <div className="mod-shield sh-insp" aria-live="polite">
            <CellStory rk={rowKey} deal={sel} need={needOf(sel)} now={now} onRelease={() => void release(sel)} onRefuse={() => setRefuse(sel)} onDeal={() => nav.onDeal(sel.id)} onHow={() => setHow(true)} />
          </div>
        </Inspector>
      ) : null}

      {how ? <HowSheet onClose={() => setHow(false)} /> : null}
      {refuse ? (
        <Sheet title={`Refuse “${w.display(refuse).title}”?`} size="narrow" onClose={() => setRefuse(null)} className="mod-shield"
          footer={<>
            <Btn onClick={() => setRefuse(null)}>Keep it paused</Btn>
            <Btn kind="danger" disabled={withdraw.pending} onClick={async () => {
              const d = refuse;
              const r = await withdraw.run({ deal_id: d.id });
              setRefuse(null);
              if (r === null) toast(<>{w.display(d).title} refused · <b>no money moved</b> and PayPal was never asked.</>, 'ok');
            }}>{withdraw.pending ? 'Refusing…' : 'Refuse purchase'}</Btn>
          </>}>
          <Kv items={[
            ['What happens', 'The purchase is cancelled for good.'],
            ['Money', 'None moves. PayPal was never asked, so there is nothing to undo.'],
            ['Where', 'Right here. Saying no never needs the approval window.'],
          ]} />
        </Sheet>
      ) : null}
    </div>
  );
}

const cap = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

// ---- Layer 1: a decision card per paused payment ---------------------------------------------------------

function PausedDecision({ deal, need, now, known, onRelease, onRefuse, onDeal }: { deal: Deal; need: AttentionItem; now: number; known: { known: number; total: number } | null; onRelease: () => void; onRefuse: () => void; onDeal: () => void }) {
  const w = useWorld();
  const disp = w.display(deal);
  const cp = useCpLookup()(deal.counterparty);
  const t = dealTotal(deal);
  const mayRefuse = canWithdraw(deal) && need.actions.includes('withdraw');
  const live = releasable(deal);
  const lock = w.locked ? <Icon name="hold" size={13} /> : null;
  const lockTitle = w.locked ? 'Locked after 15 quiet minutes: the approval window asks for Windows Hello' : undefined;
  const options: DecisionOption[] = [];
  if (live) {
    options.push({ kind: 'gold', label: <>{lock}Review &amp; release ↗</>, title: lockTitle ?? 'Opens the approval window, where you type the payee’s name to release it', onClick: onRelease,
      means: 'Opens the approval window. You type the payee’s name there to release it. Releasing doesn’t pay.' });
  } else if (need.actions.includes('review')) {
    options.push({ kind: 'gold', label: <>{lock}Review ↗</>, title: lockTitle, onClick: onRelease, means: 'Opens the approval window to decide. Nothing moves until you confirm there.' });
  } else {
    options.push({ label: 'Open deal ›', onClick: onDeal, means: 'See the whole deal. Nothing moves from here.' });
  }
  if (mayRefuse) options.push({ kind: 'danger', label: 'Refuse…', onClick: onRefuse, means: 'Cancels it for good. No money moves and PayPal is never asked.' });
  const reasons = reasonsFor(deal, cp.entry, now);
  return (
    <DecisionCard
      context={<><Icon name="pause" size={13} />Paused before PayPal · {disp.title}<NoteChip dealId={deal.id} who={cp.name} /></>}
      onDetails={onDeal} detailsLabel="Open deal"
      question={live ? <>Let this payment to {cp.name} go ahead?</> : <>What should happen with the payment to {cp.name}?</>}
      amount={<MinorMoney minor={t.minor} currency={t.currency} />}
      options={options} silence={need.on_silence} deadline={need.deadline}>
      <ul className="sh-reasons" aria-label="Why it was paused">
        {reasons.map((r) => (
          <li key={r.text} title={r.detail}><span className="ico" aria-hidden="true"><Icon name={r.icon} size={14} /></span>{r.text}
            <ReasonWhy reason={r} deal={deal} cp={cp.entry} now={now} /></li>
        ))}
      </ul>
      <div className="sh-evid">
        <ComparePanel deal={deal} cp={cp.entry} known={known} now={now} />
        <CheckLights deal={deal} cp={cp.entry} now={now} />
      </div>
    </DecisionCard>
  );
}

// ---- Layer 1: stopped and cleared payments, one line each ---------------------------------------------------

function ShieldRow({ deal, onOpen }: { deal: Deal; onOpen: () => void }) {
  const w = useWorld();
  const disp = w.display(deal);
  const cp = useCpLookup()(deal.counterparty);
  const t = dealTotal(deal);
  const [a] = paypalLine(deal);
  const kind = deal.shield === 'BLOCK' ? 'block' : deal.shield === 'HOLD' ? 'closed' : deal.shield === 'CLEAR' ? 'clear' : 'other';
  const tone = { block: 'red', closed: 'dim', clear: 'ok', other: 'gold' }[kind];
  const icon = { block: 'block', closed: 'pause', clear: 'check', other: 'eye' }[kind] as 'block' | 'pause' | 'check' | 'eye';
  const pill = kind === 'closed' ? <Chip tone="line" title="The shield paused it and it closed without being released">Paused, then closed</Chip> : <VerdictChip v={deal.shield} />;
  // Which check decided it: recorded by the wallet core (Deal.shield_rule), never guessed here.
  const why = deal.shield_rule ? `${shieldRuleWord(deal.shield_rule).text.toLowerCase()} · ` : '';
  const sub = kind === 'block' ? <span className="tx-red">Blocked for good · {why}it can’t be released · {paypalLine(deal)[1]}</span>
    : kind === 'closed' ? <>Paused by the shield · {why}then {stateLabel(deal.state, deal).toLowerCase()} · {a.toLowerCase()}</>
      : kind === 'clear' ? <>{disp.title} · {stateLabel(deal.state, deal)}</>
        : shieldReleased(deal) ? <>{disp.title} · you let it go on after a pause · decided in {MODULE[w.moduleOfDeal(deal)].name}</>
          : <>{disp.title} · {why}decided in {MODULE[w.moduleOfDeal(deal)].name}</>;
  return (
    <Row className="sh-row" onOpen={onOpen} label={`${cp.name}, ${deal.shield ? shieldWord(deal.shield).text : 'no verdict'}. Open the deal`}
      lead={<span className={`sh-lead ${tone}`} aria-hidden="true"><Icon name={icon} size={13} /></span>}
      title={kind === 'block' || kind === 'closed' ? <><b>{cp.name}</b> <span className="tx-dim">· {disp.title}</span></> : <b>{cp.name}</b>}
      sub={sub}>
      {kind === 'block' ? <NoteChip dealId={deal.id} who={cp.name} /> : null}
      {pill}
      <span className={`amt ${kind === 'block' ? 'struck' : ''}`}><MinorMoney minor={t.minor} currency={t.currency} /></span>
    </Row>
  );
}

type CellPropsFn = (r: number, col: number, extra?: string) => Record<string, unknown>;

function HeadCell({ deal, need, props }: { deal: Deal; need: AttentionItem | undefined; props: Record<string, unknown> }) {
  const w = useWorld();
  const cp = useCpLookup()(deal.counterparty);
  const t = dealTotal(deal);
  const disp = w.display(deal);
  return (
    <th scope="col" {...props} title={`${disp.title} · ${disp.label} · ${MODULE[w.moduleOfDeal(deal)].name}`}>
      <div className="hc">
        <span className="l1"><b>{cp.name}</b><MinorMoney minor={t.minor} currency={t.currency} /></span>
        <small>{need ? <span className="tx-gold">Needs you</span> : stateLabel(deal.state, deal)} · {disp.title}</small>
      </div>
    </th>
  );
}

/** A tiny price bar: where the price sits against typical, with the 1.4 × line where the shield pauses. */
function PriceMini({ deal }: { deal: Deal }) {
  const p = overMedian(deal);
  if (p === null) return null;
  const scale = 1.8; // the bar spans 0 .. 1.8 × typical
  const at = Math.max(0, Math.min(1, (1 + p / 100) / scale));
  return (
    <span className={`sh-pmini ${p >= 40 ? 'over' : ''}`} aria-hidden="true">
      <i className="typ" style={{ left: `${(1 / scale) * 100}%` }} />
      <i className="flag" style={{ left: `${(1.4 / scale) * 100}%` }} />
      <i className="px" style={{ left: `${at * 100}%` }} />
    </span>
  );
}

function GridCell({ rk, deal, need, props, r, col, passes, now, onRelease, onRefuse, onDeal }: {
  rk: RowKey; deal: Deal; need: AttentionItem | undefined; props: CellPropsFn; r: number; col: number; passes: boolean; now: number;
  onRelease: () => void; onRefuse: () => void; onDeal: () => void;
}) {
  const cp = useCpLookup()(deal.counterparty);
  if (isCheck(rk)) {
    const x = checkCell(rk, deal, cp.entry, now);
    const tone = x.r === 'skip' ? 'skipcell' : x.r === 'na' ? 'nacell' : '';
    const over = rk === 'market' && (overMedian(deal) ?? 0) >= 40;
    return (
      <td {...props(r, col, `${tone} ${!passes ? 'faint' : ''}`)}>
        <div className="rc">
          {rk === 'market' ? <PriceMini deal={deal} /> : null}
          <span className={`t r-${x.r} ${over ? 'tx-coral' : ''}`} title={x.s}>{rk === 'market' ? x.s.replace(/ typical$/, '') : x.s}</span>
        </div>
      </td>
    );
  }
  if (rk === 'words') return <td {...props(r, col)}><div className="rc"><NoteChip dealId={deal.id} who={cp.name} title={`Their note · ${cp.name}`} /></div></td>;
  if (rk === 'verdict') {
    return <td {...props(r, col)}><div className="rc"><VerdictChip v={deal.shield} />{deal.shield && VERDICT_NOTE[deal.shield] ? <span className="d">{VERDICT_NOTE[deal.shield]}</span> : null}</div></td>;
  }
  if (rk === 'paypal') {
    const [a, b] = paypalLine(deal);
    return <td {...props(r, col)}><div className="rc" title={b}><b className={`t fix ${a.startsWith('Nothing sent') ? 'tx-ok' : 'tx-gold'}`}>{a}</b></div></td>;
  }
  // your decision: the one decision, in the grid
  return <td {...props(r, col, 'movecell')}><Move deal={deal} need={need} onRelease={onRelease} onRefuse={onRefuse} onDeal={onDeal} compact /></td>;
}

function Move({ deal, need, onRelease, onRefuse, onDeal, compact }: { deal: Deal; need: AttentionItem | undefined; onRelease: () => void; onRefuse: () => void; onDeal: () => void; compact?: boolean }) {
  const w = useWorld();
  const mayRefuse = !!need && canWithdraw(deal) && need.actions.includes('withdraw');
  if (deal.shield === 'BLOCK') {
    return <><b className="tx-red">Blocked for good</b><div className="ui-hint">it can’t be released</div>{!compact ? <div className="sh-mvb"><Btn sm onClick={onDeal}>Open deal ›</Btn></div> : null}</>;
  }
  if (need && releasable(deal)) {
    return (
      <>
        <div className="sh-mvb">
          <Btn sm locked={w.locked} onClick={onRelease} title={w.locked ? 'Locked after 15 quiet minutes: the approval window asks for Windows Hello' : 'Opens the approval window, where you type the payee’s name to release it'}>Review &amp; release ↗</Btn>
          {mayRefuse ? <Btn sm kind="plain" className="tx-red" onClick={onRefuse}>Refuse…</Btn> : null}
          {!compact ? <Btn sm kind="plain" onClick={onDeal}>Open deal ›</Btn> : null}
        </div>
        <Silence text={need.on_silence} deadline={need.deadline} />
      </>
    );
  }
  if (need) {
    return (
      <>
        <span className="tx-muted">{need.headline}</span>
        <div className="sh-mvb">
          {need.actions.includes('review') ? <Btn sm locked={w.locked} onClick={onRelease}>Review ↗</Btn> : <Btn sm onClick={onDeal}>Open deal ›</Btn>}
        </div>
        <Silence text={need.on_silence} deadline={need.deadline} />
      </>
    );
  }
  const m = MODULE[w.moduleOfDeal(deal)].name;
  return <><span className="tx-muted">Nothing to do here</span><div className="ui-hint">{deal.shield === 'HOLD' ? `closed · ${stateLabel(deal.state, deal).toLowerCase()}` : `the rest happens in ${m}`}</div></>;
}

// ---- Layer 2: the Inspector follows the focused cell ---------------------------------------------

function CellStory({ rk, deal, need, now, onRelease, onRefuse, onDeal, onHow }: { rk: RowKey; deal: Deal; need: AttentionItem | undefined; now: number; onRelease: () => void; onRefuse: () => void; onDeal: () => void; onHow: () => void }) {
  const w = useWorld();
  const cp = useCpLookup()(deal.counterparty);
  const disp = w.display(deal);
  const t = dealTotal(deal);
  const openBtn = <div className="sh-mvb sh-gap"><Btn sm onClick={onDeal}>Open deal ›</Btn></div>;
  if (rk === 'head') {
    return (
      <>
        <div className="sh-ik">Payee · {disp.label}</div>
        <h2>{cp.name}</h2>
        <Section>
          <Kv items={[
            ['Wants', disp.title],
            ['Amount', <MinorMoney minor={t.minor} currency={t.currency} />],
            ['Now', stateLabel(deal.state, deal)],
            ['First seen', cp.entry ? `${new Date(cp.entry.first_seen * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} (${checkCell('newcp', deal, cp.entry, now).s.toLowerCase()})` : <Chip tone="dashed">unknown</Chip>],
            cp.house ? ['Who', 'the house seller built into this app'] : null,
            ['Wallet key', <span className="mono">{shortId(deal.counterparty)}</span>],
          ]} />
        </Section>
        {openBtn}
      </>
    );
  }
  if (isCheck(rk)) {
    const chk = CHECKS.find((c) => c.k === rk)!;
    const x = checkCell(rk, deal, cp.entry, now);
    return (
      <>
        <div className="sh-ik">{STAGES[chk.stage]} · {cp.name}</div>
        <h2>{chk.name}</h2>
        <p className="sh-say">{x.s}</p>
        <p className="sh-det">{x.l}</p>
        {rk === 'market' ? <PriceBand deal={deal} /> : null}
        <Hint className="sh-gap">If this check finds something: <b>{shieldWord(chk.effect).text}</b>.</Hint>
      </>
    );
  }
  if (rk === 'words') {
    return (
      <>
        <div className="sh-ik">Their note · {disp.label}</div>
        <h2>{cp.name}</h2>
        <Section>
          <NoteText dealId={deal.id} from={cp.name} />
        </Section>
      </>
    );
  }
  if (rk === 'verdict') {
    const v = deal.shield ? shieldWord(deal.shield) : null;
    return (
      <>
        <div className="sh-ik">Shield says · {disp.title}</div>
        <h2>{v ? v.text : 'No verdict yet'}</h2>
        <p className="sh-det">{v ? v.means : 'The shield has not recorded a verdict for this deal.'}</p>
        {deal.shield_rule ? <p className="sh-det"><b>Decided by:</b> {shieldRuleWord(deal.shield_rule).text}. {shieldRuleWord(deal.shield_rule).means}</p> : null}
        {shieldReleased(deal) ? <p className="sh-det">You let it go on after a pause, for these terms only. A change to the deal is checked again.</p> : null}
        <ul className="sh-cklist">
          {CHECKS.map((chk, i) => {
            const x = checkCell(chk.k, deal, cp.entry, now);
            const stage = i === 0 || CHECKS[i - 1]!.stage !== chk.stage ? <li className="stg">{STAGES[chk.stage]}</li> : null;
            return <Fragment key={chk.k}>{stage}<li><span className={`sh-mark r-${x.r}`} aria-hidden="true" /><span>{chk.name}</span><span className={`res r-${x.r}`}>{x.s}</span></li></Fragment>;
          })}
        </ul>
        <Hint className="sh-gap">The strictest result wins. A check can only make a payment safer, and a block is final.</Hint>
        <Btn kind="plain" sm className="sh-gap" onClick={onHow}>How the shield decides ›</Btn>
      </>
    );
  }
  if (rk === 'paypal') {
    const [a, b] = paypalLine(deal);
    const p = deal.paypal;
    return (
      <>
        <div className="sh-ik">PayPal · {disp.title}</div>
        <h2>{a}</h2>
        <p className="sh-det">{b.charAt(0).toUpperCase()}{b.slice(1)}. Money right now: {moneyNow(deal)}.</p>
        {p.order || p.authorization || p.capture ? <Kv items={[p.order ? ['Order', <span className="mono">{p.order}</span>] : null, p.authorization ? ['Hold', <span className="mono">{p.authorization}</span>] : null, p.capture ? ['Payment', <span className="mono">{p.capture}</span>] : null]} /> : null}
      </>
    );
  }
  // your decision
  return (
    <>
      <div className="sh-ik">Your decision · {disp.title}</div>
      <h2>{deal.shield === 'BLOCK' ? 'Nothing to decide: blocked for good' : need && releasable(deal) ? 'Release it, or leave it paused' : need ? need.headline : 'Nothing to do here'}</h2>
      {need && releasable(deal) ? <p className="sh-det">You start here; you type the payee’s name and release it in the approval window. Releasing doesn’t pay: you still approve the payment on PayPal after.</p> : null}
      {deal.shield === 'BLOCK' ? <p className="sh-det">No button anywhere can release a block, and no PayPal link was ever opened.</p> : null}
      {!need && deal.shield !== 'BLOCK' ? <p className="sh-det">“{deal.shield ? shieldWord(deal.shield).text : 'No verdict'}” only means nothing stopped it here. Whether it is approved is decided by your rules, in {MODULE[w.moduleOfDeal(deal)].name}.</p> : null}
      <div className="sh-move"><Move deal={deal} need={need} onRelease={onRelease} onRefuse={onRefuse} onDeal={onDeal} /></div>
    </>
  );
}

/** The deal's unit price against the typical price: usual range box, typical tick, the 1.4 × line. */
function PriceBand({ deal }: { deal: Deal }) {
  const g = bandGeometry(deal);
  const m = deal.market;
  if (!g || !m) return <div className="sh-nomarket">No typical price on file, so the shield asks you.</div>;
  const cur = m.median.currency;
  const f = (v: number) => formatMinor(v, cur);
  const at = (p: number) => ({ left: `${p}%`, transform: `translateX(${p > 78 ? '-100%' : p < 18 ? '0' : '-50%'})` });
  return (
    <>
      <div className="sh-mband" role="img" aria-label={`Price ${f(deal.terms.unit_price.minor)}; typical ${f(m.median.minor)}, usually ${f(m.p25.minor)} to ${f(m.p75.minor)}; the shield pauses above ${f(Math.round(m.median.minor * 1.4))}`}>
        <div className="axis" />
        <div className="iqr" style={{ left: `${g.iqr[0]}%`, width: `${g.iqr[1] - g.iqr[0]}%` }} />
        <div className="med" style={{ left: `${g.median}%` }} /><span className="lab" style={at(g.median)}>typical</span>
        <div className="flag" style={{ left: `${g.flag}%` }} /><span className="lab" style={at(g.flag)}>pause line</span>
        <div className="px" style={{ left: `${g.price}%` }} /><span className="lab top" style={at(g.price)}>{f(deal.terms.unit_price.minor)} · {g.pct >= 0 ? '+' : ''}{g.pct}%</span>
      </div>
      <Hint>Usually {f(m.p25.minor)}–{f(m.p75.minor)} · typical {f(m.median.minor)} · a reference, not advice</Hint>
    </>
  );
}

function HowSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="How the shield decides" onClose={onClose} className="mod-shield">
      <div className="sh-l2">
        <p className="sh-det">Before any money goes to a payee, the shield runs these checks. The strictest result wins, and a check can only make a payment safer, never approve one.</p>
        <section>
          <h3>The checks</h3>
          <ol className="sh-steps">
            {CHECKS.map((c) => <li key={c.k}><b>{c.name}</b> <span className="tx-dim">· {c.kind}.</span> If it finds something: <VerdictChip v={c.effect} /></li>)}
          </ol>
          <p className="sh-det">With no typical price to compare, the price check never waves a payment through: it asks you.</p>
        </section>
        <section>
          <h3>What each result means</h3>
          <Kv items={(['CLEAR', 'ASK', 'HOLD', 'BLOCK'] as const).map((v) => [<VerdictChip v={v} />, shieldWord(v).means] as const)} />
        </section>
        <section>
          <h3>Their messages</h3>
          <p className="sh-det">The AI second opinion reads a payee’s message as plain data, once, with no tools. It can add caution; it can never remove it, and your agents never act on what the payee wrote.</p>
        </section>
      </div>
    </Sheet>
  );
}
