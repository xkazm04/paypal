// Home on first run: "what is this, is my money safe, what do I do first" in one look. The hub
// names the goal (a first safe deal in four steps), shows the progress, says the safety promise
// once and holds the one gold button: the next step. The left column lists the steps, each one
// click to where it happens (the approval window's keys or rules, the house seller's tab in
// Connections, Setup's agent app); the right column says what The Table is. Nothing here signs, saves or pays:
// privileged steps only open the approval window (approval_open with a target).
import { useCallback, useMemo, useState, type MouseEvent } from 'react';
import type { WalletError } from '../../../lib/contract';
import { connectionFacts, gettingStarted, rulesInForce, type GettingStarted } from '../../../lib/firstRun';
import { useMutation, useNow, useQuery } from '../../../lib/hooks';
import { FIRST_RUN_TITLE, SAFETY_PROMISE, START_STEP, type StartStepKey } from '../../../lib/words';
import { WalletNotice } from '../../../shared/honesty';
import { StartProgress, StartSteps, type StepAction } from '../../../shared/start';
import { Icon, Section, type IconName } from '../../../shared/ui';
import { LockGlyph } from '../ui';
import { useWorld } from '../world';

/** The getting-started path for this wallet, from settings, the signed rules and the connections. */
export function useStart(): GettingStarted {
  const w = useWorld();
  const now = useNow();
  const s = w.settings.data;
  const mandates = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  const cps = useQuery('counterparty_list', null, { refreshOn: ['pairing:pinned', 'settings:changed'] });
  const inForce = rulesInForce(mandates.data, now);
  const fresh = s?.first_run;
  const paypal = s?.payment_executor_configured;
  const conn = cps.data;
  // The Table can also ask whether the chosen agent app is installed and ready (engine_status).
  const engines = useQuery('engine_status', null, { refreshOn: ['settings:changed'] });
  const engine = s?.selected_engine ?? null;
  const engineAvailable = engine && engines.data ? engines.data.find((e) => e.id === engine)?.available ?? false : null;
  return useMemo(() => gettingStarted({
    firstRun: fresh ?? null, paypal: paypal ?? null, rulesInForce: inForce, ...connectionFacts(conn), engine, engineAvailable,
  }), [fresh, paypal, inForce, conn, engine, engineAvailable]);
}

export type StartActions = { go: (k: StartStepKey) => void; busy: StartStepKey | null; error: WalletError | null };

/** Each step's one click: keys and rules open the approval window there; practice opens the house
 *  seller's tab; the agent app opens Setup, where it is chosen. */
export function useStartActions(onHouse: () => void, onEngine: () => void): StartActions {
  const { run, error } = useMutation('approval_open');
  const [busy, setBusy] = useState<StartStepKey | null>(null);
  const go = useCallback((k: StartStepKey) => {
    if (k === 'practice') { onHouse(); return; }
    if (k === 'engine') { onEngine(); return; }
    setBusy(k);
    void run({ deal_id: null, target: k === 'paypal' ? 'credentials' : 'mandate' }).finally(() => setBusy(null));
  }, [run, onHouse, onEngine]);
  return { go, busy, error };
}

const stop = (e: MouseEvent) => e.stopPropagation();
/** Steps that happen here in The Table (the rest open the approval window). */
const inTable = (k: StartStepKey) => k === 'practice' || k === 'engine';

/** The hub: the goal, the progress, the promise and the next step as the only gold button. */
export function StartHub({ gs, act }: { gs: GettingStarted; act: StartActions }) {
  const w = useWorld();
  const next = gs.next;
  const opensApproval = next === 'paypal' || next === 'rules';
  return (
    <div className="hc first">
      <div className="h-eyebrow">Welcome to The Table</div>
      <div className="h-calm h-first">{FIRST_RUN_TITLE}</div>
      <StartProgress gs={gs} className="h-prog" />
      <div className="h-promise"><Icon name="shield" size={14} />{SAFETY_PROMISE}</div>
      {next ? (
        <button type="button" className="gbtn" onClick={(e) => { stop(e); act.go(next); }} disabled={act.busy !== null} title={START_STEP[next].where}>
          {opensApproval && w.locked ? <LockGlyph locked /> : null}{act.busy ? 'Opening…' : START_STEP[next].act}{opensApproval ? ' ↗' : ''}
        </button>
      ) : null}
      {act.error ? <WalletNotice error={act.error} what="Approval window" /> : null}
    </div>
  );
}

/** Left column: the steps, each one quiet click to where it happens. */
export function StartSide({ gs, act }: { gs: GettingStarted; act: StartActions }) {
  const action = (k: StartStepKey): StepAction => ({
    label: `${START_STEP[k].act}${inTable(k) ? ' ›' : ' ↗'}`,
    title: START_STEP[k].where,
    run: () => act.go(k),
  });
  return (
    <Section title="Getting started" end={<span className="dim">{gs.done} of {gs.total}</span>}>
      <StartSteps gs={gs} action={action} busy={act.busy} />
    </Section>
  );
}

const ABOUT: ReadonlyArray<{ icon: IconName; title: string; text: string }> = [
  { icon: 'agent', title: 'Your agents do the legwork', text: 'They shop, haggle and sell for you.' },
  { icon: 'rules', title: 'Inside rules you sign', text: 'How much, with whom, and when they must ask you.' },
  { icon: 'you', title: 'You approve in one place', text: 'A separate approval window, locked when you step away.' },
];

/** Right column: what The Table is, in three lines. */
export function StartAbout() {
  return (
    <Section title="What The Table does">
      <ol className="start-about">
        {ABOUT.map((a) => (
          <li key={a.title}><span className="sa-ico" aria-hidden="true"><Icon name={a.icon} size={16} /></span><b>{a.title}</b><span>{a.text}</span></li>
        ))}
      </ol>
    </Section>
  );
}
