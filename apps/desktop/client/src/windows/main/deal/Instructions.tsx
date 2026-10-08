// Layer 2 · the instructions an agent app run started from, word for word (the role playbook the
// wallet compiled in and wrote as the run's system prompt). Proof, not a setting: nothing here can
// be edited, and nothing the other side wrote is ever part of it.
import type { Playbook } from '@bindings/Playbook';
import type { RunSnapshot } from '@bindings/RunSnapshot';
import { PLAYBOOKS } from '@bindings/playbooks';
import { INSTRUCTIONS_LEAD, INSTRUCTIONS_NONE, INSTRUCTIONS_TITLE, PLAYBOOK_NAME } from '../../../lib/words';
import { Btn, Sheet } from '../../../shared/ui';

/** The details row's value: the playbook's name and a way to read it, or why there is none. */
export function InstructionsValue({ run, onOpen }: { run: Pick<RunSnapshot, 'playbook'>; onOpen: () => void }) {
  const playbook = run.playbook ?? null;
  if (!playbook) return <span className="dim">{INSTRUCTIONS_NONE}</span>;
  return (
    <span className="dv-instr-v">
      {PLAYBOOK_NAME[playbook]}{' '}
      <Btn sm kind="plain" onClick={onOpen} title="Read the instructions word for word">Read</Btn>
    </span>
  );
}

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
