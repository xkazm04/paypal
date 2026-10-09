// First run: from install to a first safe deal in four steps, the same on every surface (Home,
// the Settings sheet, the Tumbler's welcome, the approval window's owner configuration).
//   1 Add your PayPal keys        done when the sandbox keys are saved, not checked (settings.payment_executor_configured)
//   2 Sign your agents' rules     done when a signed set of rules is in force (mandate_list; first_run
//                                 false when only settings were read)
//   3 Practice with the house     done when the house seller is connected (counterparty_list house:
//                                 true), which is when its practice table is yours to join
//                                 A done step 3 keeps one quiet click that starts a practice deal (START_STEP.practice.doneAct).
//   4 Choose your agent app       done when settings.selected_engine is claude-code or codex-cli, or when it
//                                 is 'scripted' and settings.engine_chosen is true (the owner kept the
//                                 practice agent on purpose). The 'scripted' a new wallet starts on, with
//                                 engine_chosen false, never counts.
//                                 Main also reads engine_status: an app it reports unavailable is not done.
// The practice deal runs on the practice agent, so the agent app comes last: it is the one step that
// needs something installed outside the wallet, and nothing before it waits on it.
// Pure: facts in, steps out. A fact a window cannot read stays unknown and is never shown as done.
// Every window (Home, the Tumbler, the approval window) maps the settings facts through
// settingsFacts, so none can drop one (engine_chosen included) and the steps agree everywhere.
import type { EngineId } from '@bindings/EngineId';
import type { SettingsSnapshot } from '@bindings/SettingsSnapshot';
import type { StartStepKey } from './words';

export type StartFacts = {
  /** settings.first_run; null = settings not read. */
  firstRun: boolean | null;
  /** settings.payment_executor_configured: the PayPal sandbox keys are saved. */
  paypal: boolean | null;
  /** Signed rules in force now; null = mandate_list not readable here or not read yet. */
  rulesInForce: number | null;
  /** counterparty_list has the house seller; null = not readable here or not read yet. */
  houseConnected: boolean | null;
  /** Wallets other than the house seller that are connected; null = not known. */
  otherConnections: number | null;
  /** settings.selected_engine; null = settings not read. */
  engine: EngineId | null;
  /** engine_status says the selected app is available (main only); null or absent = not read here. */
  engineAvailable?: boolean | null;
  /** settings.engine_chosen: the owner chose an agent app, the practice agent included; null or absent = not read. */
  engineChosen?: boolean | null;
};

/** done · next (the one step the gold button goes to) · todo · unknown (this window cannot tell). */
export type StartStepState = 'done' | 'next' | 'todo' | 'unknown';
export type StartStep = { key: StartStepKey; n: number; state: StartStepState };
export type GettingStarted = {
  /** Show the getting-started path instead of the everyday view. */
  show: boolean;
  steps: StartStep[];
  done: number;
  /** START_ORDER's length. */
  total: number;
  /** The first step still to do (gold); null when every step is done or unknown. */
  next: StartStepKey | null;
};

export const START_ORDER: readonly StartStepKey[] = ['paypal', 'rules', 'practice', 'engine'];

const known = (b: boolean | null): StartStepState => (b === null ? 'unknown' : b ? 'done' : 'todo');

/** The agent app step: an app chosen (not the practice agent) and not reported unavailable. */
export function engineChosen(engine: EngineId | null, available?: boolean | null, chosen?: boolean | null): boolean | null {
  if (engine === null) return null;
  if (engine === 'scripted') return chosen === true;
  return available !== false;
}

export function gettingStarted(f: StartFacts): GettingStarted {
  const rules = f.rulesInForce !== null ? f.rulesInForce > 0 : f.firstRun === null ? null : !f.firstRun;
  const raw: Record<StartStepKey, StartStepState> = {
    paypal: known(f.paypal), rules: known(rules), practice: known(f.houseConnected), engine: known(engineChosen(f.engine, f.engineAvailable, f.engineChosen)),
  };
  const next = START_ORDER.find((k) => raw[k] === 'todo') ?? null;
  const steps = START_ORDER.map((key, i) => ({ key, n: i + 1, state: key === next ? 'next' as const : raw[key] }));
  const done = steps.filter((s) => s.state === 'done').length;
  const total = START_ORDER.length;
  // A brand-new wallet (no rules yet) always shows the path. After the rules are signed it stays
  // until every step is done, but only while the owner has connected nobody else: an owner
  // already dealing with other wallets is past getting started, whatever is left.
  const show = f.firstRun === true || (f.firstRun === false && done < total && f.otherConnections === 0);
  return { show, steps, done, total, next };
}

/** The settings facts the steps read, mapped in one place so no window can drop one (null = settings not read). */
export function settingsFacts(st: SettingsSnapshot | null | undefined): Pick<StartFacts, 'firstRun' | 'paypal' | 'engine' | 'engineChosen'> {
  if (!st) return { firstRun: null, paypal: null, engine: null, engineChosen: null };
  return { firstRun: st.first_run, paypal: st.payment_executor_configured, engine: st.selected_engine, engineChosen: st.engine_chosen };
}

/** The slice of counterparty_list the steps read. */
export function connectionFacts(list: ReadonlyArray<{ house: boolean }> | null | undefined): Pick<StartFacts, 'houseConnected' | 'otherConnections'> {
  if (!list) return { houseConnected: null, otherConnections: null };
  return { houseConnected: list.some((c) => c.house), otherConnections: list.filter((c) => !c.house).length };
}

/** Signed rules in force now (mandate_list returns the active row of each set). */
export function rulesInForce(list: ReadonlyArray<{ payload: { not_before: number; expires: number }; refusal?: unknown }> | null | undefined, now: number): number | null {
  if (!list) return null;
  return list.filter((m) => m.payload.not_before <= now && now < m.payload.expires && !m.refusal).length;
}
