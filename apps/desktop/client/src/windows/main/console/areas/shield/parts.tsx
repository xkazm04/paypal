// Parts of the Shield layer (rebuild WP3b): the one reading of the World, the hand-off to the
// approval window (the only place a paused payment is released: the owner types the payee's name
// there; releasing never happens in this window and a block has no release anywhere), the refuse
// confirm (deal_withdraw: no money moves, PayPal was never asked), a paused payment as a decision,
// and one line per checked payment. Counterparty words show only through the quarantined NoteText.
import { useMemo, useState, type ReactNode } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import type { ShieldVerdict } from '@bindings/ShieldVerdict';
import { useMutation, useNow, useQuery } from '../../../../../lib/hooks';
import { APPROVAL_LOCKED_TITLE, SHIELD, shieldReleased, shieldRuleWord, shieldWord } from '../../../../../lib/words';
import { MinorMoney, WalletNotice } from '../../../../../shared/honesty';
import { MODULE } from '../../../../../shared/modules';
import { Btn, Chip, DecisionCard, Icon, Kv, Sheet, useToast, type DecisionOption } from '../../../../../shared/ui';
import { canWithdraw, dealTotal, stateLabel } from '../../../logic';
import { NoteChip } from '../../../modules/shield/NoteChip';
import { CheckLights, ComparePanel, ReasonWhy } from '../../../modules/shield/Panels';
import { knownPayees } from '../../../modules/shield/normal';
import { paypalLine, reasonsFor, releasable } from '../../../modules/shield/matrix';
import { useCpLookup } from '../../../ui';
import { useDeals, useLocked, useNeeds, useWorldSelector, type World } from '../../../world';
import { Amount, Countdown } from '../../rows';
import { needFor, shieldSets, type ShieldSets } from './model';

const NO_DEALS: readonly Deal[] = [];
const selModuleOf = (w: World) => w.moduleOfDeal;
const selDisplay = (w: World) => w.display;

export type ShieldWorld = ShieldSets & {
  loaded: boolean;
  error: ReturnType<typeof useDeals>['error'];
  need: (d: Deal) => AttentionItem | undefined;
  who: (d: Deal) => string;
  cpEntry: (d: Deal) => ReturnType<ReturnType<typeof useCpLookup>>['entry'];
  house: (d: Deal) => boolean;
  title: (d: Deal) => string;
  moduleName: (d: Deal) => string;
  known: { known: number; total: number } | null;
};

export function useShieldWorld(): ShieldWorld {
  const q = useDeals();
  const deals = q.data ?? NO_DEALS;
  const needs = useNeeds();
  const moduleOf = useWorldSelector(selModuleOf);
  const display = useWorldSelector(selDisplay);
  const cp = useCpLookup();
  const cpList = useQuery('counterparty_list', null, { refreshOn: ['deal:changed'] });
  const known = useMemo(() => knownPayees(cpList.data), [cpList.data]);
  const byId = useMemo(() => new Map(needs.map((n) => [n.deal_id, n] as const)), [needs]);
  const sets = useMemo(() => shieldSets(deals, moduleOf, (id) => byId.get(id)), [deals, moduleOf, byId]);
  const error = q.error;
  const loaded = !!q.data;
  return useMemo(() => ({
    ...sets, loaded, error, known,
    need: (d: Deal) => needFor(d, byId.get(d.id)),
    who: (d: Deal) => cp(d.counterparty).name,
    cpEntry: (d: Deal) => cp(d.counterparty).entry,
    house: (d: Deal) => !!cp(d.counterparty).house,
    title: (d: Deal) => display(d).title,
    moduleName: (d: Deal) => MODULE[moduleOf(d)].name,
  }), [sets, loaded, error, known, byId, cp, display, moduleOf]);
}

/** The shield's verdict as a chip; no verdict is dashed, never "clear". */
export function VerdictChip({ v }: { v: ShieldVerdict | null }) {
  if (!v) return <Chip tone="dashed" title={SHIELD.noVerdictTitle}>{SHIELD.noVerdict}</Chip>;
  const w = shieldWord(v);
  return <Chip tone={w.tone} title={w.means}>{w.text}</Chip>;
}

/** Opens the approval window on this payment (approval_open), where releasing happens. Lock glyph
 *  and the locked title when idle-locked, disabled while the window opens, the notice on error. */
export function ReleaseHandoff({ deal, need, sm }: { deal: Deal; need: AttentionItem; sm?: boolean }) {
  const open = useMutation('approval_open');
  const locked = useLocked();
  const toast = useToast();
  const live = releasable(deal);
  const go = async () => {
    const r = await open.run({ deal_id: deal.id });
    if (r !== undefined && live) toast(SHIELD.opened, 'gold');
  };
  if (!live && !need.actions.includes('review')) return null;
  return (
    <>
      <Btn kind="gold" sm={sm} locked={locked} disabled={open.pending} onClick={() => void go()} title={locked ? APPROVAL_LOCKED_TITLE : live ? SHIELD.releaseTitle : SHIELD.reviewTitle} data-fk="shield-release">
        {live ? SHIELD.release : SHIELD.review} <span aria-hidden="true">↗</span>
      </Btn>
      {open.error ? <WalletNotice error={open.error} what={SHIELD.approvalWhat} /> : null}
    </>
  );
}

/** "Refuse…" and its confirm: the purchase is cancelled for good here (no approval needed to say
 *  no), no money moves and PayPal was never asked. */
