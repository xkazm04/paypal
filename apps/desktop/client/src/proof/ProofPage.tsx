import { AUTHORITY_MANIFEST } from '@bindings/authority';
import { SAMPLE_PROOF } from '../lib/proof/sample';
import { PROOF_CHECKER } from '../lib/words';
import { ProofChecker } from '../shared/proofcheck/ProofChecker';

export function ProofPage() {
  return (
    <main className="pf-page">
      <header className="pf-head">
        <p className="kicker">{PROOF_CHECKER.page.back}</p>
        <h1 className="display">{PROOF_CHECKER.page.title}</h1>
        <p className="pf-lede">{PROOF_CHECKER.page.lede}</p>
      </header>
      <ProofChecker source={{ ...SAMPLE_PROOF }} sample={{ ...SAMPLE_PROOF }} own={AUTHORITY_MANIFEST} heading={false} lede={false} />
    </main>
  );
}
