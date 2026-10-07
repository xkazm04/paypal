// Small components that carry the report's surface rules (docs/design/the-table.html §10.1):
// mode badge on every screen, money as exact minor units, live countdowns from absolute
// deadlines, untrusted text in a quarantine box, typed failures rendered honestly.
import type { Mode } from '@bindings/Mode';
import type { Money as MoneyT } from '@bindings/Money';
import type { WalletError } from '../lib/contract';
import { countdown, formatMinor, formatMoney } from '../lib/format';
import { useNow } from '../lib/hooks';
import { backend } from '../lib/runtime';
import { modeWord } from '../lib/words';


const MODE_TIP: Record<Mode, string> = {
  sandbox: 'Sandbox: PayPal’s test money. Nothing here is real money.',
  replay: 'Replay: a recorded event played back. Its money is not real.',
  scripted_engine: 'Practice agent: a scripted agent with no AI model, for trying things out.',
};

export function ModeBadge({ mode }: { mode: Mode }) {
  return <span className={`badge ${mode}`} title={MODE_TIP[mode]}>{modeWord(mode)}</span>;
}

/** Shown only in a plain browser: this is a design preview on sample data, not the wallet. */
export function MockBadge() {
  if (backend().kind !== 'mock') return null;
  return <span className="badge mock" title="A design preview in a browser, on sample data. The wallet itself is not running.">Preview · sample data</span>;
}

export function Money({ value, className }: { value: MoneyT | null | undefined; className?: string }) {
  return <span className={`money ${className ?? ''}`}>{formatMoney(value)}</span>;
}

export function MinorMoney({ minor, currency, className }: { minor: number; currency: MoneyT['currency']; className?: string }) {
  return <span className={`money ${className ?? ''}`}>{formatMinor(minor, currency)}</span>;
}

/** Remaining time to an absolute Unix deadline; re-renders every second. */
export function Countdown({ deadline, className }: { deadline: number; className?: string }) {
  const now = useNow();
  return <span className={`money ${className ?? ''}`} aria-label="time left">{countdown(deadline, now)}</span>;
}

/** Counterparty / merchant text: plain text only, never markdown, never links. */
export function Quarantine({ text, label = 'Their words, unchecked' }: { text: string; label?: string }) {
  return (
    <div className="quarantine" role="note">
      <div className="q-label">{label}</div>
      <div className="q-text">{text}</div>
    </div>
  );
}

/** A signed rule set the wallet now refuses (mandate_list `refusal`): one plain sentence, no rule numbers. */
export const NO_LONGER_FITS = 'This rule set no longer fits what the wallet accepts, so its agent can’t act under it. Sign it again or withdraw it.';

const CODE_CLASS: Record<WalletError['code'], string> = {
  UNAVAILABLE: 'unavailable', UNSUPPORTED: 'unsupported', LOCKED: 'locked',
  PERMISSION: 'error', REFUSED: 'error', INVALID: 'error', NOT_FOUND: 'error', LEDGER_TRUST: 'error',
};

const CODE_WORD: Record<WalletError['code'], string> = {
  UNAVAILABLE: 'Not available yet', UNSUPPORTED: 'Not supported', LOCKED: 'Locked',
  PERMISSION: 'Not allowed here', REFUSED: 'Refused', INVALID: 'Not valid', NOT_FOUND: 'Not found', LEDGER_TRUST: 'Records failed a check',
};

/**
 * A typed failure. UNAVAILABLE / UNSUPPORTED read as availability states, never as success.
 * `message` replaces the wallet's own text when the caller has plain words for it (a REFUSED
 * from signing rules); the chip still says what kind of failure it is.
 */
export function WalletNotice({ error, what, message }: { error: WalletError; what?: string; message?: string }) {
  return (
    <div className={`notice ${CODE_CLASS[error.code]}`} role={error.isAvailabilityState ? 'status' : 'alert'}>
      <span className="n-code" title={error.code}>{CODE_WORD[error.code]}</span>
      <span>
        {what ? <b>{what}: </b> : null}
        {message ?? error.message}
      </span>
    </div>
  );
}