export function RefuseButton({ deal, need, title }: { deal: Deal; need: AttentionItem; title: string }) {
  const withdraw = useMutation('deal_withdraw');
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  if (!(canWithdraw(deal) && need.actions.includes('withdraw'))) return null;
  return (
    <>
      <Btn kind="plain" className="sh-refuse" onClick={() => setAsking(true)}>{SHIELD.refuse}</Btn>
      {withdraw.error ? <WalletNotice error={withdraw.error} what={SHIELD.refuseWhat} /> : null}
      {asking ? (
        <Sheet title={SHIELD.refuseTitle(title)} size="narrow" onClose={() => setAsking(false)} className="ar-shield"
          footer={<>
            <Btn onClick={() => setAsking(false)}>{SHIELD.keepPaused}</Btn>
            <Btn kind="danger" disabled={withdraw.pending} onClick={async () => {
              const r = await withdraw.run({ deal_id: deal.id });
              setAsking(false);
              if (r === null) toast(SHIELD.refused(title), 'ok');
            }}>{withdraw.pending ? SHIELD.refusing : SHIELD.refuseAct}</Btn>
          </>}>
          <Kv items={SHIELD.refuseFacts.map(([k, v]) => [k, v] as const)} />
        </Sheet>
      ) : null}
    </>
  );
}

/** A paused payment as one decision: who and how much, why it was paused (each reason with its
 *  Why?), what is normal against this payment, the checks' lights, the hand-off and the default. */
export function PausedDecision({ deal, s, onDeal }: { deal: Deal; s: ShieldWorld; onDeal: () => void }) {
  const now = useNow();
  const need = s.need(deal);
  if (!need) return null;
  const who = s.who(deal);
  const cp = s.cpEntry(deal);
  const live = releasable(deal);
  const options: DecisionOption[] = [];
  // The decision card's own buttons stay quiet: the hand-off below is the one gold action.
  options.push({ label: SHIELD.openDeal, onClick: onDeal, means: SHIELD.openDealMeans });
  const t = dealTotal(deal);
  return (
    <div className="sh-paused">
      <DecisionCard className="sh-card"
        context={<><Icon name="pause" size={13} />{SHIELD.pausedBefore} · <span className="sh-ctx" title={s.title(deal)}>{s.title(deal)}</span><NoteChip dealId={deal.id} who={who} /></>}
        question={live ? SHIELD.letGo(who) : SHIELD.whatNow(who)}
        amount={<MinorMoney minor={t.minor} currency={t.currency} />}
        options={options} silence={need.on_silence} deadline={need.deadline}>
        <ul className="sh-reasons" aria-label={SHIELD.whyPaused}>
          {reasonsFor(deal, cp, now).map((r) => (
            <li key={r.text} title={r.detail}><span className="ico" aria-hidden="true"><Icon name={r.icon} size={14} /></span>{r.text}
              <ReasonWhy reason={r} deal={deal} cp={cp} now={now} /></li>
          ))}
        </ul>
        <div className="sh-evid">
          <ComparePanel deal={deal} cp={cp} known={s.known} now={now} />
          <CheckLights deal={deal} cp={cp} now={now} />
        </div>
      </DecisionCard>
      <div className="cs-acts sh-acts">
        <ReleaseHandoff deal={deal} need={need} />
        <RefuseButton deal={deal} need={need} title={s.title(deal)} />
      </div>
      <p className="ui-hint">{live ? SHIELD.releaseMeans : SHIELD.reviewMeans}</p>
    </div>
  );
}

/** One payment the shield checked, as a list row's content (the row is the button: no control here). */
export function ShieldRow({ deal, s }: { deal: Deal; s: ShieldWorld }) {
  const need = s.need(deal);
  const t = dealTotal(deal);
  const [a, b] = paypalLine(deal);
  const kind = deal.shield === 'BLOCK' ? 'block' : need ? 'paused' : deal.shield === 'HOLD' && !deal.shield_release ? 'closed' : deal.shield === 'CLEAR' ? 'clear' : 'other';
  const why = deal.shield_rule ? shieldRuleWord(deal.shield_rule).text : null;
  let sub: ReactNode;
  if (kind === 'block') sub = <span className="tx-red">{SHIELD.row.blocked(why, b)}</span>;
  else if (kind === 'paused') sub = SHIELD.row.paused(why);
  else if (kind === 'closed') sub = SHIELD.row.closed(why, stateLabel(deal.state, deal).toLowerCase(), a.toLowerCase());
  else if (kind === 'clear') sub = SHIELD.row.clear(stateLabel(deal.state, deal));
  else if (shieldReleased(deal)) sub = SHIELD.row.released(s.moduleName(deal));
  else sub = SHIELD.row.other(why, s.moduleName(deal));
  return (
    <span className={`sh-row k-${kind}`}>
      <span className="sh-lead" aria-hidden="true"><Icon name={kind === 'block' ? 'block' : kind === 'paused' || kind === 'closed' ? 'pause' : kind === 'clear' ? 'check' : 'eye'} size={13} /></span>
      <span className="sh-what">
        <b title={s.who(deal)}>{s.who(deal)}</b>
        <span className="sh-sub" title={s.title(deal)}>{s.title(deal)} · {sub}</span>
      </span>
      {kind === 'closed' ? <Chip tone="line" title={SHIELD.closedTitle}>{SHIELD.closedChip}</Chip> : <VerdictChip v={deal.shield} />}
      {need ? <Countdown deadline={need.deadline} /> : null}
      <Amount money={t} tone={kind === 'block' ? 'struck' : undefined} />
    </span>
  );
}

/** A list this short is drawn at its own height (no long empty band under a few rows). */
export const FEW_ROWS = 6;
export const fewRows = (n: number): string | undefined => (n <= FEW_ROWS ? 'few' : undefined);
