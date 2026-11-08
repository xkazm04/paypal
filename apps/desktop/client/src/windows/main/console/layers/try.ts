// Area: try (spark fusion-killer-1030 WP2). The preview tabs of the console, each a place reachable by
// hash (#p=try, #p=proof, #p=director) and from the top bar and Find:
//  - "Try to break it": Break The Table (src/arena, <BreakTheTable host="console" />). Its words are
//    lib/words/arena.ts; its stylesheet is the arena's (src/arena/arena.css), scoped under `.arena`.
//  - "Check a proof": the proof checker (src/proof/ProofPage, host="console"), no wallet, no backend.
//  - "Maya's week": the scenario director (director.html framed; BROWSER PREVIEW ONLY, see
//    areas/try/DirectorLayer.tsx and PREVIEW_PLACES in logic.ts).
// All three play recorded answers or static files only: no command they reach moves money
// (guard.test.ts). They are `keepAlive`: once opened they stay mounted (hidden) so a return is instant
// and keeps the game, the dropped file or the playing film where they were.
import { lazyPart } from '../../../../lib/lazy';
import { PLACE_NAME } from '../../../../lib/words';
import { defineLayer, type LayerProps } from '../layers';

export const layers = [
  defineLayer({ id: 'try', title: () => PLACE_NAME.try, tone: 'var(--coral)', keepAlive: true, component: lazyPart<LayerProps>(() => import('../areas/try/TryLayer').then((m) => m.TryLayer)) }),
  defineLayer({ id: 'proof', title: () => PLACE_NAME.proof, tone: 'var(--teal)', keepAlive: true, component: lazyPart<LayerProps>(() => import('../areas/try/ProofLayer').then((m) => m.ProofLayer)) }),
  defineLayer({ id: 'director', title: () => PLACE_NAME.director, tone: 'var(--gold)', keepAlive: true, ownSeal: true, fit: true, component: lazyPart<LayerProps>(() => import('../areas/try/DirectorLayer').then((m) => m.DirectorLayer)) }),
];
