// The top of the deal page (rebuild WP3c; moved from deal/Decision.tsx): the figures beside the
// title (amount, state or money-check pill, money right now, time left), the five milestones, and,
// when the deal needs the owner, the one decision. Review & approve / Review & release only hand
// off to the approval window (approval_open {deal_id}, the lock glyph and the locked title while
// idle-locked, disabled while it opens, a notice on error); Let it lapse sends the real
// deal_let_lapse; Withdraw asks once and sends the real signed withdraw. There is never a money
// button in Main, and a mismatch has no pay action.
import { Fragment, useState } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import type { MoneyCheck } from '@bindings/MoneyCheck';
import { clockLabel } from '../../../../../lib/format';
import { useMutation } from '../../../../../lib/hooks';
import { APPROVAL_LOCKED_TITLE, DEAL_DECIDE, DEAL_FIGS, moneyCheckNow, moneyCheckPill, silenceWords } from '../../../../../lib/words';
import { Countdown, MinorMoney, ModeBadge, WalletNotice } from '../../../../../shared/honesty';
import { Btn, Chip, DecisionCard, Icon, Sheet, Silence, type DecisionOption } from '../../../../../shared/ui';
import { milestones, stateTone, withdrawWhat, type ClauseReading, type MirrorStrip } from '../../../deal/model';
import { decisionQuestion, decisionWhy, reviewMeans } from '../../../deal/story';
import { shortTitle } from '../../../home/model';
import { amountNote, amountTone, dealTotal, isTerminal, moneyNow } from '../../../logic';
import { releasable, releaseCase } from '../../../modules/shield/matrix';
import { useToast } from '../../../ui';
import { useDisplayOf, useLocked, useSettings } from '../../../world';

export function Summary({ deal, strip, deadline, check }: { deal: Deal; strip: MirrorStrip; deadline: number | null; check?: MoneyCheck | null }) {
  const settings = useSettings().data;
  const t = dealTotal(deal);
  // The console's footer carries the window's mode badge; repeat it only when this deal differs
  // (and only once the settings say so: no badge flashes on every deal while they load).
  const ownMode = !!settings && settings.mode !== deal.mode;
  const ended = isTerminal(deal);
  const pill = check ? moneyCheckPill(check, ended) : null;
  const state = strip.term ? strip.term.label : (strip.steps.find((s) => s.status === 'cur')?.label ?? null);
  return (
    <div className="dv-figs">
      <div className="dv-hero">
        <span className={`dv-amt ${amountTone(deal)}`} title={check ? moneyCheckNow(ended) : amountNote(deal)}><MinorMoney minor={t.minor} currency={t.currency} /></span>
        <span className="dv-pills">
          {pill ? <Chip tone="dashed" title={pill.means}>{pill.text}</Chip> : state ? <Chip tone={stateTone(strip)}>{state}</Chip> : null}
          {ownMode ? <ModeBadge mode={deal.mode} /> : null}
        </span>
      </div>
      <div className="dv-f">
        <span className="k">{DEAL_FIGS.moneyNow}</span>
        <span className="v">{check ? moneyCheckNow(ended) : moneyNow(deal)}</span>
      </div>
      {deadline ? (
        <div className="dv-f">
          <span className="k">{DEAL_FIGS.timeLeft(clockLabel(deadline))}</span>
          <Countdown deadline={deadline} className="dv-cd" />
        </div>
      ) : null}
    </div>
  );
}

const MARK: Record<'done' | 'cur' | 'todo', string> = { done: '✓', cur: '', todo: '' };

/** Talk · Agree · Approve · Pay · Proof as one progress bar. An early ending is its own marker. */
export function StateStrip({ strip }: { strip: MirrorStrip }) {
  const m = milestones(strip);
  const ended = !!m.end;
  return (
    <ol className={`dv-ms ${ended ? 'ended' : ''}`} aria-label={DEAL_FIGS.milestones}>
      {/* Ended before the first milestone: the marker leads, and every milestone after it is skipped. */}
      {m.end && m.end.after === null ? <EndMark end={m.end} first /> : null}
      {m.items.map((it, i) => (
        <Fragment key={it.key}>
          <li className={`ms ${it.status} ${it.tone ?? ''} ${ended && it.status === 'todo' ? 'skipped' : ''}`} aria-current={it.status === 'cur' ? 'step' : undefined} title={it.detail}>
            <span className="dot" aria-hidden="true">{MARK[it.status]}</span>
            <span className="lb">{it.text}</span>
            {it.status === 'cur' ? null : <span className="sr-only">{it.status === 'done' ? DEAL_FIGS.msDone : ended ? DEAL_FIGS.msSkipped : DEAL_FIGS.msTodo}</span>}
            {it.status === 'cur' ? <span className="now">{strip.steps.find((s) => s.status === 'cur')?.label}</span> : null}
          </li>
          {m.end && m.end.after === it.key ? <EndMark end={m.end} /> : null}
          {i < m.items.length - 1 && !(m.end && m.end.after === it.key) ? <li className={`bar ${it.status === 'done' ? 'done' : ''}`} aria-hidden="true" /> : null}
        </Fragment>
      ))}
    </ol>
  );
}

