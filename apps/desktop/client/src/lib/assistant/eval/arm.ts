// One arm of the view-choice evaluation: every case asked through an engine, every outcome scored.
// The engine is injected (`ask`), so the scripted arm (scripted.eval.test.ts) and the live arm
// (scripts/evalBoard.ts) run the same loop, the same door and the same scorer. Never throws for an
// engine failure: a rejected or thrown ask is recorded as an outcome with the error word 'threw'.
import type { DigestInput } from '../contract';
import { boardOf, type EvalCase } from './cases';
import { aggregate, scoreCase, type Aggregate, type CaseScore, type Outcome } from './score';

export type Ask = (question: string, digest: DigestInput, c: EvalCase) => Promise<Outcome>;
export type ArmResult = { outcomes: Outcome[]; scores: CaseScore[]; aggregate: Aggregate };
export type ArmOptions = { concurrency?: number; onCase?: (c: EvalCase, score: CaseScore, done: number) => void };

export async function runArm(cases: readonly EvalCase[], ask: Ask, opts: ArmOptions = {}): Promise<ArmResult> {
  const outcomes: Outcome[] = new Array(cases.length);
  const scores: CaseScore[] = new Array(cases.length);
  const width = Math.max(1, Math.min(Math.trunc(opts.concurrency ?? 1), cases.length || 1));
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < cases.length) {
      const i = next++;
      const c = cases[i] as EvalCase;
      const digest = boardOf(c);
      let outcome: Outcome;
      try {
        outcome = await ask(c.question, digest, c);
      } catch {
        outcome = { ok: false, error: 'threw' };
      }
      outcomes[i] = outcome;
      const score = scoreCase(c, outcome, { dealIds: new Set(digest.deals.map((d) => d.id)) });
      scores[i] = score;
      done++;
      opts.onCase?.(c, score, done);
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  return { outcomes, scores, aggregate: aggregate(cases, scores) };
}
