// "Check a proof" (#p=proof): the proof checker (src/proof/ProofPage) hosted as a place of the console.
// It reads one file in the page and sends nothing anywhere; no command it reaches moves money.
import { ProofPage } from '../../../../../proof/ProofPage';
import type { LayerProps } from '../../layers';

export function ProofLayer(_: LayerProps) {
  return <ProofPage host="console" />;
}
