// "Maya's week" (#p=director): the scenario director, BROWSER PREVIEW ONLY. The director holds a mock
// wallet core of its own and frames the three real windows, so it stays a page of its own
// (director.html) and this place frames that page: the host console's mock world and the director's
// never share a clock or an event channel. It never runs inside the desktop shell (no such page, CSP
// frame-src 'none'): the tab is not offered there, the hash does not parse there (logic.ts
// placeAvailable), and this layer refuses on its own as the last guard. `?story=` passes through.
import { useState } from 'react';
import { Skeleton, useRevealed } from '../../stagger';
import { DIRECTOR_PLACE } from '../../../../../lib/words';
import { previewPagesAvailable } from '../../../../../lib/preview';
import type { LayerProps } from '../../layers';

const src = (): string => {
  const story = new URLSearchParams(location.search).get('story');
  return `director.html${story ? `?story=${encodeURIComponent(story)}` : ''}`;
};

export function DirectorLayer(_: LayerProps) {
  const allowed = previewPagesAvailable();
  // The stage is a whole page of its own: it loads on the last wave, after the frame has painted.
  const revealed = useRevealed(3);
  const [url] = useState(src);
  const [loaded, setLoaded] = useState(false);
  if (!allowed) return <p className="pv-note" role="status">{DIRECTOR_PLACE.shellOnly}</p>;
  return (
    <div className="pv-stage">
      <h1 className="sr-only" tabIndex={-1} data-layer-title="">{DIRECTOR_PLACE.title}</h1>
      {revealed ? <iframe className={`pv-frame${loaded ? ' on' : ''}`} src={url} title={DIRECTOR_PLACE.frame} onLoad={() => setLoaded(true)} /> : null}
      {loaded ? null : <Skeleton className="pv-skel" h="60vh" />}
    </div>
  );
}
