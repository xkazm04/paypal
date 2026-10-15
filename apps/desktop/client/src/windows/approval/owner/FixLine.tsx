// The editor's "This can't be signed yet" line, with the fix for it: the problem in words, then
// "Fix: …" (and "Fix all" when there are several). Every fix comes from owner/repair.ts, verified
// against the same check before it is offered. A fix only changes the draft; nothing is signed.
import { ruleNameOf } from '../../../lib/words';
import { Btn } from '../../../shared/ui';
import type { MandateDraft, RuleProblem } from '../mandateDraft';
import { applyAll, type Repair } from './repair';

type Props = {
  draft: MandateDraft;
  /** The editor's clock, for the blank rules a fix adds (a price range's default end). */
  now: number;
  problems: readonly RuleProblem[];
  repairs: readonly Repair[];
  onApply: (d: MandateDraft) => void;
};

export function FixLine({ draft, now, problems, repairs, onApply }: Props) {
  const first = repairs[0];
  // The line names the problem its fix removes, so the words and the button go together.
  const shown = first?.fixes ?? problems[0];
  if (!shown) return null;
  const text = `This can’t be signed yet: ${ruleNameOf(shown.clause).toLowerCase()} · ${shown.why}`;
  return (
    <span className="ow-fix">
      <span className="gold why" title={problems.length > 1 ? `${text} (and ${problems.length - 1} more)` : text}>{text}</span>
      {first ? <Btn sm onClick={() => onApply(first.apply(draft))}>Fix: {first.label}</Btn> : null}
      {repairs.length > 1 ? <Btn sm kind="plain" onClick={() => onApply(applyAll(draft, now))}>Fix all</Btn> : null}
    </span>
  );
}
