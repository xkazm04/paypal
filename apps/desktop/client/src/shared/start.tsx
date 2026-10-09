// The first-run steps as one list, the same in The Table and the approval window: a marker
// (number, a check when done, dashed when this window can't tell), the step in plain words and,
// while it is still to do, one quiet click to where it happens (a done practice step keeps one:
// starting a practice deal). The gold action stays outside the
// list (the hub's or the answer bar's button), so a view never has two gold buttons.
import type { GettingStarted, StartStep } from '../lib/firstRun';
import { START_STEP, type StartStepKey } from '../lib/words';
import { Icon } from './ui';
import './start.css';

/** What a step's click does here; null = it happens in another window (the reason in `elsewhere`). */
export type StepAction = { label: string; title: string; run: () => void } | null;

export function StartSteps({ gs, action, elsewhere, busy, className }: {
  gs: GettingStarted;
  action: (key: StartStepKey) => StepAction;
  /** Shown instead of a button when a step happens in another window ("in The Table"). */
  elsewhere?: Partial<Record<StartStepKey, string>>;
  busy?: StartStepKey | null;
  className?: string;
}) {
  return (
    <ol className={`start-steps${className ? ` ${className}` : ''}`} aria-label={`Getting started: ${gs.done} of ${gs.total} done`} data-tour="start-steps">
      {gs.steps.map((s) => <StepItem key={s.key} s={s} act={s.state !== 'done' || START_STEP[s.key].doneAct ? action(s.key) : null} elsewhere={elsewhere?.[s.key]} busy={busy === s.key} />)}
    </ol>
  );
}

function StepItem({ s, act, elsewhere, busy }: { s: StartStep; act: StepAction; elsewhere?: string; busy: boolean }) {
  const w = START_STEP[s.key];
  const done = s.state === 'done';
  const body = (
    <>
      <span className="ss-mark" aria-hidden="true">{done ? <Icon name="check" size={13} /> : s.n}</span>
      <span className="ss-text">
        <b>{done ? w.done : w.title}</b>
        <span>{done ? w.doneLine : s.state === 'unknown' ? 'not checked from here' : w.sub}</span>
      </span>
    </>
  );
  const state = done ? 'done' : s.state === 'next' ? 'next' : s.state === 'unknown' ? 'not checked' : 'to do';
  return (
    <li className={`ss s-${s.state}`} aria-label={`Step ${s.n}: ${w.title}, ${state}`} data-tour={`step-${s.key}`}>
      {act ? (
        <button type="button" className="ss-go" onClick={act.run} disabled={busy} title={act.title}>
          {body}
          <span className="ss-act">{busy ? 'Opening…' : done && w.doneAct ? w.doneAct : act.label}</span>
        </button>
      ) : (
        <div className="ss-go static">
          {body}
          {elsewhere && (!done || w.doneAct) ? <span className="ss-act dim">{elsewhere}</span> : null}
        </div>
      )}
    </li>
  );
}

/** "● ● ○ ○  2 of 4 done": progress as dots and words, for the hub and the answer bars. */
export function StartProgress({ gs, className }: { gs: GettingStarted; className?: string }) {
  return (
    <span className={`start-progress${className ? ` ${className}` : ''}`} role="img" aria-label={`${gs.done} of ${gs.total} steps done`}>
      {gs.steps.map((s) => <i key={s.key} className={s.state === 'done' ? 'on' : s.state === 'next' ? 'next' : ''} />)}
      <span>{gs.done} of {gs.total} done</span>
    </span>
  );
}
