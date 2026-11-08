// A setup panel in the home (a reply's `setup` show, or a panel page): the getting-started steps as one
// list; each step's button asks the home for it, and the guide (guide/) offers it in the conversation.
import { START_STEP, type StartStepKey } from '../../../lib/words';
import type { GettingStarted } from '../../../lib/firstRun';
import { StartSteps } from '../../../shared/start';
import { GREET } from './words';

/** The setup steps as one list (a setup panel): a click asks the guide for that step. */
export function SetupOverview({ gs, onJump }: { gs: GettingStarted; onJump: (k: StartStepKey) => void }) {
  return (
    <div className="fs-steps">
      <p className="fs-body">{GREET.steps}</p>
      <StartSteps gs={gs} action={(key) => ({ label: START_STEP[key].act, title: START_STEP[key].title, run: () => onJump(key) })} />
    </div>
  );
}
