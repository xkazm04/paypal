// The deal layer's body (rebuild WP3c): finds the deal the route names (an id or its label, as old
// links have it), then draws its page; while the deals load a placeholder shaped like the page, when
// the read fails a failure that says so with Try again, and when the deal is not there any more, says
// so with the way back to the centre.
import { DEAL_FAILED, DEAL_GONE, DEAL_NAME_UNREAD, DEAL_UNREAD, LOADING_WHAT } from '../../../../../lib/words';
import { Placeholder, ReadFailed } from '../../../../../shared/ui';
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
  // The deals did not answer (never, or not on the last try and this deal is not among the held
  // ones): say what happened and offer the same read again; never "not there any more".
  if (q.error) {
    return (
      <div className="pf ar-deal">
        <h1 className="display cs-title" tabIndex={-1} data-layer-title="">{DEAL_UNREAD}</h1>
        <ReadFailed error={q.error} what={DEAL_FAILED.what} message={DEAL_FAILED.line} onRetry={q.refetch} />
        <p><button type="button" className="linkbtn" onClick={nav.home}>{DEAL_GONE.back}</button></p>
      </div>
    );
  }
  if (!deals || (!ready && !deals.some((d) => d.id === route.deal))) return <div className="pf ar-deal"><Placeholder what={LOADING_WHAT.deal} shape="pane" /></div>;
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
