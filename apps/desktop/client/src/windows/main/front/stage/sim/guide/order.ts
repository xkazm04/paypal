// The order the GUIDE walks the four steps in. It differs from lib/firstRun.ts START_ORDER (paypal,
// rules, practice, engine) on purpose, with evidence from the mock world:
//   signing rules needs at least one approved payee (the approval page's rules editor says "Fix 1 field
//   before signing: Approved payees: list at least one payee"), and a brand-new wallet has none until
//   the practice shop is connected (pairing_confirm pins it with declared_payee 'HOUSE'; useSayReading
//   fills "may pay" from the connected wallets). Meeting the shop first makes the rules sentence
//   signable as read. Connecting needs no rules (house_wake, pairing_join, pairing_confirm check
//   none); only a practice DEAL does, and that comes after setup.
// Progress itself still comes from useStart: this only reorders what the world says is done.
import type { GettingStarted, StartStepState } from '../../../../../../lib/firstRun';
import type { StartStepKey } from '../../../../../../lib/words';

export const GUIDE_ORDER: readonly StartStepKey[] = ['paypal', 'practice', 'rules', 'engine'];

export type GuideStep = { key: StartStepKey; n: number; state: StartStepState };

/** The steps in the guide's order: done as the world says, the first one not done is next. */
export function guideSteps(gs: GettingStarted): GuideStep[] {
  const state = (k: StartStepKey): StartStepState => gs.steps.find((s) => s.key === k)?.state ?? 'unknown';
  const next = guideNext(gs);
  return GUIDE_ORDER.map((key, i) => {
    const s = state(key);
    return { key, n: i + 1, state: s === 'done' || s === 'unknown' ? s : key === next ? 'next' : 'todo' };
  });
}

/** The first step the world does not report done, in the guide's order; null when all are done. */
export function guideNext(gs: GettingStarted): StartStepKey | null {
  return GUIDE_ORDER.find((k) => {
    const s = gs.steps.find((x) => x.key === k)?.state;
    return s === 'todo' || s === 'next';
  }) ?? null;
}

/** The step's number in the guide's order (1-based). */
export const guideN = (k: StartStepKey): number => GUIDE_ORDER.indexOf(k) + 1;
