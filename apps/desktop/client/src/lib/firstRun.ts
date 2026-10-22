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
import type { SetupStepKey, StartStepKey } from './words';

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

type RuleWindow = { not_before: number; expires: number };
type RuleFacts = { payload: RuleWindow; owner_sig: readonly number[]; refusal?: unknown };

/** The owner signed it and the wallet has not refused it (the dates are separate). */
export const ruleSigned = (m: Pick<RuleFacts, 'owner_sig' | 'refusal'>): boolean => m.owner_sig.length > 0 && !m.refusal;
/** Whether `now` is inside a rule set's dates: from not_before, up to but not including expires. */
export const ruleInWindow = (w: RuleWindow, now: number): boolean => w.not_before <= now && now < w.expires;
/** THE meaning of "rules in force": signed by the owner, not refused, inside its dates. mandate_list
 *  also returns ended, not-yet-started, refused and unsigned sets, so every site asks this. */
export const ruleInForce = (m: RuleFacts, now: number): boolean => ruleSigned(m) && ruleInWindow(m.payload, now);

/** How many rule sets are in force now (null while mandate_list is unread). */
export function rulesInForce(list: ReadonlyArray<RuleFacts> | null | undefined, now: number): number | null {
  if (!list) return null;
  return list.filter((m) => ruleInForce(m, now)).length;
}

// ---- the Set up page (calm-nested-ui) --------------------------------------------------------------
/** The Set up page's step for a getting-started step (the page adds a fifth, unlock, after them). */
export const SETUP_STEP_OF: Record<StartStepKey, SetupStepKey> = { paypal: 'keys', rules: 'rules', practice: 'practice', engine: 'agent' };

/** A window that cannot navigate Main (the Tumbler) leaves this note for Main, which takes it once
 *  when it opens: "go to the Set up page at this step". Same-origin storage, no IPC command. */
export const SETUP_INTENT_KEY = 'table.setup-intent';
const SETUP_INTENT_TTL_MS = 15_000;

export function leaveSetupIntent(step: SetupStepKey, at: number, store: Pick<Storage, 'setItem'> = localStorage): void {
  try { store.setItem(SETUP_INTENT_KEY, JSON.stringify({ step, at })); } catch { /* no storage: Main opens on Home, whose Continue setup button leads here */ }
}

/** Reads and clears the note; a note older than a few seconds is stale and ignored. */
export function takeSetupIntent(now: number, store: Pick<Storage, 'getItem' | 'removeItem'> = localStorage): SetupStepKey | null {
  try {
    const raw = store.getItem(SETUP_INTENT_KEY);
    if (raw === null) return null;
    store.removeItem(SETUP_INTENT_KEY);
    const v = JSON.parse(raw) as { step?: unknown; at?: unknown };
    const steps: readonly unknown[] = ['keys', 'rules', 'practice', 'agent', 'unlock'];
    if (typeof v.at !== 'number' || now - v.at > SETUP_INTENT_TTL_MS || !steps.includes(v.step)) return null;
    return v.step as SetupStepKey;
  } catch {
    return null;
  }
}
