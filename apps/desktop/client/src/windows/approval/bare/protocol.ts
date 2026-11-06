// spark abstract-first-home round 4: the approval window's BARE mode. `approval.html?bare=keys|rules|pairing`
// renders only that one secure form, for a host page that shows it as one component of the setup
// conversation (main/home/secure). Everything else about the page is the approval window's:
// the same SessionProvider (the capability in a ref, never state), the same privileged calls and the
// same gates in the wallet (label, token, idle lock). Bare mode removes chrome, never a check.
//
// The page talks to its host with three messages, posted to the frame's parent (inline, sheet) or
// to the window that opened it (popup), and only to this page's own origin:
//   { type: 'secure-size', height }   the form's height in CSS px, whenever it changes
//   { type: 'secure-done', kind }     the form finished (keys saved, rules signed, words confirmed)
//   { type: 'secure-cancel' }         Esc: she wants out without finishing
// The host never treats secure-done as the truth: it waits for the wallet (useStart) to say so.
export type BareKind = 'keys' | 'rules' | 'pairing';
export const BARE_KINDS: readonly BareKind[] = ['keys', 'rules', 'pairing'];
export const BARE_PARAM = 'bare';

export type BareMessage =
  | { type: 'secure-size'; height: number }
  | { type: 'secure-done'; kind: BareKind }
  | { type: 'secure-cancel' };

/** The bare form this page should render, or null for the ordinary approval window. */
export function bareKind(search: string = typeof location === 'undefined' ? '' : location.search): BareKind | null {
  const v = new URLSearchParams(search).get(BARE_PARAM);
  return (BARE_KINDS as readonly string[]).includes(v ?? '') ? (v as BareKind) : null;
}

/** `head=0`: the host already titles the step (the sheet's own heading), so the form's heading is
 *  kept for screen readers only. */
export function bareHeadless(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  return new URLSearchParams(search).get('head') === '0';
}

/** Where this page's messages go: the frame's parent, else the opener; null when it stands alone. */
export function hostWindow(w: Window = window): Window | null {
  try {
    if (w.parent && w.parent !== w) return w.parent;
  } catch { /* a foreign parent: nothing to tell */ }
  return w.opener ?? null;
}

/** Shown as a frame (inline or sheet) rather than its own window (popup, or opened directly). */
export function isFramed(w: Window = window): boolean {
  try { return w.parent !== w; } catch { return true; }
}

/** Post one message to the host, same origin only (a page elsewhere never hears it). */
export function postToHost(msg: BareMessage, w: Window = window): void {
  const to = hostWindow(w);
  if (!to) return;
  try { to.postMessage(msg, w.location.origin); } catch { /* the host went away */ }
}
