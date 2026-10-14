// Area: deal (rebuild WP3c). The deal page, the nested depth-3/4 layer every module links to:
// title and figures, the answer, the decision with its approval hand-off, and four cards opening
// nested views (what happened, rules that applied, who you deal with, proof from PayPal), each
// reading its own record when it opens (scale finding #17). Guide: docs/build/rebuild/wp3c.md.
// This file, console/areas/deal.css, lib/words/deal.ts and console/areas/deal/ are the area's.
import { lazyPart } from '../../../../lib/lazy';
import { DEAL_CRUMB } from '../../../../lib/words';
import { DealCrumb } from '../crumbs';
import { defineLayer, type LayerProps } from '../layers';
import '../areas/deal.css';

export const layers = [
  defineLayer({ id: 'deal', title: () => DEAL_CRUMB, Crumb: DealCrumb, component: lazyPart<LayerProps>(() => import('../areas/deal/DealLayer').then((m) => m.DealLayer)) }),
];
