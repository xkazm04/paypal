// The deal page's "Proof from PayPal" view (rebuild WP3c): the proof panel and its sheets. Its own
// chunk; it reads the deal's PayPal proof and the market-watch facts when it opens (scale finding
// #17: never for every view on the page's open). A statement check's fresh answer goes back to the
// page so the milestones and the answer follow it.
import { Suspense, useState } from 'react';
import type { Deal } from '@bindings/Deal';
import type { DealEvidence } from '@bindings/DealEvidence';
import type { DisplayBand } from '@bindings/DisplayBand';
import { useQuery } from '../../../../../lib/hooks';
import { dealWatch } from '../../../../../lib/marketWatch';
import { EvidenceSheet, ProofPanel, type EvidenceKind, type SignedCard } from './Evidence';

export function ProofView({ deal, band, fresh, onFresh, signed }: { deal: Deal; band: DisplayBand | null; fresh: DealEvidence | null; onFresh: (e: DealEvidence) => void; signed?: SignedCard | null }) {
  const evq = useQuery('deal_evidence', { deal_id: deal.id }, { refreshOn: ['deal:changed', 'receipt:created'] });
  // Whether a signed rule keeps this item's typical price fresh (owner facts; unknown = not shown).
  const ownerFacts = useQuery('owner_facts', null, { refreshOn: ['settings:changed', 'deal:changed'] });
  const watch = dealWatch(ownerFacts.data?.market_watch, deal);
  const [sheet, setSheet] = useState<EvidenceKind | null>(null);
  const ev = { data: fresh ?? evq.data, error: evq.error };
  return (
    <>
      <ProofPanel deal={deal} ev={ev} band={band} watch={watch} onOpen={setSheet} signed={signed} />
      {sheet ? (
        <Suspense fallback={null}>
          <EvidenceSheet kind={sheet} deal={deal} ev={ev} band={band} watch={watch} onFresh={onFresh} onClose={() => setSheet(null)} />
        </Suspense>
      ) : null}
    </>
  );
}
