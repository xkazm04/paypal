// Spend module. The summary is the story in brief: one sentence answers "did my agents buy anything I
// need to look at?", a decision card stands for every held purchase, and three cards open the nested
// pages (docs/ux/UX-GUIDE.md, calm-nested-ui): This week (one line per purchase), Rule check (the gate:
// a lane per purchase running left to right through the rules you signed toward PayPal, with the
// Inspector) and Rules in force. Main never moves money: paying and releasing a hold are approval-window
// commands, so both options hand off with approval_open. Pure logic: ./spend/gate.ts.
// Owner: the spend agent. Styles: ./spend.css, scoped under .mod-spend.
import { useMemo, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import { clockLabel, formatMinor, shortId } from '../../../lib/format';
import { useMutation, useQuery } from '../../../lib/hooks';
import { joinWords, receiptWord, reconWord, RULE_NAME, rulesName, ruleSentence, SPEND_VIEW } from '../../../lib/words';
import { Countdown, MinorMoney, WalletNotice } from '../../../shared/honesty';
import { Glyph } from '../../../shared/modules';
import {
  AnswerBar, Btn, Chip, DecisionCard, DetailPage, Empty, Group, Hint, Icon, Inspector, Kv, Loading, Meter, PageHead, Popover, Row, Section, Sheet, SummaryCard,
  type DecisionOption, type IconName,
} from '../../../shared/ui';
import { amountNote, amountTone, canWithdraw, dealTotal, decidedBy, mandatesGoverning } from '../logic';
import { registerViewLabels, useModuleRoute } from '../viewNav';
import { useCpLookup, useToast } from '../ui';
import { useWorld } from '../world';
import type { ModuleProps } from './common';
import { NoteChip } from './shield/NoteChip';
import { short } from './tables/ladder';
import { CLAUSE_NO, clauseGroups, COLUMN_NAME, columnValue, gateColumns, laneCells, outcomeOf, ruleLine, velocityFill, type Cell, type GateColumn, type RuleLine } from './spend/gate';
import './spend.css';

type Sel = { kind: 'lane'; id: string } | { kind: 'clause'; n: number } | { kind: 'cell'; id: string; n: number };
type Lane = { deal: Deal; cells: Cell[]; slot: string | null; own: boolean };

const cap = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const SPEND_STEPS = [
  'Your agent finds something and asks to pay for it.',
  'Your rules check it first: limits and approved payees, before PayPal hears of it.',
  'PayPal holds the money until you pay or let it go.',
];

registerViewLabels('spend', { week: SPEND_VIEW.week, gate: SPEND_VIEW.gate, rules: SPEND_VIEW.rules });

/** A small ⓘ button that opens a popover (the old always-visible explainer lives here now). */
function InfoPop({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  const [a, setA] = useState<HTMLElement | null>(null);
  return (
    <>
      <Btn kind="plain" sm aria-label={label} title={label} aria-expanded={!!a} onClick={(e) => { const t = e.currentTarget; setA((x) => (x ? null : t)); }}>ⓘ</Btn>
      {a ? <Popover anchor={a} onClose={() => setA(null)} title={title} className="mod-spend">{children}</Popover> : null}
    </>
  );
}

/** The Spend page. The root (.module.mod-spend, --mc) comes from ModuleView. */
export function Spend({ deals, nav }: ModuleProps) {
  const w = useWorld();
  const { view, open } = useModuleRoute();
  const mq = useQuery('mandate_list', null, { refreshOn: ['settings:changed', 'deal:changed'] });
  const purchase = useMemo(() => mandatesGoverning(mq.data ?? [], 'purchase'), [mq.data]);
  const m = purchase[0] ?? null;
  const cols = useMemo(() => (m ? gateColumns(m.payload.clauses) : []), [m]);
  const needs = deals.map((d) => ({ d, need: w.needOf(d.id) })).filter((x): x is { d: Deal; need: AttentionItem } => !!x.need);

  // Lanes, newest ask first inside each agent slot (the slot is the governing mandate's agent).
  const lanes = useMemo<Lane[]>(() => {
    const byId = new Map((mq.data ?? []).map((e) => [e.payload.id, e]));
    const rows = deals.map((d): Lane => {
      const own = !!m && d.mandate_id === m.payload.id;
      const cells = own ? laneCells(d, cols, w.needOf(d.id)) : cols.map((c) => ({ n: c.n, kind: 'unknown' as const, text: 'covered by other rules · open the deal', computed: false }));
      return { deal: d, cells, own, slot: byId.get(d.mandate_id)?.agent ?? null };
    });
    const t = (d: Deal) => d.created_at ?? 0;
    return rows.sort((a, b) => (a.slot ?? '~').localeCompare(b.slot ?? '~') || t(b.deal) - t(a.deal));
  }, [deals, cols, m, mq.data, w]);
  const laneOf = (id: string) => lanes.find((l) => l.deal.id === id) ?? null;

  const first = needs[0]?.d.id ?? lanes[0]?.deal.id ?? null;
  const [sel, setSel] = useState<Sel | null>(null);
  const cur: Sel | null = sel && (sel.kind === 'clause' || lanes.some((l) => l.deal.id === sel.id)) ? sel : first ? { kind: 'lane', id: first } : null;
  const [sheet, setSheet] = useState<{ kind: 'details' | 'clauses'; id: string | null } | null>(null);

  // The week's purchases, newest first.
  const recent = [...lanes].sort((a, b) => (b.deal.created_at ?? 0) - (a.deal.created_at ?? 0));
  const refused = deals.filter((d) => outcomeOf(d).kind === 'refused').length;
  const paid = deals.filter((d) => outcomeOf(d).kind === 'paid').length;
  const back = () => open(null);
  const ruleCount = m?.payload.clauses.length ?? 0;
  const notice = mq.error ? <WalletNotice error={mq.error} what="Your rules" /> : null;

  let body: ReactNode;
  if (view === 'week') {
    body = (
      <DetailPage title={SPEND_VIEW.week} onBack={back} icon={<Glyph module="spend" />} sub={count(deals.length, 'purchase')}>
        {notice ?? (!mq.data ? <Loading what="your rules" /> : (
          <Group className="sp-list" empty="Your agents haven’t asked to buy anything yet. Their first purchase will show up here.">
            {recent.map((l) => <PurchaseRow key={l.deal.id} lane={l} cols={cols} onOpen={() => setSheet({ kind: 'details', id: l.deal.id })} />)}
          </Group>
        ))}
      </DetailPage>
    );
  } else if (view === 'gate') {
    body = (
      <DetailPage title={SPEND_VIEW.gate} onBack={back} icon={<Glyph module="spend" />} sub="Each purchase, rule by rule"
        info={<InfoPop label="How to read this" title="How to read the rule check">
          <p className="sp-pop-lede">Each line is one purchase, travelling left to right through your rules toward PayPal.</p>
          <div className="sp-legend">
            <span className="sw"><i className="ln" /><span className="sp-dot" /></span><span>passed this rule</span>
            <span className="sw"><span className="sp-mk you">Asks you</span></span><span>this rule leaves the decision to you</span>
            <span className="sw"><span className="sp-mk fail">✕ Refused</span></span><span>stopped here: PayPal was never asked</span>
            <span className="sw"><i className="ln d" /></span><span>never got further</span>
            <span className="sw"><span className="sp-unk" /></span><span>not known from here</span>
          </div>
        </InfoPop>}>
        {notice ?? (!mq.data ? <Loading what="your rules" /> : <Matrix lanes={lanes} cols={cols} sel={cur} onSel={setSel} />)}
        {purchase.length > 1 ? <Hint className="sp-gap">{purchase.length} sets of rules cover purchases. This shows the first; purchases under the others open in their deal.</Hint> : null}
        {cur ? (
          <Inspector label="Purchase details">
            <div className="mod-spend sp-insp">
              {cur.kind === 'lane' ? (() => { const l = laneOf(cur.id); return l ? <LaneStory lane={l} cols={cols} m={m} nav={nav} onSheet={(k) => setSheet({ kind: k, id: l.deal.id })} /> : null; })()
                : <ClauseStory n={cur.n} cellOf={cur.kind === 'cell' ? laneOf(cur.id) : null} lanes={lanes} cols={cols} m={m} nav={nav}
                  onAll={(id) => setSheet({ kind: 'clauses', id })} />}
            </div>
          </Inspector>
        ) : null}
      </DetailPage>
    );
  } else if (view === 'rules') {
    body = (
      <DetailPage title={SPEND_VIEW.rules} onBack={back} icon={<Glyph module="spend" />}
        sub={m ? 'Signed by you. Every purchase is checked against these before PayPal is asked.' : undefined}
        actions={<Btn kind="primary" onClick={() => nav.onSheet('mandates')}>Change rules</Btn>}>
        {notice ?? (!mq.data ? <Loading what="your rules" /> : m ? (
          <>
            <ClauseList m={m} lane={null} />
            <Hint className="sp-gap">Changing a rule means signing an update in the approval window. An agent can never change its own rules.</Hint>
          </>
        ) : <Empty>No signed rules cover purchases, so every agent purchase is refused before PayPal is asked.</Empty>)}
      </DetailPage>
    );
  } else {
    body = (
      <>
        <PageHead title="Spend" icon={<Glyph module="spend" />} focusKey="spend"
          info={<InfoPop label="How buying works" title="How buying works"><ol className="sp-steps">{SPEND_STEPS.map((s) => <li key={s}>{s}</li>)}</ol></InfoPop>} />
        <Answer deals={deals} needs={needs} hasRules={!!m} />
        {needs.length ? (
          <section className="sp-decisions" aria-label="Needs you">
            {needs.map(({ d, need }) => <PurchaseDecision key={d.id} deal={d} need={need} m={m} slot={laneOf(d.id)?.slot ?? null} onDetails={() => setSheet({ kind: 'details', id: d.id })} />)}
          </section>
        ) : null}
        <div className="ui-sumcards">
          <SummaryCard id="week" label={SPEND_VIEW.week} value={count(deals.length, 'purchase')}
            note={deals.length ? (paid ? `${paid} paid` : 'Nothing paid yet') : 'Nothing asked yet'} onOpen={() => open('week', 'week')} />
          <SummaryCard id="gate" label={SPEND_VIEW.gate} value={refused ? `${refused} refused` : 'Nothing refused'}
            note={refused ? 'PayPal was never asked' : undefined} onOpen={() => open('gate', 'gate')} />
          <SummaryCard id="rules" label={SPEND_VIEW.rules} value={m ? count(ruleCount, 'rule') : 'None signed'}
            chip={m ? undefined : 'Purchases refused'} chipTone="red" onOpen={() => open('rules', 'rules')} />
        </div>
      </>
    );
  }

  return (
    <div className="sp-page">
      {body}
      {sheet?.kind === 'details' ? (() => { const l = laneOf(sheet.id ?? ''); return l ? <DetailsSheet lane={l} cols={cols} onClose={() => setSheet(null)} onDeal={() => { setSheet(null); nav.onDeal(l.deal.id); }} onWhy={() => setSheet({ kind: 'clauses', id: l.deal.id })} /> : null; })() : null}
      {sheet?.kind === 'clauses' && m ? <ClausesSheet m={m} lane={laneOf(sheet.id ?? '')} onClose={() => setSheet(null)} onMandates={() => { setSheet(null); nav.onSheet('mandates'); }} /> : null}
    </div>
  );
}

// ---- the answer ------------------------------------------------------------------------------------

/** "Did my agents buy anything I need to look at?" in one sentence, from the deals and the attention queue. */
function Answer({ deals, needs, hasRules }: { deals: Deal[]; needs: Array<{ d: Deal; need: AttentionItem }>; hasRules: boolean }) {
  const w = useWorld();
  const needIds = new Set(needs.map((x) => x.d.id));
  const others = deals.filter((d) => !needIds.has(d.id));
  const tally = { paid: 0, refused: 0, voided: 0, other: 0 };
  for (const d of others) {
    const k = outcomeOf(d).kind;
    if (k === 'paid') tally.paid += 1; else if (k === 'refused') tally.refused += 1; else if (k === 'voided') tally.voided += 1; else tally.other += 1;
  }
  const parts = [
    tally.paid ? `${tally.paid} paid` : null, tally.refused ? `${tally.refused} refused by your rules` : null,
    tally.voided ? `${tally.voided} released` : null, tally.other ? `${tally.other} in progress` : null,
  ].filter((x): x is string => !!x);
  const rest = parts.length ? `${needs.length ? 'The others' : 'This week'}: ${joinWords(parts)}.` : undefined;

  if (needs.length) {
    const lead = needs[0]!.d;
    const t = dealTotal(lead);
    const held = needs.every((x) => x.d.state === 'AUTHORIZED');
    return (
      <AnswerBar tone="need"
        title={needs.length === 1 ? <>One purchase needs you: {w.display(lead).title}, {formatMinor(t.minor, t.currency)}.</> : <>{needs.length} purchases need you.</>}
        sub={<>{held ? 'PayPal is holding the money until you pay or release it. ' : ''}{rest}</>} />
    );
  }
  if (!hasRules) return <AnswerBar tone="calm" icon="rules" title="Your agents can’t buy anything yet." sub="No signed rules cover purchases, so every purchase is refused before PayPal is asked." />;
  if (!deals.length) return <AnswerBar tone="calm" title="Your agents haven’t asked to buy anything yet." sub="Their first purchase will show up here." />;
  return (
    <AnswerBar tone={tally.paid ? 'done' : 'calm'}
      title={tally.paid ? `Nothing needs you. ${count(tally.paid, 'purchase')} went through on your rules.` : 'Nothing needs you. No money is on hold.'}
      sub={tally.refused ? `${tally.refused === 1 ? 'One purchase was' : `${tally.refused} purchases were`} refused by your rules, so PayPal was never asked.${tally.voided ? ` ${count(tally.voided, 'hold')} released.` : ''}` : tally.voided ? `${count(tally.voided, 'hold')} released, nothing paid.` : undefined} />
  );
}

// ---- Layer 1: a decision card per purchase that needs you --------------------------------------------

/** Why the owner is asked, in a sentence: the rule the attention item names, in plain words. */
function whyAsked(deal: Deal, need: AttentionItem, m: MandateListEntry | null, cp: { name: string; entry?: { declared_payee: string | null } }): string {
  const cl = need.clause ? m?.payload.clauses.find((c) => CLAUSE_NO[c.type] === need.clause?.number) : undefined;
  if (!cl) return deal.state === 'AUTHORIZED' ? 'The money is on hold at PayPal. Paying it out waits for you.' : 'Your rules leave this decision to you.';
  if (cl.type === 'payees' && cp.entry?.declared_payee && !cl.payees.includes(cp.entry.declared_payee)) return `${cp.name} isn’t on your approved payees.`;
  if (cl.type === 'human_present_over') return `It is above the ${formatMinor(cl.amount.minor, cl.amount.currency)} you asked to approve yourself.`;
  return `Your “${RULE_NAME[cl.type]}” rule asks you first: ${ruleSentence(cl)}.`;
}

function PurchaseDecision({ deal, need, m, slot, onDetails }: { deal: Deal; need: AttentionItem; m: MandateListEntry | null; slot: string | null; onDetails: () => void }) {
  const w = useWorld();
  const toast = useToast();
  const disp = w.display(deal);
  const cp = useCpLookup()(deal.counterparty);
  const open = useMutation('approval_open');
  const lapse = useMutation('deal_let_lapse');
  const withdraw = useMutation('deal_withdraw');
  const [voidAsk, setVoidAsk] = useState(false);
  const t = dealTotal(deal);
  const held = deal.state === 'AUTHORIZED';
  const handOff = async (what: string) => {
    const r = await open.run({ deal_id: deal.id });
    if (r !== undefined) toast(<>The approval window is open · <b>{what}</b> there. It checks the hold again first.</>, 'gold');
  };
  const lock = w.locked ? <Icon name="hold" size={13} /> : null;
  const options: DecisionOption[] = [];
  if (need.actions.includes('review')) {
    options.push({
      kind: 'gold', disabled: open.pending, onClick: () => void handOff(held ? 'pay or release' : 'decide'),
      title: w.locked ? 'Locked after 15 quiet minutes: the approval window asks for Windows Hello' : 'Opens the approval window, the only place money can be paid',
      label: <>{lock}{held ? 'Review & pay' : 'Review'} ↗</>,
      means: held ? 'Opens the approval window to pay. Nothing moves until you confirm there.' : 'Opens the approval window to decide. Nothing moves until you confirm there.',
    });
  }
  if (held) options.push({ label: 'Release hold…', means: <>Gives the money back. {cp.name} is paid nothing.</>, onClick: () => setVoidAsk(true) });
  if (need.actions.includes('let_lapse')) {
    options.push({
      label: 'Let it lapse', means: 'Does nothing now. It lapses at its deadline and nothing is paid.', disabled: lapse.pending,
      onClick: async () => { const r = await lapse.run({ deal_id: deal.id }); if (r === null) toast(<>{disp.title} will lapse at its deadline. <b>No money moves.</b></>, 'ok'); },
    });
  }
  if (need.actions.includes('withdraw') && canWithdraw(deal)) {
    options.push({
      label: 'Withdraw', kind: 'danger', means: 'Cancels the purchase. No money moves.', disabled: withdraw.pending,
      onClick: async () => { const r = await withdraw.run({ deal_id: deal.id }); if (r === null) toast(<>{disp.title} withdrawn. <b>No money moved.</b></>, 'ok'); },
    });
  }
  return (
    <>
      <DecisionCard
        context={<><Icon name={held ? 'hold' : 'clock'} size={13} />{held ? 'On hold at PayPal' : 'Waiting for you'}{slot ? ` · ${cap(slot)} agent` : ''}{deal.created_at ? ` · asked ${clockLabel(deal.created_at)}` : ''}<NoteChip dealId={deal.id} who={cp.name} /></>}
        onDetails={onDetails}
        question={held ? <>Pay {cp.name} for “{disp.title}”?</> : <>What should happen with “{disp.title}” from {cp.name}?</>}
        why={whyAsked(deal, need, m, cp)}
        amount={<span className={`money ${amountTone(deal)}`}><MinorMoney minor={t.minor} currency={t.currency} /></span>}
        options={options}
        silence={need.on_silence} deadline={need.deadline} />
      {[open.error, lapse.error, withdraw.error].map((e, i) => (e ? <WalletNotice key={i} error={e} /> : null))}
      {voidAsk ? (
        <Sheet title={`Release the ${formatMinor(t.minor, t.currency)} hold?`} size="narrow" onClose={() => setVoidAsk(false)} className="mod-spend"
          footer={<>
            <Btn onClick={() => setVoidAsk(false)}>Keep the hold</Btn>
            <Btn kind="danger" locked={w.locked} disabled={open.pending} onClick={async () => { setVoidAsk(false); await handOff('release the hold'); }}>Release in the approval window ↗</Btn>
          </>}>
          <Kv items={[
            ['What happens', <>PayPal lets go of the money now. <b>{cp.name} is paid nothing.</b></>],
            ['Where', 'You confirm it in the approval window.'],
            ['If you wait', need.on_silence],
          ]} />
        </Sheet>
      ) : null}
    </>
  );
}

// ---- Layer 1: the week's other purchases, one line each ------------------------------------------------

const LEAD: Record<string, { icon: IconName; cls: string }> = {
  paid: { icon: 'check', cls: 'ok' }, refused: { icon: 'block', cls: 'red' }, held: { icon: 'hold', cls: 'gold' },
  voided: { icon: 'money', cls: 'dim' }, waiting: { icon: 'clock', cls: 'gold' }, other: { icon: 'clock', cls: 'teal' },
};
const LINE_ICON: Record<RuleLine['kind'], IconName> = { pass: 'check', ask: 'you', fail: 'block', unknown: 'eye' };

function PurchaseRow({ lane, cols, onOpen }: { lane: Lane; cols: GateColumn[]; onOpen: () => void }) {
  const w = useWorld();
  const d = lane.deal;
  const disp = w.display(d);
  const cp = useCpLookup()(d.counterparty);
  const t = dealTotal(d);
  const out = outcomeOf(d);
  const line: RuleLine = lane.own ? ruleLine(lane.cells, cols) : { kind: 'unknown', text: 'Checked under other rules. Open it to see.' };
  const lead = LEAD[out.kind] ?? LEAD.other!;
  return (
    <Row className="sp-row" onOpen={onOpen} label={`${disp.title}, ${out.label}. ${line.text}. Open details`}
      lead={<span className={`sp-lead ${lead.cls}`} aria-hidden="true"><Icon name={lead.icon} size={13} /></span>}
      title={<><b>{disp.title}</b> <span className="tx-dim">· {cp.name}{d.created_at ? ` · ${clockLabel(d.created_at)}` : ''}</span></>}
      sub={<span className={`sp-rl ${line.kind}`}><Icon name={LINE_ICON[line.kind]} size={12} />{line.text}{out.kind === 'refused' ? <span className="tx-dim"> · PayPal was never asked</span> : null}</span>}>
      <Chip tone={out.tone}>{out.label}</Chip>
      <span className={`amt ${amountTone(d)}`}><MinorMoney minor={t.minor} currency={t.currency} /></span>
    </Row>
  );
}

// ---- Layer 1: the matrix ---------------------------------------------------------------------------

function Matrix({ lanes, cols, sel, onSel }: { lanes: Lane[]; cols: GateColumn[]; sel: Sel | null; onSel: (s: Sel) => void }) {
  const w = useWorld();
  const att = w.attention.data;
  const vel = cols.find((c) => c.clause.type === 'velocity')?.clause as Extract<GateColumn['clause'], { type: 'velocity' }> | undefined;
  const fill = velocityFill(att?.wallet_spend_today_minor ?? 0, att?.wallet_spend_today_currency, vel, !!w.settings.data?.meters_available);
  const grid = { '--sp-cols': `minmax(210px, 1.9fr) repeat(${cols.length}, minmax(76px, .55fr)) minmax(176px, 1.15fr)` } as CSSProperties;
  if (!cols.length) return <div className="sp-matrix"><div className="ui-empty">No signed rules cover purchases, so every agent purchase is refused before PayPal is asked.</div></div>;
  if (!lanes.length) return <div className="sp-matrix"><div className="ui-empty">Your agents haven’t asked to buy anything yet. Their first purchase will show up here.</div></div>;
  const selN = sel && sel.kind !== 'lane' ? sel.n : null;
  const groups: Array<{ slot: string | null; lanes: Lane[] }> = [];
  for (const l of lanes) {
    const g = groups.at(-1);
    if (g && g.slot === l.slot) g.lanes.push(l); else groups.push({ slot: l.slot, lanes: [l] });
  }
  const onLaneKey = (e: ReactKeyboardEvent<HTMLButtonElement>, id: string) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = lanes.findIndex((l) => l.deal.id === id);
    const nx = lanes[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (nx) { onSel({ kind: 'lane', id: nx.deal.id }); (document.querySelector(`[data-lane="${nx.deal.id}"]`) as HTMLElement | null)?.focus(); }
  };
  return (
    <div className="sp-matrix" style={grid} role="group" aria-label="The gate: each purchase runs left to right through your rules and stops where a rule stops it">
      <div className="sp-mh">
        <div className="asked"><span className="lbl">Purchase</span></div>
        {cols.map((c) => (
          <button key={c.n} type="button" className={`sp-ch ${selN === c.n ? 'on' : ''}`} onClick={() => onSel(selN === c.n && sel?.kind === 'clause' ? { kind: 'lane', id: lanes[0]!.deal.id } : { kind: 'clause', n: c.n })}
            aria-label={`${RULE_NAME[c.clause.type]}: ${ruleSentence(c.clause)}`} title={`${RULE_NAME[c.clause.type]}: ${ruleSentence(c.clause)}`}>
            <b>{COLUMN_NAME[c.clause.type]}</b>
            {c.clause.type === 'velocity' ? (
              <>
                <Meter value={fill} label="Spent today against your daily limit" />
                <small>{fill === null ? 'today: not counted' : `${short(att?.wallet_spend_today_minor ?? 0, c.clause.max_total_day.currency)} of ${short(c.clause.max_total_day.minor, c.clause.max_total_day.currency)}`}</small>
              </>
            ) : <small>{columnValue(c.clause)}</small>}
          </button>
        ))}
        <div className="pp"><span className="lbl">At PayPal</span></div>
      </div>
      {groups.map((g) => (
        <div key={g.slot ?? 'none'} role="rowgroup">
          <div className="sp-agrow"><b>{g.slot ? `${cap(g.slot)} agent` : 'Rules no longer active'}</b><span>· {g.lanes.length} purchase{g.lanes.length === 1 ? '' : 's'}</span></div>
          {g.lanes.map((l) => (
            <LaneRow key={l.deal.id} lane={l} selected={sel?.kind === 'lane' && sel.id === l.deal.id} selN={selN} selCell={sel?.kind === 'cell' && sel.id === l.deal.id ? sel.n : null}
              onSel={onSel} onKey={(e) => onLaneKey(e, l.deal.id)} />
          ))}
        </div>
      ))}
    </div>
  );
}

function LaneRow({ lane, selected, selN, selCell, onSel, onKey }: { lane: Lane; selected: boolean; selN: number | null; selCell: number | null; onSel: (s: Sel) => void; onKey: (e: ReactKeyboardEvent<HTMLButtonElement>) => void }) {
  const w = useWorld();
  const d = lane.deal;
  const disp = w.display(d);
  const cp = useCpLookup()(d.counterparty);
  const t = dealTotal(d);
  const out = outcomeOf(d);
  let tone: 'teal' | 'gold' | 'dead' | 'unk' = 'teal';
  const cells = lane.cells.map((c) => {
    let cls: string;
    let mk: ReactNode = null;
    const tip = c.text;
    const pick = () => onSel({ kind: 'cell', id: d.id, n: c.n });
    if (c.kind === 'fail') { cls = `t-${tone} stop`; mk = <button type="button" className="sp-mk fail" title={tip} aria-label={`Why refused: ${tip}`} onClick={pick}>✕ {c.computed ? 'Over' : 'Refused'}</button>; tone = 'dead'; }
    else if (c.kind === 'you') { tone = 'gold'; cls = 't-gold'; mk = <button type="button" className="sp-mk you" aria-label={`Asks you: ${tip}`} title={tip} onClick={pick}>Asks you</button>; }
    else if (c.kind === 'pass') { cls = `t-${tone}`; mk = <span className="sp-dot" role="img" aria-label="passed" title="Passed" />; }
    else if (c.kind === 'skip') cls = 't-dead';
    else if (c.kind === 'na') { cls = 't-na'; mk = <span className="sp-na" title={tip} aria-label={tip}>–</span>; }
    else { cls = 't-unk'; mk = <button type="button" className="sp-unk" aria-label={`Not known: ${tip}`} title={`Not known: ${tip}`} onClick={pick} />; }
    return <div key={c.n} className={`sp-c ${cls} ${selN === c.n ? 'csel' : ''} ${selCell === c.n ? 'cur' : ''}`}>{mk}</div>;
  });
  const lastTone = d.state === 'REFUSED' ? 'dead' : tone;
  return (
    <div className={`sp-lane ${selected ? 'sel' : ''}`}>
      <button type="button" className="sp-lh" data-lane={d.id} aria-label={`${disp.title}, ${out.label}`} onClick={() => onSel({ kind: 'lane', id: d.id })} onKeyDown={onKey}>
        <span className="t1">{disp.title}</span>
        <span className="t2"><span className={`money ${amountTone(d)}`}>{formatMinor(t.minor, t.currency)}</span> · {cp.name}{d.created_at ? <> · {clockLabel(d.created_at)}</> : null}</span>
      </button>
      {cells}
      <Outcome deal={d} tone={lastTone} onPick={() => onSel({ kind: 'lane', id: d.id })} />
    </div>
  );
}

function Outcome({ deal, tone, onPick }: { deal: Deal; tone: string; onPick: () => void }) {
  const w = useWorld();
  const disp = w.display(deal);
  const out = outcomeOf(deal);
  const t = dealTotal(deal);
  if (out.kind === 'refused') {
    return <div className="sp-out t-dead"><span className="stk"><Chip tone="red">Refused</Chip><span className="ui-hint">PayPal never asked</span></span></div>;
  }
  if (out.kind === 'held') {
    return (
      <div className="sp-out t-gold">
        <button type="button" className="sp-capsule" onClick={onPick} aria-label={`${formatMinor(t.minor, t.currency)} on hold at PayPal`}>
          <span className="cap-1"><LockMini /> On hold <span className="money">{formatMinor(t.minor, t.currency)}</span></span>
          <span className="cap-2">{disp.deadline ? <><Countdown deadline={disp.deadline} /> left</> : 'time left not shown'}</span>
        </button>
      </div>
    );
  }
  const hint = out.kind === 'voided' ? 'nothing paid' : out.kind === 'waiting' ? 'nothing paid yet' : '';
  return <div className={`sp-out t-${out.kind === 'paid' ? 'green' : out.kind === 'waiting' ? 'gold' : tone === 'dead' ? 'dead' : 'dim'}`}><span className="stk"><Chip tone={out.tone}>{out.label}</Chip>{hint ? <span className="ui-hint">{hint}</span> : null}</span></div>;
}

const LockMini = () => (
  <svg className="lk" viewBox="0 0 10 12" aria-hidden="true"><rect x="1" y="5" width="8" height="6.5" rx="1.4" fill="currentColor" /><path d="M3 5V3.6a2 2 0 0 1 4 0V5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
);

// ---- Layer 2: the Inspector's stories ----------------------------------------------------------------

const GLYPH: Record<Cell['kind'], string> = { pass: '✓', fail: '✕', you: '◆', skip: '–', na: '·', unknown: '?' };

/** The rules one purchase met, as a checklist. When every rule passed, one line says so instead of
 *  repeating "passed" per row. */
function Trace({ cells, cols }: { cells: Cell[]; cols: GateColumn[] }) {
  const allPassed = cells.length > 0 && cells.every((c) => c.kind === 'pass' || c.kind === 'na');
  return (
    <>
      <ol className="sp-trace ui-group">
        {cells.map((c) => {
          const col = cols.find((x) => x.n === c.n);
          const quiet = c.kind === 'pass' || c.kind === 'na';
          const short = c.kind === 'skip' ? 'not checked' : c.kind === 'unknown' ? 'not known' : c.kind === 'you' ? 'asks you' : null;
          return (
            <li key={c.n} className={c.kind} title={col ? ruleSentence(col.clause) : undefined}>
              <span className="g" aria-label={c.kind === 'pass' ? 'passed' : c.kind === 'fail' ? 'refused' : c.kind === 'you' ? 'asks you' : c.kind === 'unknown' ? 'not known' : 'not checked'}>{GLYPH[c.kind]}</span>
              <span className="nm">{col ? RULE_NAME[col.clause.type] : `Rule ${c.n}`}</span>
              <span className="v">{quiet || c.kind === 'fail' ? (col ? columnValue(col.clause) : '') : short}</span>
              {c.kind === 'fail' ? <span className="why">{cap(c.text)}</span> : null}
            </li>
          );
        })}
      </ol>
      {allPassed ? <Hint className="sp-gap">✓ Every rule passed before PayPal was asked.</Hint> : null}
    </>
  );
}

function useEvidence(deal: Deal) {
  return useQuery('deal_evidence', { deal_id: deal.id }, { refreshOn: ['deal:changed', 'receipt:created'] });
}

/** Receipt and statement, as two calm pills. PayPal ids stay in Details. */
function ProofPills({ deal }: { deal: Deal }) {
  const ev = useEvidence(deal);
  const p = deal.paypal;
  if (deal.state === 'REFUSED' && !p.order && !p.authorization) return <span className="tx-ok">Never sent · nothing to undo</span>;
  if (ev.error) return <Chip tone="dashed" title={ev.error.message}>not available</Chip>;
  if (!ev.data) return <span className="tx-dim">…</span>;
  const r = receiptWord(ev.data.receipt);
  const s = reconWord(ev.data.reconciliation);
  return <span className="sp-chips"><Chip tone={r.tone} title={r.means}>{r.text}</Chip><Chip tone={s.tone} title={s.means}>{s.text}</Chip></span>;
}

function LaneStory({ lane, cols, m, nav, onSheet }: { lane: Lane; cols: GateColumn[]; m: MandateListEntry | null; nav: ModuleProps['nav']; onSheet: (k: 'details' | 'clauses') => void }) {
  const w = useWorld();
  const d = lane.deal;
  const disp = w.display(d);
  const cp = useCpLookup()(d.counterparty);
  const t = dealTotal(d);
  const out = outcomeOf(d);
  const who = decidedBy(d);
  const need = w.needOf(d.id);
  return (
    <>
      <div className="sp-ih"><Chip tone={out.tone}>{out.label}</Chip><NoteChip dealId={d.id} who={cp.name} /></div>
      <h2>{disp.title}</h2>
      <Hint>{d.created_at ? <>Asked {clockLabel(d.created_at)}</> : 'Asked'}{lane.slot ? <> by the {lane.slot} agent</> : null} · {disp.label}</Hint>
      <div className="sp-bigamt"><span className={`money ${amountTone(d)}`}>{formatMinor(t.minor, t.currency)}</span><span className="tx-dim">{amountNote(d)}</span></div>
      <Section>
        <Kv items={[
          ['Paying', cp.name],
          ['Decided by', <span className={who.who === 'none' ? 'tx-dim' : undefined} title={who.why}>{cap(who.text)}</span>],
          out.kind === 'held' && disp.deadline ? ['Time left', <><Countdown deadline={disp.deadline} /> to pay or release</>] : null,
          need ? ['If you wait', need.on_silence] : null,
          ['Proof', <ProofPills deal={d} />],
        ]} />
      </Section>
      <Section title={m ? `Your ${rulesName(m.agent)}` : 'Your rules'}>
        {cols.length ? <Trace cells={lane.cells} cols={cols} /> : <Hint>No rules cover purchases.</Hint>}
      </Section>
      <div className="sp-iacts">
        {d.state === 'REFUSED' ? <Btn sm onClick={() => onSheet('clauses')}>Why refused?</Btn> : null}
        <Btn sm onClick={() => onSheet('details')}>Details</Btn>
        <Btn sm kind="plain" onClick={() => nav.onDeal(d.id)}>Open deal ›</Btn>
      </div>
    </>
  );
}

function ClauseStory({ n, cellOf, lanes, cols, m, nav, onAll }: { n: number; cellOf: Lane | null; lanes: Lane[]; cols: GateColumn[]; m: MandateListEntry | null; nav: ModuleProps['nav']; onAll: (id: string | null) => void }) {
  const w = useWorld();
  const att = w.attention.data;
  const col = cols.find((c) => c.n === n);
  if (!col) return <Hint>This rule is not part of the gate.</Hint>;
  const g = clauseGroups(lanes.filter((l) => l.own).map((l) => ({ id: w.display(l.deal).title, cells: l.cells })), n);
  const cell = cellOf?.cells.find((c) => c.n === n) ?? null;
  const label = (k: keyof typeof g): [string, string] => ({ fail: ['refused', 'tx-red'], you: ['asked you', 'tx-gold'], pass: ['passed', 'tx-ok'], unknown: ['not known', 'tx-dim'] } as Record<string, [string, string]>)[k]!;
  const vel = col.clause.type === 'velocity' ? col.clause : null;
  return (
    <>
      {cell?.kind === 'fail' ? <div className="sp-ih"><Chip tone="red">Why it was refused</Chip></div> : null}
      <h2>{RULE_NAME[col.clause.type]}</h2>
      <p className="sp-rule">{cap(ruleSentence(col.clause))}</p>
      {cellOf && cell ? (
        <Section title={w.display(cellOf.deal).title}>
          <p className={`sp-cellsay ${cell.kind === 'fail' ? 'tx-red' : cell.kind === 'you' ? 'tx-gold' : cell.kind === 'pass' ? 'tx-ok' : 'tx-dim'}`}>{cap(cell.text)}</p>
          {cellOf.deal.state === 'REFUSED' ? <Hint>PayPal was never asked, so there is nothing to undo.</Hint> : null}
        </Section>
      ) : null}
      <Section title="This week">
        <Group className="sp-hits" empty="No purchase reached this rule.">
          {(Object.keys(g) as Array<keyof typeof g>).filter((k) => g[k].length).map((k) => (
            <div key={k} className="ui-row"><b className={label(k)[1]}>{g[k].length} {label(k)[0]}</b><span className="tx-dim">{g[k].join(', ')}</span></div>
          ))}
        </Group>
      </Section>
      {vel ? (
        <Section>
          <Kv items={[
            ['Spent today', att && w.settings.data?.meters_available && att.wallet_spend_today_currency === vel.max_total_day.currency
              ? `${formatMinor(att.wallet_spend_today_minor, vel.max_total_day.currency)} of ${formatMinor(vel.max_total_day.minor, vel.max_total_day.currency)}` : <Chip tone="dashed">not counted yet</Chip>],
            ['Purchases', `up to ${vel.max_deals_day} a day`],
          ]} />
        </Section>
      ) : null}
      <div className="sp-iacts">
        <Btn sm onClick={() => onAll(cellOf?.deal.id ?? null)} disabled={!m}>All rules</Btn>
        <Btn sm kind="plain" onClick={() => nav.onSheet('mandates')}>Change rules ›</Btn>
      </div>
    </>
  );
}

function DetailsSheet({ lane, cols, onClose, onDeal, onWhy }: { lane: Lane; cols: GateColumn[]; onClose: () => void; onDeal: () => void; onWhy: () => void }) {
  const w = useWorld();
  const d = lane.deal;
  const disp = w.display(d);
  const cp = useCpLookup()(d.counterparty);
  const t = dealTotal(d);
  const out = outcomeOf(d);
  const p = d.paypal;
  return (
    <Sheet title={disp.title} size="wide" onClose={onClose} className="mod-spend"
      footer={<>
        <Btn className="left" onClick={onDeal}>Open deal ›</Btn>
        {d.state === 'REFUSED' ? <Btn onClick={onWhy}>Why refused?</Btn> : null}
        <Btn kind="primary" onClick={onClose}>Done</Btn>
      </>}>
      <div className="sp-shtop"><Chip tone={out.tone}>{out.label}</Chip><span className={`money sp-shamt ${amountTone(d)}`}>{formatMinor(t.minor, t.currency)}</span><Hint>{amountNote(d)}</Hint></div>
      <Kv items={[
        ['Asked', `${d.created_at ? clockLabel(d.created_at) : 'time not recorded'}${lane.slot ? ` by the ${lane.slot} agent` : ''}`],
        ['Paying', cp.name],
        ['Item', <>{d.terms.qty > 1 ? `${d.terms.qty} × ` : ''}<span className="mono">{d.terms.item_ref}</span></>],
        ['Proof', <ProofPills deal={d} />],
        p.order || p.authorization || p.capture ? ['PayPal ids', <span className="mono">{[p.order && `order ${p.order}`, p.authorization && `hold ${p.authorization}`, p.capture && `payment ${p.capture}`].filter(Boolean).join(' · ')}</span>] : null,
        ['Deal id', <span className="mono">{disp.label} · {shortId(d.id)}</span>],
      ]} />
      <Section title="Rules it met">
        {cols.length ? <Trace cells={lane.cells} cols={cols} /> : <Hint>No rules cover purchases.</Hint>}
      </Section>
    </Sheet>
  );
}

function ClauseList({ m, lane }: { m: MandateListEntry; lane: Lane | null }) {
  return (
        <Group className="sp-clist">
          {m.payload.clauses.map((c, i) => {
            const cell = lane?.cells.find((x) => x.n === i + 1);
            const hit = cell && (cell.kind === 'fail' || cell.kind === 'you') ? cell : null;
            return (
              <Row key={i} className={hit ? `hit-${hit.kind}` : ''} lead={<span className={`sp-cg ${hit ? hit.kind : ''}`} aria-hidden="true">{hit ? (hit.kind === 'fail' ? '✕' : '◆') : '•'}</span>}
                title={<><b>{RULE_NAME[c.type]}</b> <span className="tx-dim">· {ruleSentence(c)}</span></>}
                sub={hit ? <span className={hit.kind === 'fail' ? 'tx-red' : 'tx-gold'}>{cap(hit.text)}</span> : undefined} />
            );
          })}
        </Group>  );
}

function ClausesSheet({ m, lane, onClose, onMandates }: { m: MandateListEntry; lane: Lane | null; onClose: () => void; onMandates: () => void }) {
  const w = useWorld();
  const refused = lane?.deal.state === 'REFUSED';
  const title = lane ? w.display(lane.deal).title : null;
  return (
    <Sheet title={refused && title ? `Why “${title}” was refused` : `Your ${rulesName(m.agent)}`} size="wide" onClose={onClose} className="mod-spend"
      footer={<><Btn className="left" onClick={onMandates}>Change rules ›</Btn><Btn kind="primary" onClick={onClose}>Done</Btn></>}>
      <Hint className="sp-lede">Signed by you. Every purchase is checked against these before PayPal is asked.{refused ? ' This one never reached PayPal, so there is nothing to undo.' : ''}</Hint>
      <ClauseList m={m} lane={lane} />
      <Hint className="sp-gap">Changing a rule means signing an update in the approval window. An agent can never change its own rules.</Hint>
    </Sheet>
  );
}
