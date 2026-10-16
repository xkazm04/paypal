// One purchase in detail (rebuild WP3a): the decision when it waits for the owner (pay or release in
// the approval window - `approval_open` only; let it lapse and withdraw move no money), what it is, who
// is paid, who decided, the proof (read only for this purchase), and the rules it met. Pure logic:
// modules/spend/gate.ts.
import { useState, type ReactNode } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import { clockLabel, formatMinor } from '../../../../../lib/format';
import { useMutation } from '../../../../../lib/hooks';
import { APPROVAL_LOCKED_TITLE, APPROVAL_OPEN_TITLE, receiptWord, reconWord, RULE_NAME, rulesName, ruleSentence, SPEND, TABLES_TRADE } from '../../../../../lib/words';
import { WalletNotice } from '../../../../../shared/honesty';
import { Btn, Chip, DecisionCard, Disclosure, Hint, Kv, Section, Sheet, type DecisionOption } from '../../../../../shared/ui';
import { amountNote, amountTone, canWithdraw, dealTotal, decidedBy } from '../../../logic';
import { CLAUSE_NO, columnValue, outcomeOf, type Cell, type GateColumn } from '../../../modules/spend/gate';
import { LockGlyph } from '../../../ui';
import { useLocked, type Display } from '../../../world';
import { useLayerNav } from '../../layers';
import { Amount, Countdown } from '../../rows';
import { TheirWords, useEvidence } from '../tables/parts';

/** A purchase as the Spend layer reads it: its rule cells against the governing rule set, and the agent slot. */
export type Lane = {
  deal: Deal;
  /** The purchase against the rules of the rule set that governs it (`cols`); empty when that set is not listed. */
  cells: Cell[];
  cols: GateColumn[];
  /** Governed by the first purchase rule set (the rule check's columns). */
  own: boolean;
  slot: string | null;
  rules: MandateListEntry | null;
};

const cap = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/** Why the owner is asked, in a sentence: the rule the attention item names, in plain words. */
function whyAsked(deal: Deal, need: AttentionItem, m: MandateListEntry | null, cp: { name: string; entry?: { declared_payee: string | null } }): string {
  const cl = need.clause ? m?.payload.clauses.find((c) => CLAUSE_NO[c.type] === need.clause?.number) : undefined;
  if (!cl) return deal.state === 'AUTHORIZED' && !need.money_check ? SPEND.whyHeld : SPEND.whyRules;
  if (cl.type === 'payees' && cp.entry?.declared_payee && !cl.payees.includes(cp.entry.declared_payee)) return SPEND.whyPayee(cp.name);
  if (cl.type === 'human_present_over') return SPEND.whyOver(formatMinor(cl.amount.minor, cl.amount.currency));
  return SPEND.whyRule(RULE_NAME[cl.type], ruleSentence(cl));
}

