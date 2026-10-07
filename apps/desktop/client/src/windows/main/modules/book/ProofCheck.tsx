// "Check a proof file": the owner picks a saved proof file in the wallet's own file dialog and the
// wallet checks it with the same checks as the offline checker. Only the report crosses; every
// value in it comes from the file, so it is shown as plain, shortened text and never interpreted.
import { useState } from 'react';
import type { ProofReport } from '@bindings/ProofReport';
import { useMutation } from '../../../../lib/hooks';
import { modeWord, PROOF_CHECKS, PROOF_KEY_ANCHOR, PROOF_LIMIT } from '../../../../lib/words';
import { WalletNotice } from '../../../../shared/honesty';
import { Btn, Chip, Kv, Sheet } from '../../../../shared/ui';

const clip = (s: string, n = 160): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function ProofCheckSheet({ onClose }: { onClose: () => void }) {
  const check = useMutation('proof_check');
  const [report, setReport] = useState<ProofReport | null>(null);
  const pick = async () => {
    const r = await check.run(null);
    if (r) setReport(r);
  };
  return (
    <Sheet title="Check a proof file" onClose={onClose}
      footer={<>
        <Btn className="left" disabled={check.pending} onClick={() => void pick()}>{check.pending ? 'Checking…' : report ? 'Check another file' : 'Choose a proof file'}</Btn>
        <Btn kind="primary" onClick={onClose}>Done</Btn>
      </>}>
      {check.error ? <WalletNotice error={check.error} what="Proof file" /> : null}
      {report ? (
        <>
          <p>{report.verified ? <Chip tone="ok">Every check passed</Chip> : <Chip tone="red">Some checks did not pass</Chip>}</p>
          <Kv items={[
            ['Owner key', <span className="mono">{clip(report.owner_key_id, 40)}</span>],
            ['Mode', modeWord(report.mode)],
            ['Deal', <span className="mono">{clip(report.deal_id, 40)}</span>],
          ]} />
          <p className="ui-hint">{PROOF_KEY_ANCHOR}</p>
        </>
      ) : null}
      <ul>
        {report
          ? report.checks.map((c) => (
            <li key={c.id}>
              <span aria-label={c.ok ? 'passed' : 'did not pass'}>{c.ok ? '✓' : '✗'}</span>{' '}
              {PROOF_CHECKS[c.id] ?? 'A check this wallet does not know.'}
              <div className="ui-hint mono">{clip(c.detail)}</div>
            </li>
          ))
          : Object.entries(PROOF_CHECKS).map(([id, text]) => <li key={id}>{text}</li>)}
      </ul>
      <p className="ui-hint">{PROOF_LIMIT}</p>
    </Sheet>
  );
}
