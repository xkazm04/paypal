// spark abstract-first-home round 4 (prototype): the host side of the bare approval surface's protocol
// (windows/approval/bare/protocol.ts; the two sides do not import each other, so the literals are
// pinned by both sides' tests). Where a secure step is shown, what its page address is, and how a
// message from it is read: same origin and from the one window this host opened or framed, or ignored.
import type { ApprovalDraft } from '@bindings/ApprovalDraft';
import type { ApprovalOpenArgs } from '@bindings/ApprovalOpenArgs';
import type { H256 } from '@bindings/H256';
import { demoNow, inDesktopApp, withDemoSearch, type DemoState } from '../../../../../../lib/preview';
import { backend } from '../../../../../../lib/runtime';
import type { SecureKind } from './contract';

export type SecureMessage =
  | { type: 'secure-size'; height: number }
  | { type: 'secure-done'; kind: SecureKind }
  | { type: 'secure-cancel' };

const KINDS: readonly SecureKind[] = ['keys', 'rules', 'pairing'];

/** A message from the secure page, or null when it is not one (wrong origin, wrong window, wrong shape). */
export function readSecureMessage(e: Pick<MessageEvent, 'data' | 'origin' | 'source'>, from: Window | null | undefined, origin: string = location.origin): SecureMessage | null {
  if (!from || e.source !== from || e.origin !== origin) return null;
  const d = e.data as { type?: unknown; height?: unknown; kind?: unknown } | null;
  if (!d || typeof d !== 'object') return null;
  if (d.type === 'secure-size' && typeof d.height === 'number' && Number.isFinite(d.height) && d.height >= 0) return { type: 'secure-size', height: Math.min(d.height, 4000) };
  if (d.type === 'secure-done' && KINDS.includes(d.kind as SecureKind)) return { type: 'secure-done', kind: d.kind as SecureKind };
  if (d.type === 'secure-cancel') return { type: 'secure-cancel' };
  return null;
}

/** The step can be shown as a page of this browser (frame or popup): a plain browser on the mock
 *  world. In the desktop app frames are blocked (CSP frame-src 'none') and a window.open would not be
 *  the approval window, so there every presenter falls back to approval_open. */
export function secureInPage(): boolean {
  if (inDesktopApp()) return false;
  try { return backend().kind === 'mock'; } catch { return false; }
}

const TEMPLATE_KEYS = ['careful', 'restock', 'haggle'];

/** The bare approval page for a step, in this page's world (the mock's first_run etc. carried over).
 *  `draft`: a rules draft as approval_open carries it (JSON of ApprovalDraft) or a starter template key.
 *  `pairing`: the pairing id as approval_open writes it (JSON of the H256). */
export function bareUrl(kind: SecureKind, draft: string | null, pairing: string | null, world: DemoState | null = demoNow().state): string {
  const q = new URLSearchParams();
  q.set('bare', kind);
  if (kind === 'keys') q.set('target', 'credentials');
  if (kind === 'rules') {
    q.set('target', 'mandate');
    if (draft && draft.trim().startsWith('{')) q.set('draft', draft);
    else if (draft && TEMPLATE_KEYS.includes(draft)) q.set('template', draft);
  }
  if (kind === 'pairing') {
    q.set('target', 'pairing');
    if (pairing) q.set('pairing', pairing);
  }
  return `approval.html${world ? withDemoSearch(`?${q.toString()}`, world) : `?${q.toString()}`}`;
}

/** approval_open's arguments for the same step (the desktop fallback). */
export function openArgs(kind: SecureKind, draft: string | null, pairing: string | null): ApprovalOpenArgs {
  if (kind === 'keys') return { deal_id: null, target: 'credentials' };
  if (kind === 'pairing') return { deal_id: null, pairing: parse<H256>(pairing), target: 'pairing' };
  const d = draft && draft.trim().startsWith('{') ? parse<ApprovalDraft>(draft) : null;
  return { deal_id: null, target: 'mandate', draft: d?.type === 'rules' ? d : null };
}

function parse<T>(s: string | null): T | null {
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}

/** Beside this window, as the desktop child window sits: right of it if the screen has room, else left. */
export function popupFeatures(w: Pick<Window, 'screenX' | 'screenY' | 'outerWidth'> & { screen: Pick<Screen, 'availWidth'> } = window, size = { width: 440, height: 560 }): string {
  const gap = 12;
  const right = w.screenX + w.outerWidth + gap;
  const left = right + size.width <= w.screen.availWidth ? right : Math.max(0, w.screenX - size.width - gap);
  return `popup=yes,width=${size.width},height=${size.height},left=${Math.round(left)},top=${Math.round(w.screenY + 80)}`;
}
