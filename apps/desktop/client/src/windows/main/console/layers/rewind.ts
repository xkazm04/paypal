// Area: rewind (rebuild WP3c). The week replayed from the wallet's own record: the answer, the
// figures by who decided, the scrubber and hub, and the windowed tape of every step (actor filters,
// day anchors). Guide: docs/build/rebuild/wp3c.md. This file, console/areas/rewind.css,
// lib/words/rewind.ts and console/areas/rewind/ are the area's.
import { lazyPart } from '../../../../lib/lazy';
import { REWIND_TITLE } from '../../../../lib/words';
import { defineLayer, type LayerProps } from '../layers';
import '../areas/rewind.css';

export const layers = [
  defineLayer({ id: 'rewind', title: () => REWIND_TITLE, tone: 'var(--teal)', component: lazyPart<LayerProps>(() => import('../areas/rewind/RewindLayer').then((m) => m.RewindLayer)) }),
];
