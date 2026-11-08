// The shell every flow card wears: a title, "step n of m", the card's one question as children, a
// Cancel, and the folded form (one summary line) once the step is answered. The flow components
// (RulesFlow, SettingsFlow, ConnectionsFlow, RewindFlow) render their own content inside it.
import type { ReactNode } from 'react';
import { Reveal } from '../../../../design/Reveal';
import { endFlow, type FlowTurn } from './store';
import { FLOW_WORDS } from './words';

export type FlowCardProps = {
  turn: FlowTurn;
  /** The step's place in its flow, 1-based; omit for an open-ended flow (Rewind). */
  n?: number;
  of?: number;
  /** False hides Cancel (a step after the change was applied: nothing is left to cancel). */
  cancel?: boolean;
  children: ReactNode;
};

export function FlowCard({ turn, n, of, cancel = true, children }: FlowCardProps) {
  if (turn.summary !== null) {
    return <p className="fc-folded" data-flow={turn.kind} data-step={turn.step}>{turn.summary || FLOW_WORDS.left}</p>;
  }
  return (
    <Reveal>
      <section className="fc" data-flow={turn.kind} data-step={turn.step} aria-label={FLOW_WORDS.title[turn.kind]}>
        <header className="fc-head">
          <b>{FLOW_WORDS.title[turn.kind]}</b>
          {n && of ? <span className="fc-n">{FLOW_WORDS.stepOf(n, of)}</span> : null}
        </header>
        <div className="fc-body">{children}</div>
        {cancel ? <footer className="fc-foot"><button type="button" className="fc-cancel" onClick={() => endFlow(FLOW_WORDS.cancelled)}>{FLOW_WORDS.cancel}</button></footer> : null}
      </section>
    </Reveal>
  );
}
