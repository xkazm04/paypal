// The top of the deal story: the figures (amount, status, money right now, time left), the five
// milestones, then the answer in one sentence and, when the deal needs the owner, one decision card.
// Review & approve only hands off to the approval window; Withdraw asks once in a Sheet and sends
// the real signed WITHDRAW. There is never a money button in Main, and a mismatch has no pay action.
import { Fragment, useState } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import type { MoneyCheck } from '@bindings/MoneyCheck';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import { clockLabel } from '../../../lib/format';
import { useMutation } from '../../../lib/hooks';
import { moneyCheckWord, silenceWords } from '../../../lib/words';
import { Countdown, MinorMoney, ModeBadge, WalletNotice } from '../../../shared/honesty';
import { AnswerBar, Btn, Chip, DecisionCard, Icon, Sheet, Silence, type DecisionOption } from '../../../shared/ui';
import { amountNote, amountTone, dealTotal, moneyNow } from '../logic';
import { useToast } from '../ui';
import { useWorld } from '../world';
import { milestones, stateTone, withdrawWhat, type ClauseReading, type MirrorStrip, type Reading } from './model';
import { dealAnswer, decisionQuestion, decisionWhy, reviewMeans } from './story';

export function Summary({ deal, strip, deadline, check }: { deal: Deal; strip: MirrorStrip; deadline: number | null; check?: MoneyCheck | null }) {
  const w = useWorld();
  const t = dealTotal(deal);
  // The title bar already carries the window's mode badge; repeat it only when this deal differs.
  const ownMode = w.settings.data?.mode !== deal.mode;
  const state = strip.term ? strip.term.label : (strip.steps.find((s) => s.status === 'cur')?.label ?? deal.state);
  return (
    <div className="dv-figs">
      <div className="dv-hero">
        <span className={`dv-amt ${amountTone(deal)}`} title={amountNote(deal)}><MinorMoney minor={t.minor} currency={t.currency} /></span>
        <span className="dv-pills">
          {check ? <Chip tone="dashed" title={moneyCheckWord(check).means}>{moneyCheckWord(check).text}</Chip> : <Chip tone={stateTone(strip)}>{state}</Chip>}
          {ownMode ? <ModeBadge mode={deal.mode} /> : null}
        </span>
      </div>
      <div className="dv-f">
        <span className="k">Money right now</span>
        <span className="v">{check ? 'Not confirmed yet, PayPal is being asked' : moneyNow(deal)}</span>
      </div>
      {deadline ? (
        <div className="dv-f push">
          <span className="k">Time left · until {clockLabel(deadline)}</span>
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
    <ol className={`dv-ms ${ended ? 'ended' : ''}`} aria-label="Where this deal is">
      {/* Ended before the first milestone: the marker leads, and every milestone after it is skipped. */}
      {m.end && m.end.after === null ? <EndMark end={m.end} first /> : null}
      {m.items.map((it, i) => (
        <Fragment key={it.key}>
          <li className={`ms ${it.status} ${it.tone ?? ''} ${ended && it.status === 'todo' ? 'skipped' : ''}`} aria-current={it.status === 'cur' ? 'step' : undefined} title={it.detail}>
            <span className="dot" aria-hidden="true">{MARK[it.status]}</span>
            <span className="lb">{it.text}</span>
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
        <span>Ended · <b>{end.label}</b></span>
      </li>
    </>
  );
}

/** The answer (one sentence) and, if the deal needs the owner, the one decision with what each option does. */
export function DealStory({ deal, need, canWithdraw, theirName, them, latest, band, readings, deadline, check }: {
  deal: Deal; need: AttentionItem | undefined; canWithdraw: boolean; theirName: string; them: string;
  latest: TranscriptStep | null; band: Reading | null; readings: readonly ClauseReading[]; deadline: number | null;
  check?: MoneyCheck | null;
}) {
  const w = useWorld();
  const toast = useToast();
  const disp = w.display(deal);
  const open = useMutation('approval_open');
  const withdraw = useMutation('deal_withdraw');
  const lapse = useMutation('deal_let_lapse');
  const [sheet, setSheet] = useState(false);

  // A mismatch is closed and has no pay action, whatever the attention item offers.
  const review = !!need?.actions.includes('review') && deal.state !== 'MISMATCH';
  const mayLapse = !!need?.actions.includes('let_lapse') && deal.state !== 'MISMATCH';
  const silence = need?.on_silence ?? disp.on_silence;
  const wText = withdrawWhat(deal, theirName);
  const answer = dealAnswer(deal, { need, them, latest, band, mayWithdraw: canWithdraw, check });

  const options: DecisionOption[] = [];
  if (need && review) {
    options.push({
      kind: 'gold', onClick: () => void open.run({ deal_id: deal.id }), disabled: open.pending,
      label: <>{w.locked ? <Icon name="hold" size={13} /> : null} Review &amp; approve ↗</>,
      means: reviewMeans(deal, w.locked),
      title: w.locked ? 'Opens the approval window, which asks for Windows Hello first' : 'Opens the approval window: the only place money can be released',
    });
  }
  if (need && mayLapse) {
    options.push({
      onClick: async () => { const r = await lapse.run({ deal_id: deal.id }); if (r === null) toast(<>{disp.label} will lapse at its deadline. <b>No money moves.</b></>, 'ok'); },
      disabled: lapse.pending, label: 'Let it lapse', means: 'Hides this until its deadline. It never agrees to anything and never cancels early.',
    });
  }
  if (need && canWithdraw) options.push({ kind: 'danger', onClick: () => setSheet(true), label: 'Withdraw', means: wText });
  const card = !!need && options.length > 0;
  const silenceLine = silence ? <Silence text={silenceWords(silence)} deadline={deadline} /> : null;
  // A needs-you item without a card (a mismatch) still shows its silence line, inside the answer.
  const showSil = !!need && !card && !!silenceLine;

  return (
    <>
      <AnswerBar tone={answer.tone} title={answer.title}
        sub={answer.sub || showSil ? <>{answer.sub}{showSil ? <span className="dv-ans-sil">{silenceLine}</span> : null}</> : undefined}
        actions={!card && canWithdraw ? <Btn sm kind="danger" onClick={() => setSheet(true)} title={wText}>Withdraw</Btn> : null} />
      {card && need ? (
        <DecisionCard className="dv-decision" context={<><Icon name="you" size={14} />Needs you</>}
          question={decisionQuestion(deal, need, them)} why={decisionWhy(deal, need, readings, deal.mandate_id)}
          options={options} silence={silence ? silenceWords(silence) : undefined} deadline={deadline} />
      ) : null}
      {[open.error, lapse.error].map((e, i) => (e ? <WalletNotice key={i} error={e} what={i === 0 ? 'Approval window' : 'Let it lapse'} /> : null))}
      {sheet ? (
        <Sheet title={`Withdraw from ${disp.label}?`} size="narrow" onClose={() => setSheet(false)}
          footer={
            <>
              <Btn onClick={() => setSheet(false)}>Keep the deal</Btn>
              <Btn kind="danger" disabled={withdraw.pending} onClick={async () => {
                const r = await withdraw.run({ deal_id: deal.id });
                if (r === null) { setSheet(false); toast(<>{disp.label} withdrawn. <b>No money moved.</b></>, 'ok'); }
              }}>{withdraw.pending ? 'Withdrawing…' : 'Withdraw'}</Btn>
            </>
          }>
          <p className="dv-p">{wText}</p>
          <p className="ui-hint">Withdrawing is always safe: it can’t move money.</p>
          {withdraw.error ? <WalletNotice error={withdraw.error} what="Withdraw" /> : null}
        </Sheet>
      ) : null}
    </>
  );
}
