import type { ReactNode } from 'react';
import { STEPPER_DONE, STEPPER_LABEL } from '../../lib/words';

export type StepperStep<K extends string = string> = { key: K; label: ReactNode; hint?: ReactNode };
/**
 * An ordered step bar. A step before `current`, or listed in `done`, reads as done; `current` carries
 * aria-current="step". With `onSelect`, steps that are done or current are buttons.
 */
export function Stepper<K extends string>({ steps, current, done, onSelect, label = STEPPER_LABEL }: {
  steps: readonly StepperStep<K>[]; current: K; done?: readonly K[]; onSelect?: (key: K) => void; label?: string;
}) {
  const at = steps.findIndex((s) => s.key === current);
  return (
    <ol className="ui-stepper" aria-label={label}>
      {steps.map((s, i) => {
        const isDone = done ? done.includes(s.key) : i < at;
        const isCurrent = i === at;
        const state = isCurrent ? 'current' : isDone ? 'done' : 'upcoming';
        const body = (
          <>
            <span className="st-dot" aria-hidden="true">{isDone && !isCurrent ? '✓' : i + 1}</span>
            <span className="st-label">{s.label}{s.hint ? <small>{s.hint}</small> : null}</span>
            {isDone && !isCurrent ? <span className="sr-only">{STEPPER_DONE}</span> : null}
          </>
        );
        return (
          <li key={s.key} className={`st ${state}`} aria-current={isCurrent ? 'step' : undefined}>
            {onSelect && (isDone || isCurrent) ? <button type="button" className="st-btn" onClick={() => onSelect(s.key)}>{body}</button> : <span className="st-btn">{body}</span>}
          </li>
        );
      })}
    </ol>
  );
}