function EndMark({ end, first }: { end: NonNullable<ReturnType<typeof milestones>['end']>; first?: boolean }) {
  return (
    <>
      {first ? null : <li className="bar cut" aria-hidden="true" />}
      <li className={`ms-end ${end.tone}`} aria-current="step">
        <span className="stop" aria-hidden="true">{end.tone === 'bad' ? '×' : '–'}</span>
        <span>{DEAL_FIGS.ended} · <b>{end.label}</b></span>
      </li>
      {first ? <li className="bar cut" aria-hidden="true" /> : null}
    </>
  );
}

/** The one decision, when the deal needs the owner: what each option does and what happens if
 *  they do nothing. A needs-you item with no option (a mismatch) still says its silence line.
 *  Without a need, Withdraw (when it is allowed) is a quiet action of the page. */
export function DealDecision({ deal, need, canWithdraw, theirName, them, readings, deadline }: {
  deal: Deal; need: AttentionItem | undefined; canWithdraw: boolean; theirName: string; them: string; readings: readonly ClauseReading[]; deadline: number | null;
}) {
  const disp = useDisplayOf(deal.id);
  const locked = useLocked();
  const toast = useToast();
  const open = useMutation('approval_open');
  const lapse = useMutation('deal_let_lapse');
  const [asking, setAsking] = useState(false);
  const label = disp?.label ?? '';
  const title = shortTitle(disp?.title ?? '');

  // A mismatch is closed and has no pay action, whatever the attention item offers.
  const review = !!need?.actions.includes('review') && deal.state !== 'MISMATCH';
  const mayLapse = !!need?.actions.includes('let_lapse') && deal.state !== 'MISMATCH';
  const silence = need?.on_silence ?? null;
  const wText = withdrawWhat(deal, theirName);
  const lock = locked ? <Icon name="hold" size={13} /> : null;

  const options: DecisionOption[] = [];
  if (need && review) {
    options.push({
      kind: 'gold', onClick: () => void open.run({ deal_id: deal.id }), disabled: open.pending,
      label: <>{lock} {DEAL_DECIDE.review}</>, means: reviewMeans(deal, locked), title: locked ? APPROVAL_LOCKED_TITLE : DEAL_DECIDE.reviewTitle,
    });
  }
  // A live scam-check pause: the same hand-off as the Shield page (the typed-name release happens in
  // the approval window). Releasing never pays.
  if (need && !review && releasable(deal)) {
    options.push({
      kind: 'gold', onClick: () => void open.run({ deal_id: deal.id }), disabled: open.pending,
      label: <>{lock} {DEAL_DECIDE.release}</>, means: DEAL_DECIDE.releaseMeans[releaseCase(deal)], title: locked ? APPROVAL_LOCKED_TITLE : DEAL_DECIDE.releaseTitle,
    });
  }
  if (need && mayLapse) {
    options.push({
      onClick: async () => { const r = await lapse.run({ deal_id: deal.id }); if (r === null) toast(DEAL_DECIDE.lapsed(label), 'ok'); },
      disabled: lapse.pending, label: DEAL_DECIDE.lapse, means: DEAL_DECIDE.lapseMeans,
    });
  }
  if (need && canWithdraw) options.push({ kind: 'danger', onClick: () => setAsking(true), label: DEAL_DECIDE.withdraw, means: wText });

  return (
    <>
      {need && options.length ? (
        <DecisionCard className="dv-decision" context={<><Icon name="you" size={14} />{DEAL_DECIDE.context}</>}
          question={decisionQuestion(deal, need, them)} why={decisionWhy(deal, need, readings, deal.mandate_id)}
          options={options} silence={silence ? silenceWords(silence) : undefined} deadline={deadline} />
      ) : need && silence ? (
        <p className="dv-need-sil"><span className="dv-need-k"><Icon name="you" size={14} />{DEAL_DECIDE.context}</span> <Silence text={silenceWords(silence)} deadline={deadline} /></p>
      ) : null}
      {!need && canWithdraw ? (
        <p className="dv-quiet"><Btn sm kind="danger" onClick={() => setAsking(true)} title={wText}>{DEAL_DECIDE.withdraw}</Btn></p>
      ) : null}
      {open.error ? <WalletNotice error={open.error} what={DEAL_DECIDE.failApproval} /> : null}
      {lapse.error ? <WalletNotice error={lapse.error} what={DEAL_DECIDE.failLapse} /> : null}
      {asking ? <WithdrawSheet deal={deal} title={title} what={wText} onClose={() => setAsking(false)} /> : null}
    </>
  );
}

function WithdrawSheet({ deal, title, what, onClose }: { deal: Deal; title: string; what: string; onClose: () => void }) {
  const withdraw = useMutation('deal_withdraw');
  const toast = useToast();
  return (
    <Sheet title={DEAL_DECIDE.withdrawAsk(title)} size="narrow" onClose={onClose} className="ar-deal-sheet"
      footer={
        <>
          <Btn onClick={onClose}>{DEAL_DECIDE.keep}</Btn>
          <Btn kind="danger" disabled={withdraw.pending} onClick={async () => {
            const r = await withdraw.run({ deal_id: deal.id });
            if (r === null) { onClose(); toast(DEAL_DECIDE.withdrawn(title), 'ok'); }
          }}>{withdraw.pending ? DEAL_DECIDE.withdrawing : DEAL_DECIDE.withdraw}</Btn>
        </>
      }>
      <p className="dv-p">{what}</p>
      <p className="ui-hint">{DEAL_DECIDE.withdrawSafe}</p>
      {withdraw.error ? <WalletNotice error={withdraw.error} what={DEAL_DECIDE.failWithdraw} /> : null}
    </Sheet>
  );
}
