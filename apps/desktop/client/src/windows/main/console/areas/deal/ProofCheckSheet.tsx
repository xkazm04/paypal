// "Check this proof" on the deal page (browser preview): the practice deal's real signed file, checked
// in the page and open to being broken. Its own chunk: the checker, the file and the sheet load when the
// owner opens it, never with the deal page.
import { DEAL_PROOF, PROOF_CHECKER } from '../../../../../lib/words';
import { SampleChecker } from '../../../../../shared/proofcheck/SampleChecker';
import { Btn, Sheet } from '../../../../../shared/ui';

export function ProofCheckSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title={PROOF_CHECKER.title} size="wide" onClose={onClose} className="ar-deal-sheet pk-sheet" footer={<Btn onClick={onClose}>{DEAL_PROOF.done}</Btn>}>
      <SampleChecker />
    </Sheet>
  );
}
