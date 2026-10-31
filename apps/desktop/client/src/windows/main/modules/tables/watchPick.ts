// Which table "Watch the haggle" opens on: a "Watch it" button (a table pane, a deal page, the
// decision centre) names the deal, and the Watch view takes it once as it opens. Kept out of the
// view's chunk so a deal page can ask for it without loading the corridor.
import type { Deal } from '@bindings/Deal';
import type { DisplayBand } from '@bindings/DisplayBand';

let wanted: string | null = null;

/** Ask the Watch view to open on this deal. */
export const watchTable = (dealId: string): void => { wanted = dealId; };

/** The deal asked for, once (null when none was). */
export function takeWatched(): string | null {
  const w = wanted;
  wanted = null;
  return w;
}

/** A haggle worth watching: her agent has made an offer. The Watch list holds exactly these, so a
 *  "Watch it" is offered only where the view can open on that deal. */
export const worthWatching = (deal: Pick<Deal, 'kind'>, band: Pick<DisplayBand, 'rounds_used'> | null | undefined): boolean =>
  deal.kind === 'haggle' && (band?.rounds_used ?? 0) > 0;
