// The Charter's copy of the Rewind's timeline, under what the owner just said: last Monday through the gold
// "now" line into the next 72 hours, and over those hours what the new rules would allow. The same bar and
// hub as the Rewind (console/areas/rewind), fed by the same reads; read-only.
import { Suspense } from 'react';
import { lazyPart } from '../../../lib/lazy';
import type { Reach } from '../../../lib/say/draft';
import { LAYER_LOADING } from '../../../lib/words';
import { useLayerNavIfAny } from '../console/layers';
import { useTimeline } from '../console/areas/rewind/useTimeline';
import '../console/areas/rewind.css';

const RewindBar = lazyPart(() => import('../console/areas/rewind/Scrubber').then((m) => m.RewindBar));
const RewindHub = lazyPart(() => import('../console/areas/rewind/Scrubber').then((m) => m.RewindHub));

export function SayTimeline({ reach }: { reach: Reach | null }) {
  const nav = useLayerNavIfAny();
  const { r, labelOf, ahead } = useTimeline(reach);
  return (
    <div className="ar-rewind say-tl" data-tour="say-timeline">
      <div className="rw-host">
        <Suspense fallback={<p className="layer-loading" role="status">{LAYER_LOADING}</p>}>
          <div className="rw-stage"><RewindHub r={r} labelOf={labelOf} onOpenDeal={(id) => nav?.deal(id)} ahead={ahead} /></div>
          <RewindBar r={r} labelOf={labelOf} onOpenDeal={(id) => nav?.deal(id)} onExit={() => nav?.back()} ahead={ahead} />
        </Suspense>
      </div>
    </div>
  );
}
