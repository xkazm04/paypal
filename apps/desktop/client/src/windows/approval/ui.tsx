// Small presentational pieces of the approval window, faithful to the prototypes' approval
// surfaces (prototype/main/modules.css "approval window", prototype/tumbler/tumbler.css).
// Shared by DealReview (The Diff) and the owner screens (OwnerConfig, MandateEditor,
// PairingConfirm): add exports here, never change the ones they import. SVG colours come from
// tokens through classes in frame.css (no hex in TSX).
//
// Rebuild WP4b: the window reads as a front sheet of the console. WindowBar is the console's top
// bar (mark, crumbs "The Table > Approvals", mode badge, the way back) plus the Approvals strip,
// the sheet's index tab. "Back to The Table" only closes this window (the same close path the
// review's "Close this window" uses): it decides nothing and withdraws nothing.
import type { MouseEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Mode } from '@bindings/Mode';
import { leaveDemoApproval } from '../../lib/preview';
import { backend } from '../../lib/runtime';
import { APPROVAL_FRAME, BRAND_NAME } from '../../lib/words';
import { Mark } from '../../shared/brand';
import { MockBadge, ModeBadge, WalletNotice } from '../../shared/honesty';
import { Btn, Crumbs, Spacer, useToast } from '../../shared/ui';
import { footerNoticeText, UNLOCK_HEADING } from './model';
import { useSession } from './session';

/**
 * Close this window (the docked approval window; Rust returns focus to The Table). Resolves to
 * null when it closed, or the note to show when it could not: the browser preview has no window to
 * close, and a refused close leaves it open. Nothing about any deal changes either way. The sample
 * approval demo mode opens in the main window's own webview goes back to The Table instead.
 */
export async function closeThisWindow(): Promise<string | null> {
  if (backend().kind !== 'tauri') return leaveDemoApproval() ? null : APPROVAL_FRAME.closePreview;
  try {
    await getCurrentWindow().close();
    return null;
  } catch {
    return APPROVAL_FRAME.closeFailed;
  }
}

/** The calm way back: closes this window; a note it could not say comes as a toast. */
export function BackToTable() {
  const toast = useToast();
  return (
    <Btn kind="plain" sm className="aw-back" title={APPROVAL_FRAME.backTitle}
      onClick={() => void closeThisWindow().then((note) => { if (note) toast(note); })}>
      <span className="aw-back-ar" aria-hidden="true">‹</span>
      {APPROVAL_FRAME.back}
    </Btn>
  );
}

/**
 * The window's top bar and its Approvals strip (two grid rows of `.aw`). `module` adds the deal's
 * module to the crumbs; `onDetails` shows the Details button (deal review only).
 */
export function WindowBar({ mode, module, onDetails }: { mode: Mode | undefined; module?: string | null; onDetails?: (e: MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <>
      <header className="aw-head">
        <Mark className="aw-mark" />
        <Crumbs label={APPROVAL_FRAME.crumbs} items={[{ label: BRAND_NAME }, { label: APPROVAL_FRAME.name }, ...(module ? [{ label: module }] : [])]} />
        <Spacer />
        {mode ? <ModeBadge mode={mode} /> : null}
        <MockBadge />
        {onDetails ? (
          <Btn kind="plain" sm onClick={onDetails} title={APPROVAL_FRAME.detailsTitle}>
            {APPROVAL_FRAME.details}
          </Btn>
        ) : null}
        <BackToTable />
      </header>
      <p className="aw-tab" title={APPROVAL_FRAME.stripLabel}>
        <span className="aw-tab-k">{APPROVAL_FRAME.name}</span>
        <span className="sr-only">: </span>
        <span className="aw-tab-l">{APPROVAL_FRAME.strip}</span>
      </p>
    </>
  );
}

/** The owner screens' bar (configuration, rules, pairing): the WindowBar without a module. */
export function Header({ mode }: { mode: Mode | undefined }) {
  return <WindowBar mode={mode} />;
}

/** LOCKED: idle > 15 min, a settings lock, or a LOCKED answer. Unlock is native Windows Hello. */
export function LockCard({ compact }: { compact?: boolean }) {
  const s = useSession();
  const unsupported = s.settings && !s.settings.native_reauth_available;
  if (s.unlocking) {
    return (
      <div className="hello" role="status">
        <HelloGlyph />
        <span>
          <b>Windows Hello</b> is checking it’s you…
        </span>
      </div>
    );
  }
  return (
    <div className={`lockcard ${compact ? 'compact' : ''}`}>
      <div className="lock-row">
        <LockGlyph />
        <div>
          <b>Locked.</b> Money stays where it is until you unlock.
          {!compact ? <p>Like PayPal, the wallet asks again after 15 quiet minutes before it approves, pays, releases or signs anything. You can still read everything.</p> : null}
        </div>
      </div>
      {unsupported ? (
        <div className="notice unsupported" role="status">
          <span className="n-code">Not supported</span>
          <span>Windows Hello isn’t set up on this computer, so this window can’t unlock. Nothing was unlocked.</span>
        </div>
      ) : (
        <button type="button" className="tbtn gold" onClick={() => void s.unlock()} disabled={!s.tokenReady}>
          Unlock with Windows Hello
        </button>
      )}
      {s.unlockError ? <WalletNotice error={s.unlockError} what={UNLOCK_HEADING} message={footerNoticeText('unlock', s.unlockError)} /> : null}
    </div>
  );
}

export function LockGlyph() {
  return (
    <svg className="lock-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="10" rx="2.2" fill="none" strokeWidth="1.8" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" strokeWidth="1.8" />
      <circle cx="12" cy="15.5" r="1.4" />
    </svg>
  );
}

/** Windows Hello: the native face-scan prompt is open. */
export function HelloGlyph() {
  return (
    <svg className="hello-glyph" viewBox="0 0 34 34" aria-hidden="true">
      <path d="M4 11V6a2 2 0 0 1 2-2h5M23 4h5a2 2 0 0 1 2 2v5M30 23v5a2 2 0 0 1-2 2h-5M11 30H6a2 2 0 0 1-2-2v-5" fill="none" strokeWidth="2" />
      <circle cx="13" cy="14" r="1.6" />
      <circle cx="21" cy="14" r="1.6" />
      <path d="M12 21c3 2.6 7 2.6 10 0" fill="none" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

