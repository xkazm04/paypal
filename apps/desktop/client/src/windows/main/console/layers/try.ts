// Area: try (spark fusion-killer-1030 WP2). "Try to break it": Break The Table (src/arena) hosted as a
// place of the console, beside the safety record. The component is the arena page's own
// (<BreakTheTable host="console" />, src/arena/BreakTheTable.tsx); this file only registers it. Its
// words are lib/words/arena.ts; its stylesheet is the arena's (src/arena/arena.css), scoped under
// `.arena`. It plays recorded answers only: no command it reaches moves money (guard.test.ts).
import { lazyPart } from '../../../../lib/lazy';
import { PLACE_NAME } from '../../../../lib/words';
import { defineLayer, type LayerProps } from '../layers';

export const layers = [
  defineLayer({ id: 'try', title: () => PLACE_NAME.try, tone: 'var(--coral)', component: lazyPart<LayerProps>(() => import('../areas/try/TryLayer').then((m) => m.TryLayer)) }),
];
