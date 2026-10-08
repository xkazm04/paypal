// The story kit (docs/ux/ROUND-1.md): the pieces every screen is assembled from so a person who is
// not a developer reads it top-down without learning a chart first.
//   AnswerBar      one sentence that answers the screen's question, coloured by how things stand
//   DecisionCard   one decision: the question, why you are asked, each option with what it does
//   Explainer      a first-visit "how this works" strip of three illustrated steps, dismissible
//   ChecksSummary  passed checks folded into a count; only exceptions stay open
//   DetailToggle   Simple / Detailed, remembered per screen (the specialist view lives in Detailed)
//   Icon           a small stroke icon set; always paired with a word or an aria-label
// Display only. A DecisionCard option in Main only ever hands off to the approval window.
import { useEffect, useState, type ReactNode } from 'react';
import { Silence, type ChipTone } from './components';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

// ---- icons ----------------------------------------------------------------------------------------

const ICON = {
  check: 'M3 8.5l3 3 7-7',
  alert: 'M8 2.5l6 11H2zM8 6.5v3.2M8 11.6v.2',
  pause: 'M5.5 3v10M10.5 3v10',
  block: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM3.8 3.8l8.4 8.4',
  you: 'M8 7.5a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2zM3 14c.6-2.8 2.6-4.3 5-4.3s4.4 1.5 5 4.3',
  agent: 'M4 5.5h8a1.5 1.5 0 0 1 1.5 1.5v4.5A1.5 1.5 0 0 1 12 13H4a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 4 5.5zM8 2.5v3M6 9h.01M10 9h.01',
  rules: 'M4 1.8h5.5L12.5 5v9.2H4zM6 7.5h4.5M6 10h3.5',
  money: 'M2 4.5h12v7H2zM8 9.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zM4.2 6.2v.01M11.8 9.8v.01',
  hold: 'M4.5 7V5.2a3.5 3.5 0 0 1 7 0V7M3.5 7h9v6.5h-9z',
  shield: 'M8 1.8l5 2v4c0 3-2.2 5.3-5 6.4-2.8-1.1-5-3.4-5-6.4v-4z',
  chat: 'M2.5 3.5h11v7.5H7L4 13.5v-2.5H2.5z',
  tag: 'M2.5 2.5h5.3l5.7 5.7-5.3 5.3-5.7-5.7zM5.3 5.3v.01',
  box: 'M2.5 5L8 2.5 13.5 5v6.5L8 14l-5.5-2.5zM2.5 5L8 7.5 13.5 5M8 7.5V14',
  store: 'M2.5 6.5h11M3.5 6.5V13.5h9V6.5M2.5 6.5l1.2-4h8.6l1.2 4M6.5 13.5v-4h3v4',
  renew: 'M13 5.5A5.5 5.5 0 0 0 3 6M3 2.8V6h3.2M3 10.5A5.5 5.5 0 0 0 13 10M13 13.2V10H9.8',
  book: 'M8 4c-1.8-1.2-3.8-1.5-5.5-1.3v9.8c1.7-.2 3.7.1 5.5 1.3 1.8-1.2 3.8-1.5 5.5-1.3V2.7C11.8 2.5 9.8 2.8 8 4zM8 4v9.8',
  link: 'M6.5 9.5l3-3M5.5 7.5L4 9a2.1 2.1 0 0 0 3 3l1.5-1.5M10.5 8.5L12 7a2.1 2.1 0 0 0-3-3L7.5 5.5',
  eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  clock: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 4.8V8l2.3 1.6',
  bank: 'M2 6.2L8 2.8l6 3.4M3 6.5v6M6.3 6.5v6M9.7 6.5v6M13 6.5v6M2 13.5h12',
  spark: 'M8 1.8v3M8 11.2v3M1.8 8h3M11.2 8h3M3.6 3.6l2.1 2.1M10.3 10.3l2.1 2.1M3.6 12.4l2.1-2.1M10.3 5.7l2.1-2.1',
  arrow: 'M3 8h10M9.5 4.5L13 8l-3.5 3.5',
} as const;
export type IconName = keyof typeof ICON;

