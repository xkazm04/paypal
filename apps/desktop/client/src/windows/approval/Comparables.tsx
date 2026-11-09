// Comparables at the review (market_comparables): similar products as names, shops and prices in
// plain text (no images: the window's CSP stays as it is), and one inform-only line when the
// identical product is cheaper at a shop. It never blocks or changes the deal: nothing here reads
// from or writes to the decision, and an answer that fails leaves the review exactly as it was.
// Shop text is untrusted: every title, brand and shop is drawn as text, never as markup or a link.
import { useEffect, useState } from 'react';
import type { Deal } from '@bindings/Deal';
import type { MandatePayload } from '@bindings/MandatePayload';
import type { MarketComparablesAnswer } from '@bindings/MarketComparablesAnswer';
import { formatMinor } from '../../lib/format';
import { COMPARABLES, comparablesCheaper, FINDER_WIRE_NO_KEY } from '../../lib/words';
import { marketProductFor } from './PriceCheck';
import { hitLine } from './owner/ProductFinder';
import { useSession } from './session';

export type ComparablesState = 'loading' | 'ready' | 'none' | 'no-key' | 'offline';
const DASH = '—';

export function Comparables({ deal, payload }: { deal: Deal | null; payload: MandatePayload | null | undefined }) {
  const s = useSession();
  const [answer, setAnswer] = useState<MarketComparablesAnswer | null>(null);
  const [state, setState] = useState<ComparablesState>('loading');
  const id = deal?.id ?? null;
  const bound = deal ? marketProductFor(payload, deal.terms.item_ref) : null;
  const noKey = s.settings?.channel3_configured === false;
  const call = s.call;
  const ready = s.tokenReady;

  useEffect(() => {
    if (!id || !bound || noKey || !ready) return;
    let live = true;
    setState('loading');
    void Promise.resolve(call('market_comparables', { deal_id: id }, true, { background: true })).then((r) => {
      if (!live) return;
      // A read that did not answer at all (no result) is the same as one that failed.
      if (!r?.ok) {
        setState(r?.error?.message === FINDER_WIRE_NO_KEY ? 'no-key' : 'offline');
        return;
      }
      // Anything but the answer's own shape is not an answer: say it is unavailable.
      if (!Array.isArray(r.value?.comparables) || !Array.isArray(r.value?.cheaper)) {
        setState('offline');
        return;
      }
      setAnswer(r.value);
      setState(r.value.comparables.length ? 'ready' : 'none');
    });
    return () => { live = false; };
  }, [id, bound, noKey, ready, call]);

  if (!deal || !bound) return null;
  const shown: ComparablesState = noKey ? 'no-key' : state;
  const cheaper = shown === 'ready' ? answer?.cheaper[0] : undefined;
  const plain: Partial<Record<ComparablesState, string>> = { loading: COMPARABLES.loading, none: COMPARABLES.none, 'no-key': COMPARABLES.noKey, offline: COMPARABLES.offline };

  return (
    <div className="dr-mkt dr-comparables" data-comparables={shown}>
      <span className="k">{COMPARABLES.key}</span>
      {plain[shown] ? <span className="t dim" role="status">{plain[shown]}</span> : null}
      {cheaper ? (
        <span className="t dr-cheaper" role="note" data-cheaper>
          <b>{COMPARABLES.cheaperKey}</b> · {comparablesCheaper(cheaper.shop, formatMinor(cheaper.price_minor, cheaper.currency), formatMinor(cheaper.saving_minor, cheaper.currency))}
        </span>
      ) : null}
      {shown === 'ready' && answer ? (
        <ul className="dr-comp-list" aria-label={COMPARABLES.list}>
          {answer.comparables.map((h) => (
            <li key={h.id}>
              <span className="n">{h.title ?? DASH}</span>
              <span className="p">{h.brand ? `${h.brand} · ` : ''}{hitLine(h)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {shown === 'ready' ? <span className="ui-hint dr-comp-note">{COMPARABLES.note}</span> : null}
    </div>
  );
}
