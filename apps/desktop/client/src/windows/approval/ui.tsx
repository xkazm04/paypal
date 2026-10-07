// Small presentational pieces of the approval window, faithful to the prototypes' approval
// surfaces (prototype/main/modules.css "approval window", prototype/tumbler/tumbler.css).
// Shared by DealReview (The Diff) and the owner screens (OwnerConfig, MandateEditor,
// PairingConfirm): add exports here, never change the ones they import. SVG colours come from
// tokens through classes in frame.css (no hex in TSX).
import type { ReactNode } from 'react';
import type { Mode } from '@bindings/Mode';
import { MockBadge, ModeBadge, WalletNotice } from '../../shared/honesty';
import { STEP, type Step } from './model';
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

export function Header({ mode }: { mode: Mode | undefined }) {
  return (
    <header className="aw-head">
      <Emblem />
      <span className="aw-title">
        Approvals <span>· only this window can approve money</span>
      </span>
      {mode ? <ModeBadge mode={mode} /> : null}
      <MockBadge />
    </header>
  );
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
      {s.unlockError ? (
        s.unlockError.isAvailabilityState ? (
          <WalletNotice error={s.unlockError} what="Still locked" />
        ) : (
          <WalletNotice error={s.unlockError} what="Still locked · Windows Hello was cancelled" />
        )
      ) : null}
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
