// spark abstract-first-home round 4: pieces every bare form shares. Gate puts the approval
// window's own lock in front of a form's action (the wallet would refuse a locked or tokenless call
// anyway; this says so before she tries), BareDone is the finished state.
import type { ReactNode } from 'react';
import { WalletNotice } from '../../../shared/honesty';
import { Btn } from '../../../shared/ui';
import { footerNoticeText, UNLOCK_HEADING } from '../model';
import { useSession } from '../session';
import { BARE_GATE } from './words';

/** The action, or the way past what stands in front of it: no capability yet, or the idle lock. */
export function Gate({ children }: { children: ReactNode }) {
  const s = useSession();
  const locked = s.settingsLocked || s.lockedByError;
  const unsupported = s.settings ? !s.settings.native_reauth_available : false;
  if (!s.tokenReady && s.tokenError) {
    return <WalletNotice error={s.tokenError} what={BARE_GATE.token} message={footerNoticeText('token', s.tokenError)} />;
  }
  if (locked) {
    return (
      <div className="sc-gate">
        <div className="sc-acts">
          <Btn kind="gold" locked disabled={!s.tokenReady || s.unlocking || unsupported} onClick={() => void s.unlock()}>
            {s.unlocking ? BARE_GATE.unlocking : BARE_GATE.unlock}
          </Btn>
          <span className="sc-dim">{BARE_GATE.locked}</span>
        </div>
        {s.unlockError ? <WalletNotice error={s.unlockError} what={UNLOCK_HEADING} message={footerNoticeText('unlock', s.unlockError)} /> : null}
      </div>
    );
  }
  return <>{children}</>;
}

/** A finished secure step: a check, one line, one quiet line under it. */
export function BareDone({ title, sub, note, action }: { title: string; sub: string; note?: string; action?: ReactNode }) {
  return (
    <section className="sc-form sc-done" role="status" aria-live="polite">
      <span className="sc-check" aria-hidden="true">
        <svg viewBox="0 0 20 20"><path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <div className="sc-done-t">
        <h1>{title}</h1>
        <p>{sub}</p>
        {note ? <p className="sc-dim">{note}</p> : null}
      </div>
      {action ? <div className="sc-done-a">{action}</div> : null}
    </section>
  );
}
