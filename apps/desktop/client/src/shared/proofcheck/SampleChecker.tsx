// The proof checker with the practice deal's file loaded on demand: for the places that show it
// inside the wallet's own pages (the deal page's sheet, the Book), where the file's chunk should
// load only when the person opens the checker.
import { useEffect, useState } from 'react';
import { AUTHORITY_MANIFEST } from '@bindings/authority';
import { PROOF_CHECKER } from '../../lib/words';
import { Loading } from '../ui';
import { ProofChecker, type ProofSource } from './ProofChecker';

export function SampleChecker({ heading = false }: { heading?: boolean }) {
  const [samples, setSamples] = useState<readonly ProofSource[] | null>(null);
  useEffect(() => {
    let live = true;
    void import('../../lib/proof/sample').then((m) => { if (live) setSamples(m.SAMPLES); });
    return () => { live = false; };
  }, []);
  const first = samples?.[0];
  if (!samples || !first) return <Loading what={PROOF_CHECKER.title} />;
  return <ProofChecker source={first} samples={samples} own={AUTHORITY_MANIFEST} heading={heading} />;
}
