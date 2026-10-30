import { AUTHORITY_MANIFEST } from '@bindings/authority';
import { SAMPLES } from '../lib/proof/sample';
import { TAMPERS, type TamperId } from '../lib/proof/tamper';
import { PROOF_CHECKER } from '../lib/words';
import { ProofChecker } from '../shared/proofcheck/ProofChecker';

/** Links made for showing it: `?check=1` checks on arrival, `?break=price` then breaks it that way,
 *  `?edit=1` opens on the file's text. */
function arrival(search: string): { autoRun: boolean; autoTamper: TamperId | null; startEditing: boolean } {
  const q = new URLSearchParams(search);
  const way = q.get('break');
  const autoTamper = TAMPERS.find((t) => t.id === way)?.id ?? null;
  return { autoRun: q.get('check') === '1' || autoTamper !== null, autoTamper, startEditing: q.get('edit') === '1' };
}

export function ProofPage() {
  return (
    <main className="pf-page">
      <header className="pf-head">
        <p className="kicker">{PROOF_CHECKER.page.back}</p>
        <h1 className="display">{PROOF_CHECKER.page.title}</h1>
        <p className="pf-lede">{PROOF_CHECKER.page.lede}</p>
      </header>
      <ProofChecker source={{ ...SAMPLES[0]! }} samples={SAMPLES} own={AUTHORITY_MANIFEST} heading={false} lede={false} level={2} {...arrival(location.search)} />
    </main>
  );
}
