// "Check a proof file" as a view of the Book (rebuild WP3b; it was a sheet over the page). In the wallet
// the owner picks a saved proof file in the wallet's own file dialog and the wallet checks it with the
// same checks as the offline checker (proof_check, read-only). Only the report crosses; every value in
// it comes from the file and is shown as plain text (modules/book/ProofCheck.tsx ProofReportView).
// In the browser preview there is no wallet to read a file, so the view is the checker itself, run in
// the page on the practice deal's signed file or on a file dropped on it (shared/proofcheck).
import { lazy, Suspense, useState } from 'react';
import type { ProofReport } from '@bindings/ProofReport';
import { useMutation, useQuery } from '../../../../../lib/hooks';
import { backend } from '../../../../../lib/runtime';
import { BOOK, PROOF_CHECKS, PROOF_LIMIT } from '../../../../../lib/words';
import { WalletNotice } from '../../../../../shared/honesty';
import { Btn, Loading } from '../../../../../shared/ui';
import { ProofReportView } from '../../../modules/book/ProofCheck';

const BrowserChecker = lazy(() => import('../../../../../shared/proofcheck/SampleChecker').then((m) => ({ default: m.SampleChecker })));

export function Proof() {
  if (backend().kind === 'mock') {
    return (
      <div className="bk-proof">
        <Suspense fallback={<Loading what={BOOK.proof.what} />}><BrowserChecker /></Suspense>
      </div>
    );
  }
  return <WalletProof />;
}

function WalletProof() {
  const check = useMutation('proof_check');
  // This wallet's own owner key, to say whether the file names it (a public id, never a secret).
  const own = useQuery('owner_facts', null).data?.owner_key_id ?? null;
  const [report, setReport] = useState<ProofReport | null>(null);
  const pick = async () => {
    const r = await check.run(null);
    if (r) setReport(r);
  };
  return (
    <div className="bk-proof">
      <div className="cs-acts">
        <Btn kind="primary" disabled={check.pending} onClick={() => void pick()}>{check.pending ? BOOK.proof.checking : report ? BOOK.proof.another : BOOK.proof.choose}</Btn>
      </div>
      {check.error ? <WalletNotice error={check.error} what={BOOK.proof.what} /> : null}
      {report ? <ProofReportView report={report} own={own} /> : (
        <>
          <p className="bk-h3">{BOOK.proof.checks}</p>
          <ul className="bk-proofchecks">{Object.entries(PROOF_CHECKS).map(([id, text]) => <li key={id}>{text}</li>)}</ul>
        </>
      )}
      <p className="ui-hint">{PROOF_LIMIT}</p>
    </div>
  );
}
