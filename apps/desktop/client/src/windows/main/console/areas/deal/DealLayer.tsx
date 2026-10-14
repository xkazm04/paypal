// The deal layer's body (rebuild WP3c): finds the deal the route names (an id or its label, as old
// links have it), then draws its page; while the deals load a calm line, and when the deal is not
// there any more, says so with the way back to the centre.
import { DEAL_GONE, DEAL_NAME_UNREAD, DEAL_UNREAD } from '../../../../../lib/words';
import { Loading } from '../../../../../shared/ui';
import { resolveDealRef } from '../../../logic';
import { useDealLabels, useDeals, useStaleBanner, useWorldSelector, type World } from '../../../world';
import type { LayerProps } from '../../layers';
import { DealPage } from './DealPage';

const selDisplaysReady = (w: World) => w.displaysReady;

export function DealLayer({ route, nav }: LayerProps) {
  const q = useDeals();
  const labels = useDealLabels();
  const ready = useWorldSelector(selDisplaysReady);
  const stale = useStaleBanner();
  if (route.level !== 'deal') return null;
  const deals = q.data;
  const deal = deals ? resolveDealRef(route.deal, deals, labels) : undefined;
  if (deal) return <DealPage key={deal.id} deal={deal} nav={nav} />;
  if (q.error) return <div className="pf ar-deal"><h1 className="display cs-title" tabIndex={-1} data-layer-title="">{DEAL_UNREAD}</h1></div>;
  if (!deals || (!ready && !deals.some((d) => d.id === route.deal))) return <Loading what="the deal" />;
  // A deal named by its label ("D-0193") when the names could not be read: it may well be there.
  const byName = !deals.some((d) => d.id === route.deal);
  if (byName && stale) {
    return (
      <div className="pf ar-deal">
        <h1 className="display cs-title" tabIndex={-1} data-layer-title="">{DEAL_NAME_UNREAD}</h1>
        <p><button type="button" className="linkbtn" onClick={nav.home}>{DEAL_GONE.back}</button></p>
      </div>
    );
  }
  return (
    <div className="pf ar-deal">
      <h1 className="display cs-title" tabIndex={-1} data-layer-title="">{DEAL_GONE.text}</h1>
      <p><button type="button" className="linkbtn" onClick={nav.home}>{DEAL_GONE.back}</button></p>
    </div>
  );
}
