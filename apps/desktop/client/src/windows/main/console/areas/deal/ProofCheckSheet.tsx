// "Check this proof" on the deal page (browser preview): the practice deal's real signed file, checked
// in the page and open to being broken. Its own chunk: the checker, the file and the sheet load when the
// owner opens it, never with the deal page.
import { useEffect, useState } from 'react';
import { AUTHORITY_MANIFEST } from '@bindings/authority';
import { PROOF_CHECKER } from '../../../../../lib/words';
import { DEAL_PROOF } from '../../../../../lib/words';
import type { ProofSource } from '../../../../../shared/proofcheck/ProofChecker';
import { ProofChecker } from '../../../../../shared/proofcheck/ProofChecker';
import { Btn, Loading, Sheet } from '../../../../../shared/ui';

export function ProofCheckSheet({ onClose }: { onClose: () => void }) {
  const [source, setSource] = useState<ProofSource | null>(null);
  useEffect(() => {
    let live = true;
    void import('../../../../../lib/proof/sample').then((m) => { if (live) setSource({ ...m.SAMPLE_PROOF }); });
    return () => { live = false; };
  }, []);
  return (
    <Sheet title={PROOF_CHECKER.title} size="wide" onClose={onClose} className="ar-deal-sheet pk-sheet" footer={<Btn onClick={onClose}>{DEAL_PROOF.done}</Btn>}>
      {source ? <ProofChecker source={source} own={AUTHORITY_MANIFEST} heading={false} /> : <Loading what={PROOF_CHECKER.title} />}
    </Sheet>
  );
}