/** The decision on a purchase that waits for the owner. */
export function PurchaseDecision({ lane, disp, need, m, who, onToast }: {
  lane: Lane; disp: Display; need: AttentionItem; m: MandateListEntry | null; who: { name: string; entry?: { declared_payee: string | null } };
  onToast: (text: string, tone?: 'gold' | 'ok') => void;
}) {
  const deal = lane.deal;
  const locked = useLocked();
  const open = useMutation('approval_open');
  const lapse = useMutation('deal_let_lapse');
  const withdraw = useMutation('deal_withdraw');
  const [voidAsk, setVoidAsk] = useState(false);
  const t = dealTotal(deal);
  // A payment being checked with PayPal is not "on hold" (DECISIONS 31-36).
  const checking = !!need.money_check;
  const held = deal.state === 'AUTHORIZED' && !checking;
  const handOff = async (what: string) => {
    const r = await open.run({ deal_id: deal.id });
    if (r !== undefined) onToast(SPEND.handOff(what), 'gold');
  };
  const lock = locked ? <LockGlyph locked /> : null;
  const options: DecisionOption[] = [];
  if (need.actions.includes('review')) {
    options.push({
      kind: 'gold', disabled: open.pending, onClick: () => void handOff(held ? SPEND.payOrRelease : SPEND.decide),
      title: locked ? APPROVAL_LOCKED_TITLE : APPROVAL_OPEN_TITLE,
      label: <>{lock}{held ? SPEND.reviewPay : SPEND.review} ↗</>,
      means: held ? SPEND.reviewPayMeans : SPEND.reviewMeans,
    });
  }
  if (held) options.push({ label: SPEND.release, means: SPEND.releaseMeans(who.name), onClick: () => setVoidAsk(true) });
  if (need.actions.includes('let_lapse')) {
    options.push({
      label: SPEND.lapse, means: SPEND.lapseMeans, disabled: lapse.pending,
      onClick: async () => { const r = await lapse.run({ deal_id: deal.id }); if (r === null) onToast(SPEND.lapsed(disp.title), 'ok'); },
    });
  }
  if (need.actions.includes('withdraw') && canWithdraw(deal)) {
    options.push({
      label: SPEND.withdraw, kind: 'danger', means: SPEND.withdrawMeans, disabled: withdraw.pending,
      onClick: async () => { const r = await withdraw.run({ deal_id: deal.id }); if (r === null) onToast(SPEND.withdrawn(disp.title), 'ok'); },
    });
  }
  const context = [checking ? SPEND.checking : held ? SPEND.onHold : SPEND.waiting, lane.slot ? SPEND.agent(lane.slot) : null, deal.created_at ? SPEND.askedAt(clockLabel(deal.created_at)) : null].filter(Boolean).join(' · ');
  return (
    <>
      <DecisionCard context={context}
        question={held ? SPEND.payQ(who.name, disp.title) : SPEND.whatQ(disp.title, who.name)}
        why={whyAsked(deal, need, m, who)}
        amount={<Amount money={t} tone={amountTone(deal)} />}
        options={options}
        silence={need.on_silence} deadline={need.deadline}>
        {open.error ? <WalletNotice error={open.error} what={TABLES_TRADE.approvalWhat} /> : null}
        {lapse.error ? <WalletNotice error={lapse.error} what={SPEND.lapseWhat} /> : null}
        {withdraw.error ? <WalletNotice error={withdraw.error} what={SPEND.withdrawWhat} /> : null}
      </DecisionCard>
      {voidAsk ? (
        <Sheet title={SPEND.releaseQ(formatMinor(t.minor, t.currency))} size="narrow" onClose={() => setVoidAsk(false)} className="ar-spend"
          footer={<>
            <Btn onClick={() => setVoidAsk(false)}>{SPEND.keepHold}</Btn>
            <Btn kind="danger" locked={locked} disabled={open.pending} title={locked ? APPROVAL_LOCKED_TITLE : APPROVAL_OPEN_TITLE}
              onClick={async () => { setVoidAsk(false); await handOff(SPEND.releaseHold); }}>{SPEND.releaseIn} ↗</Btn>
          </>}>
          <Kv items={SPEND.releaseFacts(who.name, need.on_silence)} />
        </Sheet>
      ) : null}
    </>
  );
}

const GLYPH: Record<Cell['kind'], string> = { pass: '✓', fail: '✕', you: '◆', skip: '–', na: '·', unknown: '?' };
const CELL_WORD: Record<Cell['kind'], string> = { pass: SPEND.cellPass, fail: SPEND.cellFail, you: SPEND.cellYou, skip: SPEND.cellSkip, na: SPEND.cellNa, unknown: SPEND.cellUnknown };

/** The rules one purchase met, as a checklist; a rule name opens that rule's view when `onRule` is given. */
export function Trace({ cells, cols, onRule }: { cells: readonly Cell[]; cols: readonly GateColumn[]; onRule?: (n: number) => void }) {
  const allPassed = cells.length > 0 && cells.every((c) => c.kind === 'pass' || c.kind === 'na');
  return (
    <>
      <ol className="sp-trace">
        {cells.map((c) => {
          const col = cols.find((x) => x.n === c.n);
          const quiet = c.kind === 'pass' || c.kind === 'na';
          const name = col ? RULE_NAME[col.clause.type] : SPEND.yourRules;
          return (
            <li key={c.n} className={c.kind} title={col ? ruleSentence(col.clause) : undefined}>
              <span className="g" aria-label={CELL_WORD[c.kind]}>{GLYPH[c.kind]}</span>
              {onRule && col ? <button type="button" className="nm linkish" onClick={() => onRule(c.n)} title={SPEND.pickRule(name)}>{name}</button> : <span className="nm">{name}</span>}
              <span className="v">{quiet || c.kind === 'fail' ? (col ? columnValue(col.clause) : '') : CELL_WORD[c.kind]}</span>
              {c.kind === 'fail' ? <span className="why">{cap(c.text)}</span> : null}
            </li>
          );
        })}
      </ol>
      {allPassed ? <Hint>{SPEND.allPassed}</Hint> : null}
    </>
  );
}

