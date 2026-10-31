// The console's layer registry: one import line per area file (console/layers/<area>.ts). A new
// area is one more line here; an area's own changes never touch this file. `framework.test.tsx` checks
// that every LayerId is registered exactly once.
import type { LazyPart } from '../../../lib/lazy';
import { layers as book } from './layers/book';
import { layers as connections } from './layers/connections';
import { layers as core } from './layers/core';
import { layers as counter } from './layers/counter';
import { layers as deal } from './layers/deal';
import { layers as rescue } from './layers/rescue';
import { layers as rewind } from './layers/rewind';
import { layers as rules } from './layers/rules';
import { layers as safety } from './layers/safety';
import { layers as settings } from './layers/settings';
import { layers as setup } from './layers/setup';
import { layers as shield } from './layers/shield';
import { layers as spend } from './layers/spend';
import { layers as tables } from './layers/tables';
import { layers as tryIt } from './layers/try';
import { layerIdOf, type LayerDef, type LayerId, type LayerProps } from './layers';
import type { Route } from '../logic';

/** Every registered def, in registration order (duplicates included: the test looks for them). */
export const ALL_LAYERS: readonly LayerDef[] = [
  ...core, ...tables, ...spend, ...counter, ...book, ...shield, ...rescue,
  ...deal, ...rewind, ...setup, ...rules, ...connections, ...settings, ...safety, ...tryIt,
];

export const LAYERS: ReadonlyMap<LayerId, LayerDef> = new Map(ALL_LAYERS.map((d) => [d.id, d] as const));

/** The def that draws a route. Every LayerId is registered (framework.test.tsx, 'the registry'), so this never misses. */
export function layerOf(r: Route): LayerDef {
  const id = layerIdOf(r);
  const def = LAYERS.get(id);
  if (!def) throw new Error(`no layer registered for ${id}`);
  return def;
}

const isLazy = (c: LayerDef['component']): c is LazyPart<LayerProps> => typeof (c as Partial<LazyPart<LayerProps>>).preload === 'function';
/** The code-split layers, for the window's idle preload. */
export const LAYER_PARTS: readonly LazyPart<LayerProps>[] = ALL_LAYERS.map((d) => d.component).filter(isLazy);