export function Icon({ name, size = 16, label, className }: { name: IconName; size?: number; label?: string; className?: string }) {
  return (
    <svg className={cx('ui-icon', className)} width={size} height={size} viewBox="0 0 16 16" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={ICON[name]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---- answer bar -----------------------------------------------------------------------------------

export type StoryTone = 'calm' | 'need' | 'alert' | 'done';
const TONE_ICON: Record<StoryTone, IconName> = { calm: 'check', need: 'you', alert: 'alert', done: 'check' };

/** The screen's answer in one sentence, before anything else. `title` is the answer; `sub` one supporting line. */
export function AnswerBar({ tone, title, sub, icon, actions, className }: { tone: StoryTone; title: ReactNode; sub?: ReactNode; icon?: IconName; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx('ui-answer', `tone-${tone}`, className)} role="status">
      <span className="ico" aria-hidden="true"><Icon name={icon ?? TONE_ICON[tone]} size={18} /></span>
      <div className="txt">
        <div className="t">{title}</div>
        {sub ? <div className="s">{sub}</div> : null}
      </div>
      {actions ? <div className="act">{actions}</div> : null}
    </div>
  );
}

// ---- decision card --------------------------------------------------------------------------------

export type DecisionOption = {
  label: ReactNode;
  /** What choosing it does, in one short line ("Price agreed. You pay later on PayPal."). */
  means: ReactNode;
  kind?: 'gold' | 'default' | 'danger';
  onClick: () => void;
  disabled?: boolean;
  title?: string;
};

/** One decision. The question is a sentence about people and money, the reason names the rule,
 *  every option says what it does, and the default on silence closes the card. */
export function DecisionCard({ context, question, why, amount, options, silence, deadline, onDetails, detailsLabel = 'Details', className, children }: {
  context?: ReactNode; question: ReactNode; why?: ReactNode; amount?: ReactNode; options: DecisionOption[];
  silence?: ReactNode; deadline?: number | null; onDetails?: () => void; detailsLabel?: string; className?: string; children?: ReactNode;
}) {
  return (
    <article className={cx('ui-decision', className)}>
      {context || onDetails ? (
        <header className="dc-h">
          <span className="ctx">{context}</span>
          {onDetails ? <button type="button" className="dc-more" onClick={onDetails}>{detailsLabel} ›</button> : null}
        </header>
      ) : null}
      <div className="dc-q">
        <div className="q">
          <h2>{question}</h2>
          {why ? <p className="why"><Icon name="rules" size={14} />{why}</p> : null}
        </div>
        {amount ? <div className="amt">{amount}</div> : null}
      </div>
      {children}
      <div className="dc-opts">
        {options.map((o, i) => (
          <button key={i} type="button" className={cx('dc-opt', o.kind ?? 'default')} onClick={o.onClick} disabled={o.disabled} title={o.title}>
            <span className="l">{o.label}</span>
            <span className="m">{o.means}</span>
          </button>
        ))}
      </div>
      {silence ? <Silence className="dc-sil" text={silence} deadline={deadline ?? null} /> : null}
    </article>
  );
}

// ---- explainer ------------------------------------------------------------------------------------

export type ExplainerStep = { icon: IconName; title: string; text: string };
const EXPLAINER_KEY = (id: string) => `table-explainer-${id}`;
function readSeen(id: string): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(EXPLAINER_KEY(id)) === 'seen'; } catch { return false; }
}

