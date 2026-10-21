// "Check the price now" for the selected deal (market_refresh). The wallet fetches the market's
// typical price for the product the owner's rules tie to this item and stores it; this only reads.
// Rust re-checks everything (token, unlock, selected deal, bound product); the client narrows it:
// no button when no product is bound, since that call is refused before any market call.
import { useState } from 'react';
import type { Deal } from '@bindings/Deal';
import type { MandatePayload } from '@bindings/MandatePayload';
import type { MarketRef } from '@bindings/MarketRef';
import type { WalletError } from '../../lib/contract';
import { PRICE_CHECK, priceCheckWords } from '../../lib/words';
import { WalletNotice } from '../../shared/honesty';
import { Btn } from '../../shared/ui';
import { refusalText } from './model';
import { useSession } from './session';

const PRODUCT_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** As MandatePayload::market_product_for: the product the market-watch rule binds to the item, else
 *  the item itself when it is a well-formed product id, else none. */
export function marketProductFor(payload: MandatePayload | null | undefined, itemRef: string): string | null {
  const watched = payload?.clauses.flatMap((c) => (c.type === 'market_watch' ? c.items : [])).find((i) => i.item_ref === itemRef);
  if (watched) return watched.product_id;
  return PRODUCT_ID.test(itemRef) ? itemRef : null;
}

export function PriceCheck({ deal, payload, onDone }: { deal: Deal | null; payload: MandatePayload | null | undefined; onDone?: () => Promise<void> }) {
  const s = useSession();
  const [result, setResult] = useState<MarketRef | null>(null);
  const [error, setError] = useState<WalletError | null>(null);
  if (!deal) return null;
  const product = marketProductFor(payload, deal.terms.item_ref);

  const check = async () => {
    if (!product) return;
    setError(null);
    const r = await s.call('market_refresh', { deal_id: deal.id, product_id: product }, true);
    if (r.ok) setResult(r.value);
    else setError(r.error);
    if (r.ok) await onDone?.();
  };

  return (
    <div className="dr-mkt dr-pricecheck">
      <span className="k">{PRICE_CHECK.key}</span>
      {product ? (
        <>
          <span className="t">
            {result ? <b>{priceCheckWords(result.median, result.p25, result.p75)}</b> : <span className="dim">{PRICE_CHECK.note}</span>}
          </span>
          <Btn kind="plain" sm disabled={!s.tokenReady || s.pending !== null} title={s.tokenReady ? undefined : PRICE_CHECK.needsUnlock} onClick={() => void check()}>
            {s.pending === 'market_refresh' ? PRICE_CHECK.busy : PRICE_CHECK.label}
          </Btn>
        </>
      ) : (
        <span className="t dim" role="note">{PRICE_CHECK.unbound}</span>
      )}
      {error ? <WalletNotice error={error} what={PRICE_CHECK.failed} message={refusalText(error)} /> : null}
    </div>
  );
}
