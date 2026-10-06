// Round 2 pieces of the Rescue page (experiment r2-rescue): the money strip, what the subscriber
// would get for each fix, and a Why? on each fix. Display only: nothing here sends a fix, creates an
// invoice or moves money. Facts and wording: ./preview.ts. Styles: ../rescue.css (.rs-strip, .rs-get, .rs-fix).
import type { ReactNode } from 'react';
import { Icon, Why, type IconName } from '../../../../shared/ui';
import type { Preview, PreviewChannel, RescueStrip } from './preview';
import { moneyList } from './preview';

// ---- money at risk · in progress · recovered -----------------------------------------------------------------

function Seg({ tone, icon, label, value, sub }: { tone: 'risk' | 'prog' | 'ok'; icon: IconName; label: string; value: string | null; sub: ReactNode }) {
  return (
    <li className={`seg ${tone} ${value ? 'has' : 'none'}`}>
      <span className="ico" aria-hidden="true"><Icon name={icon} size={16} /></span>
      <span className="tx">
        <span className="k">{label}</span>
        <span className="v">{value ?? 'none'}</span>
        <span className="s">{sub}</span>
      </span>
    </li>
  );
}

/** One line: what is at risk, what is on its way, what really came back. Replays never count as recovered. */
export function RescueMoney({ strip }: { strip: RescueStrip }) {
  const f = strip.failing;
  const risk = f ? `${f} ${f === 1 ? 'renewal' : 'renewals'} failing${strip.notReal ? (strip.notReal === f ? ' · replay, not real money' : ` · ${strip.notReal} replay`) : ''}` : 'no renewal failing';
  return (
    <ul className="rs-strip" aria-label="Rescue money">
      <Seg tone="risk" icon="alert" label="At risk" value={moneyList(strip.atRisk)} sub={risk} />
      <Seg tone="prog" icon="clock" label="In progress" value={moneyList(strip.inProgress)} sub={strip.inflight ? `${strip.inflight} waiting for the subscriber` : 'nothing waiting'} />
      <Seg tone="ok" icon="check" label="Recovered" value={moneyList(strip.recovered)} sub="really paid only · replays never count" />
    </ul>
  );
}

// ---- what the subscriber would get ---------------------------------------------------------------------------

const CHANNEL_ICON: Record<PreviewChannel, IconName> = { invoice: 'rules', email: 'chat', retry: 'renew' };

/** A small mock of the invoice line or email subject. An amount that is not chosen yet is dashed. */
export function FixGet({ preview }: { preview: Preview }) {
  return (
    <div className={`rs-get ${preview.channel}`} role="group" aria-label="What the subscriber would get">
      <div className="mock">
        <span className="ch"><Icon name={CHANNEL_ICON[preview.channel]} size={12} />They’d get · {preview.kind}</span>
        <span className="ln">{preview.line}</span>
        {preview.amount ? <span className="amw">{preview.amount.label ? <span className="al">{preview.amount.label}</span> : null}<span className={`am ${preview.amount.unknown ? 'unk' : ''}`}>{preview.amount.text}</span></span> : null}
        {preview.note ? <span className="nt">{preview.note}</span> : null}
      </div>
    </div>
  );
}

/** A switched-off fix has nothing to preview: a dashed placeholder keeps the cards the same height. */
export function FixGetOff() {
  return (
    <div className="rs-get off" role="group" aria-label="What the subscriber would get">
      <div className="mock"><span className="ch">They’d get</span><span className="ln">Nothing: not offered for this renewal</span></div>
    </div>
  );
}

/** "Why?" behind a fix: two sentences from the lever list and facts on the card. */
export function FixWhy({ question, lines }: { question: string; lines: readonly [string, string] }) {
  return <Why question={question}><p>{lines[0]}</p><p>{lines[1]}</p></Why>;
}
