// The Rewind as a layer of the console (#r=rewind): the week replayed from the wallet's own
// record, the same clock, scrubber and narration the Dial home had (Rewind.tsx, RewindParts.tsx),
// now on its own sheet. WP3 rebuilds its look; this only hosts it. Read-only: nothing here moves
// money. `at` opens it at a moment (a "while you were away" line).
import { Suspense, useEffect, useMemo, useState } from 'react';
import type { Deal } from '@bindings/Deal';
import { useNow, usePrefersReducedMotion } from '../../../lib/hooks';
import { lazyPart } from '../../../lib/lazy';
import { LAYER_LOADING, PLACE_TITLE, REWIND_TITLE } from '../../../lib/words';
import { shortTitle } from '../home/model';
import { useRewind } from '../Rewind';
import { useWorldSelector, type World } from '../world';

const RewindBar = lazyPart(() => import('../RewindParts').then((m) => m.RewindBar));
const RewindHub = lazyPart(() => import('../RewindParts').then((m) => m.RewindHub));
/** The Rewind's parts, for the window's idle preload. */
export const REWIND_PARTS = [RewindBar, RewindHub] as const;

const sel = (w: World) => ({ deals: w.deals.data, display: w.display });
const same = (a: ReturnType<typeof sel>, b: ReturnType<typeof sel>) => a.deals === b.deals && a.display === b.display;

export function RewindLayer({ at, onDeal, onExit }: { at: number | null; onDeal: (id: string) => void; onExit: () => void }) {
  const reduced = usePrefersReducedMotion();
  const now = useNow();
  const r = useRewind(true, now, reduced);
  const { deals, display } = useWorldSelector(sel, same);
  const labelOf = useMemo(() => {
    const by = new Map((deals ?? []).map((d) => [d.id, d] as const));
    return (id: string): { deal: Deal; label: string; title: string } | null => {
      const d = by.get(id);
      if (!d) return null;
      const disp = display(d);
      return { deal: d, label: disp.label, title: shortTitle(disp.title) };
    };
  }, [deals, display]);

  // Opening at a moment: step back to that week, then seek (the old "See it on the Rewind").
  const [want, setWant] = useState<number | null>(at);
  const { seek, shiftWeek, start, end, weekBack } = r;
  useEffect(() => {
    if (want === null) return;
    if (want < start && weekBack < 52) { shiftWeek(-1); return; }
    if (want >= end && weekBack > 0) { shiftWeek(1); return; }
    seek(want);
    setWant(null);
  }, [want, start, end, weekBack, seek, shiftWeek]);

  return (
    <div className="rw-host cs-rewind">
      <div className="cs-lhead">
        <p className="kicker">{PLACE_TITLE.rewind}</p>
        <h1 className="display cs-title" tabIndex={-1} data-layer-title="">{REWIND_TITLE}</h1>
      </div>
      <Suspense fallback={<p className="layer-loading" role="status">{LAYER_LOADING}</p>}>
        <div className="rw-stage"><RewindHub r={r} labelOf={labelOf} onOpenDeal={onDeal} /></div>
        <RewindBar r={r} labelOf={labelOf} onOpenDeal={onDeal} onExit={onExit} />
      </Suspense>
    </div>
  );
}
