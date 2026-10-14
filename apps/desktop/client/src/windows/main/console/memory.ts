// Where each layer was left: its scroll and the control that had focus, so stepping back up the
// stack gives both back (focus on the card that opened the deeper layer, then the scroll). Going
// deeper puts focus on the new layer's heading. A layer's content may still be loading (a lazy
// module page), so restoring retries for a few frames before it settles for the heading.

export type LayerMemory = { scroll: number; focus: string | null };

/** The key a focused control is found by again: a module card, a console row, or an element id. */
export function focusKeyOf(el: Element | null): string | null {
  if (!(el instanceof HTMLElement) || el === document.body) return null;
  const card = el.closest<HTMLElement>('[data-card]');
  if (card?.dataset.card) return `card:${card.dataset.card}`;
  const fk = el.closest<HTMLElement>('[data-fk]');
  if (fk?.dataset.fk) return `fk:${fk.dataset.fk}`;
  return el.id ? `id:${el.id}` : null;
}

export function findByFocusKey(root: ParentNode, key: string): HTMLElement | null {
  const [kind, ...rest] = key.split(':');
  const v = rest.join(':');
  if (kind === 'card') return root.querySelector<HTMLElement>(`[data-card="${CSS.escape(v)}"]`);
  if (kind === 'fk') return root.querySelector<HTMLElement>(`[data-fk="${CSS.escape(v)}"]`);
  if (kind === 'id') return root.querySelector<HTMLElement>(`#${CSS.escape(v)}`);
  return null;
}

/** The layer's heading (the element marked data-layer-title, else its first h1). */
export function layerHeading(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>('[data-layer-title]') ?? root.querySelector<HTMLElement>('h1');
}

/** Frames a restore waits for a lazy layer's content before it gives up on the remembered control. */
export const RESTORE_FRAMES = 20;

/** Puts the layer back as it was left (or, going deeper, focuses its heading). Returns a cancel. */
export function restoreLayer(root: HTMLElement, scroller: HTMLElement | null, mem: LayerMemory | null): () => void {
  let tries = 0;
  let raf = 0;
  const run = () => {
    const el = mem?.focus ? findByFocusKey(root, mem.focus) ?? findByFocusKey(document, mem.focus) : null;
    const heading = layerHeading(root);
    if (!el && tries++ < RESTORE_FRAMES && (mem?.focus || !heading)) { raf = requestAnimationFrame(run); return; }
    if (scroller) scroller.scrollTop = mem?.scroll ?? 0;
    const target = el ?? heading;
    if (target && !target.contains(document.activeElement)) {
      if (target === heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
  };
  run();
  return () => cancelAnimationFrame(raf);
}
