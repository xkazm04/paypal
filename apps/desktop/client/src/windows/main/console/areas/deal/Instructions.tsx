// One level down from the deal's details: the instructions an agent app run started from, word for
// word (the role playbook the wallet compiled in and wrote as the run's system prompt). Proof, not
// a setting: nothing here can be edited, and nothing the other side wrote is ever part of it. Moved
// from deal/Instructions.tsx by rebuild WP3c; its own chunk, so the playbook texts load only when read.
import type { Playbook } from '@bindings/Playbook';
import { PLAYBOOKS } from '@bindings/playbooks';
import { DEAL_INSTRUCTIONS, DEAL_PROOF, INSTRUCTIONS_LEAD, INSTRUCTIONS_TITLE, PLAYBOOK_NAME } from '../../../../../lib/words';
import { Btn, Sheet } from '../../../../../shared/ui';

export function InstructionsSheet({ playbook, onClose }: { playbook: Playbook; onClose: () => void }) {
  return (
    <Sheet title={INSTRUCTIONS_TITLE} size="wide" onClose={onClose} className="ar-deal-sheet"
      footer={<Btn kind="primary" onClick={onClose}>{DEAL_PROOF.done}</Btn>}>
      <p className="dv-p">{INSTRUCTIONS_LEAD}</p>
      <h3 className="dv-instr-h">{PLAYBOOK_NAME[playbook]}</h3>
      <pre className="dv-instr" aria-label={DEAL_INSTRUCTIONS.wordForWord(PLAYBOOK_NAME[playbook])}>{PLAYBOOKS[playbook]}</pre>
    </Sheet>
  );
}
