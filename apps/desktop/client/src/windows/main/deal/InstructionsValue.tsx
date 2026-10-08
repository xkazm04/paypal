// The deal page's details row for an agent app run's instructions: the playbook's name and a way
// to read it word for word (Instructions.tsx, loaded on demand), or why there is none.
import type { RunSnapshot } from '@bindings/RunSnapshot';
import { INSTRUCTIONS_NONE, PLAYBOOK_NAME } from '../../../lib/words';
import { Btn } from '../../../shared/ui';

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
