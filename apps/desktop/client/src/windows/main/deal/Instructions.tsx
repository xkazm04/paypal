// Layer 2 · the instructions an agent app run started from, word for word (the role playbook the
// wallet compiled in and wrote as the run's system prompt). Proof, not a setting: nothing here can
// be edited, and nothing the other side wrote is ever part of it.
import type { Playbook } from '@bindings/Playbook';
import { PLAYBOOKS } from '@bindings/playbooks';
import { INSTRUCTIONS_LEAD, INSTRUCTIONS_TITLE, PLAYBOOK_NAME } from '../../../lib/words';
import { Btn, Sheet } from '../../../shared/ui';

// The details row's value lives in its own file so the deal page does not carry the playbook
// texts; the sheet (and the texts) load only when the owner reads them.
export { InstructionsValue } from './InstructionsValue';

export function InstructionsSheet({ playbook, onClose }: { playbook: Playbook; onClose: () => void }) {
  return (
    <Sheet title={INSTRUCTIONS_TITLE} size="wide" onClose={onClose}
      footer={<Btn kind="primary" onClick={onClose}>Done</Btn>}>
      <p className="dv-p">{INSTRUCTIONS_LEAD}</p>
      <h3 className="dv-instr-h">{PLAYBOOK_NAME[playbook]}</h3>
      <pre className="dv-instr" aria-label={`${PLAYBOOK_NAME[playbook]}, word for word`}>{PLAYBOOKS[playbook]}</pre>
    </Sheet>
  );
}
