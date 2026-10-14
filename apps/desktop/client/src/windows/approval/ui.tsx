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
import type { MouseEvent, ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Mode } from '@bindings/Mode';
import { backend } from '../../lib/runtime';
import { APPROVAL_FRAME, BRAND_NAME } from '../../lib/words';
import { Mark } from '../../shared/brand';
import { MockBadge, ModeBadge, WalletNotice } from '../../shared/honesty';
import { Btn, Crumbs, Spacer, useToast } from '../../shared/ui';
import { footerNoticeText, STEP, UNLOCK_HEADING, type Step } from './model';
import { useSession } from './session';

/** The Dial's emblem: a steel dial with the gold settlement ring. Static, trusted SVG. */
export function Emblem() {
  return (
    <svg className="aw-emblem" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="e1" cx="12" cy="12" r="9.5" strokeWidth="2" />
      <circle className="e2" cx="12" cy="12" r="4.5" fill="none" strokeWidth="2" />
    </svg>
  );
}

/**
 * Close this window (the docked approval window; Rust returns focus to The Table). Resolves to
 * null when it closed, or the note to show when it could not: the browser preview has no window to
 * close, and a refused close leaves it open. Nothing about any deal changes either way.
 */
export async function closeThisWindow(): Promise<string | null> {
  if (backend().kind !== 'tauri') return APPROVAL_FRAME.closePreview;
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

export function Strip({ steps, countdown }: { steps: Step[]; countdown?: ReactNode }) {
  return (
    <ol className="strip" aria-label="Approval progress">
      {steps.map((s, i) => (
        <li key={`${s.label}-${i}`} className={s.status} aria-current={s.status === 'cur' || s.status === 'bad' ? 'step' : undefined}>
          {s.label}
          {s.status === 'cur' && s.label === STEP.browser && countdown ? <> · {countdown}</> : null}
        </li>
      ))}
    </ol>
  );
}

/** The default-on-silence line every needs-you surface carries. */
export function Silence({ text, generic }: { text: string; generic?: boolean }) {
  return (
    <p className={`a-sil ${generic ? 'generic' : ''}`}>
      <span className="a-sil-k">If you do nothing</span>
      <span>{text}</span>
    </p>
  );
}

export function Verdict({ tone, children }: { tone: 'ok' | 'no' | 'draft' | 'calm'; children: ReactNode }) {
  return <div className={`verdict ${tone}`} role={tone === 'no' ? 'alert' : 'status'}>{children}</div>;
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

/** Stylised hand-off to the system browser (no PayPal art, no URL from the client). */
export function BrowserArt() {
  return (
    <svg className="browser-art" viewBox="0 0 120 84" role="img" aria-label="Your system browser, not this app">
      <rect className="ba-frame" x="2" y="2" width="116" height="80" rx="7" strokeWidth="2" />
      <rect className="ba-bar" x="2" y="2" width="116" height="15" rx="7" />
      <circle className="ba-dot" cx="11" cy="9.5" r="2.5" />
      <circle className="ba-dot" cx="19" cy="9.5" r="2.5" />
      <rect className="ba-fill" x="28" y="6" width="80" height="7" rx="3.5" />
      <rect className="ba-fill" x="30" y="30" width="60" height="7" rx="3" />
      <rect className="ba-btn" x="38" y="44" width="44" height="12" rx="6" fill="none" strokeDasharray="3 2" />
      <text className="ba-t" x="60" y="73" fontSize="7" textAnchor="middle">your browser · not this app</text>
    </svg>
  );
}

export function Pill({ tone, children }: { tone: 'ok' | 'need' | 'off' | 'wait'; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}