/** First visit: three illustrated steps and "Got it". Afterwards: a small "How X works" link that reopens it. */
export function Explainer({ id, title, steps, className }: { id: string; title: string; steps: readonly ExplainerStep[]; className?: string }) {
  const [open, setOpen] = useState(() => !readSeen(id));
  useEffect(() => { setOpen(!readSeen(id)); }, [id]);
  const close = () => {
    setOpen(false);
    try { localStorage.setItem(EXPLAINER_KEY(id), 'seen'); } catch { /* storage may be blocked; it just shows again */ }
  };
  if (!open) {
    return <button type="button" className={cx('ui-explainer-link', className)} onClick={() => setOpen(true)}><Icon name="spark" size={13} />{title}</button>;
  }
  return (
    <section className={cx('ui-explainer', className)} aria-label={title}>
      <div className="ex-h"><b>{title}</b><button type="button" className="ui-btn sm" onClick={close}>Got it</button></div>
      <ol className="ex-steps">
        {steps.map((s, i) => (
          <li key={i}>
            <span className="ex-ico" aria-hidden="true"><Icon name={s.icon} size={18} /></span>
            <span className="ex-t">{s.title}</span>
            <span className="ex-d">{s.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---- checks summary -------------------------------------------------------------------------------

export type CheckState = 'pass' | 'ask' | 'fail' | 'unknown';
export type CheckItem = { name: ReactNode; state: CheckState; value?: ReactNode; title?: string };
const CHECK_ICON: Record<CheckState, IconName> = { pass: 'check', ask: 'you', fail: 'block', unknown: 'eye' };
const CHECK_WORD: Record<CheckState, string> = { pass: 'passed', ask: 'asks you', fail: 'stopped it', unknown: 'not checked here' };

/** "✓ 5 passed · 1 asks you": exceptions stay listed, passed checks fold into the count. */
export function ChecksSummary({ checks, label = 'Checks', className, openAll = false }: { checks: readonly CheckItem[]; label?: string; className?: string; openAll?: boolean }) {
  const [all, setAll] = useState(openAll);
  const n = (s: CheckState) => checks.filter((c) => c.state === s).length;
  // Two or more unknowns fold into one dashed line (UX-GUIDE: never a question-mark wall).
  const foldUnknown = !all && n('unknown') >= 2;
  const shown = all ? checks : checks.filter((c) => c.state !== 'pass' && !(foldUnknown && c.state === 'unknown'));
  const unknownNames = checks.filter((c) => c.state === 'unknown').map((c) => c.name);
  const parts = (['pass', 'ask', 'fail', 'unknown'] as const).filter((s) => n(s)).map((s) => (
    <span key={s} className={`cs-n ${s}`}><Icon name={CHECK_ICON[s]} size={13} />{n(s)} {CHECK_WORD[s]}</span>
  ));
  return (
    <div className={cx('ui-checks', className)} aria-label={label}>
      <div className="cs-sum">{parts}{checks.some((c) => c.state === 'pass') ? <button type="button" className="cs-all" onClick={() => setAll((x) => !x)}>{all ? 'Hide passed' : 'Show all'}</button> : null}</div>
      {shown.length || foldUnknown ? (
        <ul className="cs-list">
          {shown.map((c, i) => (
            <li key={i} className={c.state} title={c.title}>
              <span className="cs-i" aria-label={CHECK_WORD[c.state]}><Icon name={CHECK_ICON[c.state]} size={13} /></span>
              <span className="cs-name">{c.name}</span>
              {c.value !== undefined ? <span className="cs-v">{c.value}</span> : null}
            </li>
          ))}
          {foldUnknown ? (
            <li className="unknown fold">
              <span className="cs-i" aria-label={CHECK_WORD.unknown}><Icon name="eye" size={13} /></span>
              <span className="cs-name">{unknownNames.length} not checked here: {unknownNames.map((x, i) => <span key={i}>{i ? ', ' : ''}{x}</span>)}</span>
              <button type="button" className="cs-all" onClick={() => setAll(true)}>Show</button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

// ---- simple / detailed ----------------------------------------------------------------------------

export type DetailMode = 'simple' | 'detailed';
const DETAIL_KEY = (k: string) => `table-detail-${k}`;

/** Simple / Detailed for one screen, remembered per screen. Simple is the default for everyone. */
export function useDetail(key: string): [DetailMode, (m: DetailMode) => void] {
  const [m, setM] = useState<DetailMode>(() => {
    try { return localStorage.getItem(DETAIL_KEY(key)) === 'detailed' ? 'detailed' : 'simple'; } catch { return 'simple'; }
  });
  const set = (v: DetailMode) => { setM(v); try { localStorage.setItem(DETAIL_KEY(key), v); } catch { /* per-viewer convenience only */ } };
  return [m, set];
}

export function DetailToggle({ value, onChange, detailedLabel = 'Detailed', className }: { value: DetailMode; onChange: (m: DetailMode) => void; detailedLabel?: string; className?: string }) {
  return (
    <div className={cx('ui-seg', 'ui-detail', className)} role="group" aria-label="How much detail">
      <button type="button" aria-pressed={value === 'simple'} onClick={() => onChange('simple')}>Simple</button>
      <button type="button" aria-pressed={value === 'detailed'} onClick={() => onChange('detailed')}>{detailedLabel}</button>
    </div>
  );
}

/** Tone of a check state as a chip tone, for pages that mix ChecksSummary with chips. */
export const checkTone = (s: CheckState): ChipTone => (s === 'pass' ? 'ok' : s === 'ask' ? 'gold' : s === 'fail' ? 'red' : 'dashed');
