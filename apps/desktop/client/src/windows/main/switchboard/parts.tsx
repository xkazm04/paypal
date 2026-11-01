// Small pieces the board shares: the four status shapes (a shape and a word, never colour alone),
// the amount of a key, and the sentence a key is read as.
import type { Currency } from '@bindings/Currency';
import type { Fate } from '../../../lib/assistant';
import { formatMinor } from '../../../lib/format';
import { BOARD_NOT_AVAILABLE } from '../../../lib/words';
import type { BoardKey } from './useBoardModel';

/** diamond = needs you, ring = moving, cross = stopped, tick = paid. Drawn in currentColor. */
export function Shape({ fate, size = 12 }: { fate: Fate; size?: number }) {
  return (
    <svg className={`sb-shape s-${fate}`} width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      {fate === 'needs' ? <path d="M6 1 11 6 6 11 1 6Z" fill="currentColor" />
        : fate === 'moving' ? <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
          : fate === 'stopped' ? <path d="M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            : <path d="M2 6.4 5 9.2 10.2 3" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

/** The amount of a deal, or a dashed "not available yet" when it is not known. */
export function amountText(k: Pick<BoardKey, 'amount_minor' | 'currency'>): string | null {
  return k.amount_minor === null || k.currency === null ? null : formatMinor(k.amount_minor, k.currency as Currency);
}

export function Amount({ k }: { k: Pick<BoardKey, 'amount_minor' | 'currency'> }) {
  const t = amountText(k);
  return t === null ? <i className="sb-na" title={BOARD_NOT_AVAILABLE}>{BOARD_NOT_AVAILABLE}</i> : <span className="money sb-amt">{t}</span>;
}

/** A dashed "not available yet" chip. */
export function NotYet({ what }: { what?: string }) {
  return <i className="sb-na" title={what ? `${what}: ${BOARD_NOT_AVAILABLE}` : BOARD_NOT_AVAILABLE}>{BOARD_NOT_AVAILABLE}</i>;
}
