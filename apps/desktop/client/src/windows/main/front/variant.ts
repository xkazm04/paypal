// spark abstract-first-home: the prototype switch. `?home=zoom|greet|brief` renders one of the three
// round-1 front doors instead of the board; anything else (or no param) leaves App exactly as it was.
// Prototype-only: the winner is promoted into the board and this switch is removed.
export type FrontVariant = 'zoom' | 'greet' | 'brief' | 'focus' | 'thread' | 'stage';
export const FRONT_VARIANTS: readonly FrontVariant[] = ['zoom', 'greet', 'brief', 'focus', 'thread', 'stage'];

export function frontVariant(search: string = typeof location === 'undefined' ? '' : location.search): FrontVariant | null {
  const v = new URLSearchParams(search).get('home');
  return (FRONT_VARIANTS as readonly string[]).includes(v ?? '') ? (v as FrontVariant) : null;
}
