// The product finder in a keep-prices-fresh row: a name or a pasted shop page link finds the
// product at the price service, and picking one fills the row's product code. Typing the code by
// hand still works and stays the source of truth: this only fills the same field.
// Both calls are reads (market_search, market_lookup): nothing is saved and nothing is audited.
// Shop text is untrusted: titles, brands and shops are drawn as text, never as markup or links.
import { useState } from 'react';
import type { ProductHit } from '@bindings/ProductHit';
import { formatMinor } from '../../../lib/format';
import { FINDER, FINDER_WIRE_NO_KEY, finderUseLabel } from '../../../lib/words';
import { Btn } from '../../../shared/ui';
import { useOptionalSession } from '../session';

export type FinderState = 'idle' | 'loading' | 'results' | 'none' | 'no-key' | 'offline' | 'not-a-product';

const LINK = /^https:\/\/\S+$/i;
const DASH = '—';

/** "$289.00 at northwind-tech.example", with a dash for whatever the hit does not say. */
export function hitLine(h: ProductHit): string {
  const price = h.price_minor !== undefined && h.currency ? formatMinor(h.price_minor, h.currency) : DASH;
  return `${price} · ${h.shop ?? DASH}`;
}

export function ProductFinder({ n, onPick, onClose }: { n: number; onPick: (productId: string) => void; onClose: () => void }) {
  const s = useOptionalSession();
  const [text, setText] = useState('');
  const [state, setState] = useState<FinderState>('idle');
  const [hits, setHits] = useState<ProductHit[]>([]);
  if (!s) return null;
  const noKey = s.settings?.channel3_configured === false;
  const shown: FinderState = noKey ? 'no-key' : state;

  const run = async () => {
    const q = text.trim();
    if (!q || noKey) return;
    setState('loading');
    setHits([]);
    const link = LINK.test(q);
    const r = link ? await s.call('market_lookup', { url: q }, true, { background: true }) : await s.call('market_search', { query: q }, true, { background: true });
    if (!r.ok) {
      setState(r.error.message === FINDER_WIRE_NO_KEY ? 'no-key' : link && r.error.code === 'UNAVAILABLE' && r.error.message.startsWith('The market found nothing') ? 'not-a-product' : 'offline');
      return;
    }
    const found = link ? [r.value as ProductHit] : (r.value as ProductHit[]);
    setHits(found);
    setState(found.length ? 'results' : 'none');
  };

  const note: Partial<Record<FinderState, string>> = { idle: FINDER.idle, none: FINDER.none, 'no-key': FINDER.noKey, offline: FINDER.offline, 'not-a-product': FINDER.notAProduct };
  return (
    <div className="ow-finder" role="group" aria-label={FINDER.label}>
      <div className="ow-finder-bar">
        <input className="ui-field" value={text} spellCheck={false} aria-label={FINDER.label} placeholder={FINDER.placeholder} disabled={noKey}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void run(); }} />
        <Btn sm disabled={noKey || !text.trim() || shown === 'loading'} onClick={() => void run()}>{shown === 'loading' ? FINDER.busy : FINDER.search}</Btn>
        <Btn kind="plain" sm onClick={onClose}>{FINDER.close}</Btn>
      </div>
      {note[shown] ? <span className="ui-hint" role="status" data-finder={shown}>{note[shown]}</span> : null}
      {shown === 'loading' ? <span className="ui-hint" role="status" data-finder="loading">{FINDER.busy}</span> : null}
      {shown === 'results' ? (
        <ul className="ow-finder-hits" aria-label={FINDER.results}>
          {hits.map((h) => (
            <li key={h.id}>
              <span className="ow-hit-t">
                <b>{h.title ?? DASH}</b>
                <span className="ui-hint">{h.brand ?? DASH} · {hitLine(h)}</span>
              </span>
              <Btn kind="plain" sm aria-label={finderUseLabel(h.title, n)} onClick={() => { onPick(h.id); onClose(); }}>{FINDER.use}</Btn>
            </li>
          ))}
        </ul>
      ) : null}
      {shown === 'results' ? <span className="ui-hint">{FINDER.untrusted}</span> : null}
    </div>
  );
}
