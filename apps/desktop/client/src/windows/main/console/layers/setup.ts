// Area: setup. The Charter as a layer (console/areas/setup/SetupLayer.tsx); its stylesheet is
// console/areas/setup.css, its words lib/words/setup.ts.
import { lazyPart } from '../../../../lib/lazy';
import { SETUP_PAGE_TITLE } from '../../../../lib/words';
import { defineLayer, type LayerProps } from '../layers';
import '../areas/setup.css';

export const layers = [
  defineLayer({ id: 'setup', title: () => SETUP_PAGE_TITLE, ownSeal: true, component: lazyPart<LayerProps>(() => import('../areas/setup/SetupLayer').then((m) => m.SetupLayer)) }),
];
