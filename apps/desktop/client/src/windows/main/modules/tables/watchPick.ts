// Which table "Watch the haggle" opens on: a "Watch it" button (a table pane, a deal page) names the
// deal, and the Watch view takes it once as it opens. Kept out of the view's chunk so a deal page can
// ask for it without loading the corridor.
let wanted: string | null = null;

/** Ask the Watch view to open on this deal. */
export const watchTable = (dealId: string): void => { wanted = dealId; };

/** The deal asked for, once (null when none was). */
export function takeWatched(): string | null {
  const w = wanted;
  wanted = null;
  return w;
}
