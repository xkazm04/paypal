// First run: from install to a first safe deal in three steps, the same on every surface (Home,
// the Settings sheet, the Tumbler's welcome, the approval window's owner configuration).
//   1 Connect PayPal sandbox      done when the sandbox keys are saved (settings.payment_executor_configured)
//   2 Sign your agents' rules     done when a signed set of rules is in force (mandate_list; first_run
//                                 false when only settings were read)
//   3 Practice with the house     done when the house seller is connected (counterparty_list house:
//                                 true), which is when its practice table is yours to join
// Pure: facts in, steps out. A fact a window cannot read stays unknown and is never shown as done.
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
};

/** done · next (the one step the gold button goes to) · todo · unknown (this window cannot tell). */
export type StartStepState = 'done' | 'next' | 'todo' | 'unknown';
export type StartStep = { key: StartStepKey; n: 1 | 2 | 3; state: StartStepState };
export type GettingStarted = {
  /** Show the getting-started path instead of the everyday view. */
  show: boolean;
  steps: StartStep[];
  done: number;
  total: 3;
  /** The first step still to do (gold); null when every step is done or unknown. */
  next: StartStepKey | null;
};

export const START_ORDER: readonly StartStepKey[] = ['paypal', 'rules', 'practice'];

const known = (b: boolean | null): StartStepState => (b === null ? 'unknown' : b ? 'done' : 'todo');

export function gettingStarted(f: StartFacts): GettingStarted {
  const rules = f.rulesInForce !== null ? f.rulesInForce > 0 : f.firstRun === null ? null : !f.firstRun;
  const raw: Record<StartStepKey, StartStepState> = { paypal: known(f.paypal), rules: known(rules), practice: known(f.houseConnected) };
  const next = START_ORDER.find((k) => raw[k] === 'todo') ?? null;
  const steps = START_ORDER.map((key, i) => ({ key, n: (i + 1) as 1 | 2 | 3, state: key === next ? 'next' as const : raw[key] }));
  const done = steps.filter((s) => s.state === 'done').length;
  // A brand-new wallet (no rules yet) always shows the path. After the rules are signed it stays
  // until the three steps are done, but only while the owner has connected nobody else: an owner
  // already dealing with other wallets is past getting started, whatever is left.
  const show = f.firstRun === true || (f.firstRun === false && done < 3 && f.otherConnections === 0);
  return { show, steps, done, total: 3, next };
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
