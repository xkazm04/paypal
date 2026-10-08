// The approval checklist exactly as the wallet composed it (design §10.3): one line per predicate
// the money step runs. Each line's words come from the wallet verbatim; the window adds no line,
// drops none and re-words none. The Layer-2 fact behind a line sits behind its "Why?" / "Proof".
// The CHECKING reveal (lines appearing one by one) is presentation only: the list is complete
// before the first line shows.
import type { ApprovalCheck } from '@bindings/ApprovalCheck';
import type { ApprovalCheckStatus } from '@bindings/ApprovalCheckStatus';
import { useState } from 'react';
import { CHECK_STATUS_WORD } from '../../../lib/words';
import { Icon, Why, type IconName } from '../../../shared/ui';
import { checksTally } from '../model';

const CLASS: Record<ApprovalCheckStatus, string> = { pass: 'pass', fail: 'fail', wait: 'unknown', not_applicable: 'na' };
const ICON: Record<ApprovalCheckStatus, IconName | null> = { pass: 'check', fail: 'block', wait: 'clock', not_applicable: null };

/** "4 passed · 1 failed · 2 checked later" over the lines that apply. */
export function checksLine(checks: readonly ApprovalCheck[]): string {
  const t = checksTally(checks);
  return [`${t.pass} of ${t.total} passed`, t.fail ? `${t.fail} failed` : null, t.wait ? `${t.wait} checked later` : null].filter(Boolean).join(' · ');
}

export function WalletChecks({ checks, revealed }: { checks: readonly ApprovalCheck[]; revealed?: number }) {
  const t = checksTally(checks);
  // Lines that do not apply to this step fold into one quiet line (UX-GUIDE: no wall of
  // non-answers); "Show" lists them, still in the wallet's words.
  const [showNa, setShowNa] = useState(false);
  const na = checks.filter((c) => c.status === 'not_applicable').length;
  const reading = (i: number) => revealed !== undefined && i >= revealed;
  const done = !checks.some((_, i) => reading(i));
  return (
    <div className="ui-checks wc" aria-label="Checks on this deal" aria-busy={!done}>
      {done ? (
        <div className="cs-sum">
          {t.pass ? <span className="cs-n pass"><Icon name="check" size={13} />{t.pass} passed</span> : null}
          {t.fail ? <span className="cs-n fail"><Icon name="block" size={13} />{t.fail} failed</span> : null}
          {t.wait ? <span className="cs-n unknown"><Icon name="clock" size={13} />{t.wait} checked later</span> : null}
        </div>
      ) : null}
      <ul className="cs-list">
        {checks.map((c, i) => {
          if (reading(i)) {
            return (
              <li key={c.id} className="unknown reading" data-check={c.id}>
                <span className="cs-i" aria-label="checking">…</span>
                <span className="cs-name dim">checking…</span>
              </li>
            );
          }
          if (c.status === 'not_applicable' && !showNa) return null;
          const icon = ICON[c.status];
          return (
            <li key={c.id} className={CLASS[c.status]} data-check={c.id} data-status={c.status}>
              <span className="cs-i" role="img" aria-label={CHECK_STATUS_WORD[c.status]}>{icon ? <Icon name={icon} size={13} /> : '–'}</span>
              <span className="cs-name">{c.text}</span>
              <Why question={c.text} label={c.status === 'fail' || c.status === 'wait' ? 'Why?' : 'Proof'} className="wc-why">
                <p className="wc-detail">{c.detail}</p>
              </Why>
            </li>
          );
        })}
        {done && na && !showNa ? (
          <li className="na fold">
            <span className="cs-i" aria-hidden="true">–</span>
            <span className="cs-name">{na} not needed for this step</span>
            <button type="button" className="cs-all" aria-label={`Show the ${na} not needed for this step`} onClick={() => setShowNa(true)}>Show</button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