/** Receipt and statement, as two calm chips (read for this purchase only). */
function ProofPills({ deal }: { deal: Deal }) {
  const ev = useEvidence(deal.id);
  const p = deal.paypal;
  if (deal.state === 'REFUSED' && !p.order && !p.authorization) return <span className="tx-ok">{SPEND.never}</span>;
  if (ev.error) return <Chip tone="dashed" title={SPEND.proofUnavailable}>{SPEND.proofUnavailable}</Chip>;
  if (!ev.data) return <span className="tx-dim">{SPEND.proofReading}</span>;
  const r = receiptWord(ev.data.receipt);
  const s = reconWord(ev.data.reconciliation);
  return <span className="sp-chips"><Chip tone={r.tone} title={r.means}>{r.text}</Chip><Chip tone={s.tone} title={s.means}>{s.text}</Chip></span>;
}

/** The signed rules, with the ones this purchase hit marked. */
export function ClauseList({ m, lane }: { m: MandateListEntry; lane: Lane | null }) {
  return (
    <ul className="sp-clist">
      {m.payload.clauses.map((c, i) => {
        const cell = lane?.cells.find((x) => x.n === i + 1);
        const hit = cell && (cell.kind === 'fail' || cell.kind === 'you') ? cell : null;
        return (
          <li key={i} className={hit ? `hit-${hit.kind}` : undefined}>
            <span className={`g ${hit ? hit.kind : ''}`} aria-hidden="true">{hit ? (hit.kind === 'fail' ? '✕' : '◆') : '•'}</span>
            <span className="t"><b>{RULE_NAME[c.type]}</b> <span className="tx-dim">· {ruleSentence(c)}</span>
              {hit ? <span className={`hit ${hit.kind === 'fail' ? 'tx-red' : 'tx-gold'}`}>{cap(hit.text)}</span> : null}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Everything about one purchase, under the decision when there is one. */
export function PurchasePane({ lane, disp, need, who, decision, onRule }: {
  lane: Lane; disp: Display; need: AttentionItem | undefined; who: string; decision?: ReactNode; onRule?: (n: number) => void;
}) {
  const m = lane.rules;
  const cols = lane.cols;
  const nav = useLayerNav();
  const d = lane.deal;
  const t = dealTotal(d);
  const out = outcomeOf(d);
  const by = decidedBy(d);
  const p = d.paypal;
  const refs = [p.order && SPEND.refOrder(p.order), p.authorization && SPEND.refHold(p.authorization), p.capture && SPEND.refPayment(p.capture)].filter((x): x is string => !!x);
  const held = out.kind === 'held' && !need?.money_check;
  return (
    <div className="sp-pane">
      <header className="tr-phead">
        <h2 title={disp.title}>{disp.title}</h2>
        <Chip tone={out.tone}>{need?.money_check ? SPEND.checking : out.label}</Chip>
        <span className="ui-spacer" />
        <Btn sm kind="plain" onClick={() => nav.deal(d.id)} title={TABLES_TRADE.openDealTitle}>{TABLES_TRADE.openDeal}</Btn>
      </header>
      {decision}
      <div className="sp-bigamt"><Amount money={t} tone={amountTone(d)} /><span className="tx-dim">{amountNote(d)}</span></div>
      <Kv items={[
        [SPEND.paying, who],
        [SPEND.asked(null), `${d.created_at ? clockLabel(d.created_at) : '—'}${lane.slot ? SPEND.byAgent(lane.slot) : ''}`],
        [SPEND.decidedBy, <span className={by.who === 'none' ? 'tx-dim' : undefined} title={by.why}>{cap(by.text)}</span>],
        held && disp.deadline ? [SPEND.timeLeft, <><Countdown deadline={disp.deadline} />{SPEND.toPay}</>] : null,
        need ? [SPEND.ifWait, need.on_silence] : null,
        [SPEND.item, <>{d.terms.qty > 1 ? `${d.terms.qty} × ` : ''}{disp.title}</>],
        [SPEND.proof, <ProofPills deal={d} />],
      ]} />
      <Section title={m ? SPEND.rulesOf(rulesName(m.agent)) : SPEND.yourRules}>
        {cols.length ? <Trace cells={lane.cells} cols={cols} onRule={lane.own ? onRule : undefined} /> : <Hint>{m ? SPEND.noRulesCover : SPEND.otherRules}</Hint>}
      </Section>
      {d.state === 'REFUSED' && m ? (
        <Disclosure summary={SPEND.whyRefused}>
          <p className="ui-hint">{SPEND.rulesSub}{SPEND.noUndoShort}</p>
          <ClauseList m={m} lane={lane} />
        </Disclosure>
      ) : null}
      {refs.length ? <Disclosure summary={SPEND.references}><p className="tr-mono">{refs.join(' · ')}</p></Disclosure> : null}
      <TheirWords dealId={d.id} who={who} />
    </div>
  );
}
