// Home on first run: "what is this, is my money safe, what do I do first" in one look. The hub
// names the goal (a first safe deal in four steps), shows the progress, says the safety promise
// once and holds the one gold button: the next step. The left column lists the steps, each one
// click to where it happens (the Set up page, one step at a time); the right column says what The
// Table is. Nothing here signs, saves or pays: the Set up page hands privileged steps to the approval window.
import { useEffect, useCallback, useMemo, type MouseEvent } from 'react';
import type { WalletError } from '../../../lib/contract';
import { connectionFacts, gettingStarted, rulesInForce, settingsFacts, SETUP_STEP_OF, takeSetupIntent, type GettingStarted } from '../../../lib/firstRun';
import { useEvent, useNow, useQuery } from '../../../lib/hooks';
import { FIRST_RUN_TITLE, SAFETY_PROMISE, SETUP_CONTINUE, SETUP_CONTINUE_LINE, START_STEP, START_UNDERWAY, type SetupStepKey, type StartStepKey } from '../../../lib/words';
import { StartProgress, StartSteps, type StepAction } from '../../../shared/start';
import { TakeTour } from '../../../shared/tour';
import { Icon, Section, type IconName } from '../../../shared/ui';
import { useWorld } from '../world';

/** The getting-started path for this wallet, from settings, the signed rules and the connections. */
export function useStart(): GettingStarted {
  const w = useWorld();
  const now = useNow();
  const s = w.settings.data;
  const mandates = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  const cps = useQuery('counterparty_list', null, { refreshOn: ['pairing:pinned', 'settings:changed'] });
  const inForce = rulesInForce(mandates.data, now);
  const conn = cps.data;
  // The Table can also ask whether the chosen agent app is installed and ready (engine_status).
  const engines = useQuery('engine_status', null, { refreshOn: ['settings:changed'] });
  const engine = s?.selected_engine ?? null;
  const engineAvailable = engine && engines.data ? engines.data.find((e) => e.id === engine)?.available ?? false : null;
  return useMemo(() => gettingStarted({
    ...settingsFacts(s), rulesInForce: inForce, ...connectionFacts(conn), engineAvailable,
  }), [s, inForce, conn, engineAvailable]);
}

export type StartActions = { go: (k: StartStepKey) => void; busy: StartStepKey | null; error: WalletError | null };

/** Where the Set up page lives (App.tsx follows the hash). */
export const setupHash = (step?: SetupStepKey): string => `#s=setup&step=${step ?? 'keys'}`;

/** Each step's one click goes to the Set up page at that step; the privileged part (keys, rules,
 *  unlock) opens the approval window from there. Also takes the note the Tumbler leaves when its
 *  welcome buttons open The Table, and moves on to the page it names. `onHouse` and `onEngine` are
 *  kept for Home's signature: those steps now happen on the Set up page too. */
export function useStartActions(_onHouse?: () => void, _onEngine?: () => void): StartActions {
  const go = useCallback((k: StartStepKey) => { location.hash = setupHash(SETUP_STEP_OF[k]); }, []);
  const take = useCallback(() => {
    // Let the route event settle on Home first, then follow the note.
    setTimeout(() => { const step = takeSetupIntent(Date.now()); if (step) location.hash = setupHash(step); }, 250);
  }, []);
  useEffect(take, [take]);
  useEvent('main:route', take);
  useEffect(() => {
    window.addEventListener('storage', take);
    return () => window.removeEventListener('storage', take);
  }, [take]);
  return useMemo(() => ({ go, busy: null, error: null }), [go]);
}

const stop = (e: MouseEvent) => e.stopPropagation();
/** The hub: the goal, the progress, the promise and the next step as the only gold button. */
export function StartHub({ gs, act }: { gs: GettingStarted; act: StartActions }) {
  const next = gs.next;
  return (
    <div className="hc first" data-tour="start-hub">
      <div className="h-eyebrow">Welcome to The Table</div>
      <div className="h-calm h-first">{FIRST_RUN_TITLE}</div>
      <StartProgress gs={gs} className="h-prog" />
      <div className="h-promise" data-tour="safety-promise"><Icon name="shield" size={14} />{SAFETY_PROMISE}</div>
      <button type="button" className="gbtn" onClick={(e) => { stop(e); act.go(next ?? 'paypal'); }} title={SETUP_CONTINUE_LINE}>
        {SETUP_CONTINUE}
      </button>
      <TakeTour win="main" gs={gs} className="h-tour" />
    </div>
  );
}

/** Left column: the steps, each one quiet click to where it happens. */
export type UnderwayDeal = { id: string; label: string; title: string };

export function StartSide({ gs, act, underway = [], onDeal }: { gs: GettingStarted; act: StartActions; underway?: UnderwayDeal[]; onDeal?: (id: string) => void }) {
  const action = (k: StartStepKey): StepAction => ({
    label: `${START_STEP[k].act} ›`,
    title: START_STEP[k].where,
    run: () => act.go(k),
  });
  return (
    <>
      {underway.length && onDeal ? (
        <Section title={START_UNDERWAY.title}>
          <ul className="start-steps" aria-label={START_UNDERWAY.title}>
            {underway.map((d) => (
              <li key={d.id} className="ss s-next">
                <button type="button" className="ss-go" onClick={() => onDeal(d.id)} title={START_UNDERWAY.where}>
                  <span className="ss-mark" aria-hidden="true"><Icon name="store" size={13} /></span>
                  <span className="ss-text"><b>{d.label}</b><span>{d.title}</span></span>
                  <span className="ss-act">{START_UNDERWAY.act}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title="Getting started" end={<span className="dim">{gs.done} of {gs.total}</span>}>
        <StartSteps gs={gs} action={action} busy={act.busy} />
      </Section>
    </>
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
