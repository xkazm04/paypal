import { useId, type ReactNode } from 'react';
import { SUMMARY_OPEN } from '../../lib/words';
import { Chip, type ChipTone } from './components';

/**
 * A module's summary card: one label, one figure or status, and an "Open" affordance. It is a real
 * button (Enter and Space open it). `id` is stable and travels with the opening, so closing the
 * detail page can put focus back here (`[data-card="<id>"]`, see App.tsx).
 */
export type SummaryCardProps = {
  id: string;
  label: ReactNode;
  /** The one figure or status line. */
  value: ReactNode;
  /** A short line under the value. */
  note?: ReactNode;
  /** A state chip beside the label; the tone never carries the meaning alone. */
  chip?: ReactNode;
  chipTone?: ChipTone;
  onOpen: () => void;
  /** Defaults to "Open". */
  openLabel?: string;
  className?: string;
  /** The compact variant (a module header's small chips): label above value and nothing else. The
   *  note, the chip text and the "Open" affordance are not drawn; `describe` is read out as the
   *  button's description (and is its tooltip when it is a string), never shown as text. */
  compact?: boolean;
  describe?: ReactNode;
  /** The compact chip's tooltip when there is no `describe` (the note, as plain words). */
  hint?: string;
};
export function SummaryCard({ id, label, value, note, chip, chipTone, onOpen, openLabel = SUMMARY_OPEN, className, compact, describe, hint }: SummaryCardProps) {
  const uid = useId();
  if (compact) {
    // The chips cut long words to one line, so the tooltip carries the whole text.
    const whole = [label, value].filter((x): x is string => typeof x === 'string').join(' ');
    const tip = [whole, typeof describe === 'string' ? describe : hint].filter(Boolean).join(' - ') || undefined;
    return (
      <button type="button" className={`ui-sumcard compact${className ? ` ${className}` : ''}`} data-card={id} onClick={onOpen} title={tip}
        aria-labelledby={`${uid}l ${uid}v`} aria-describedby={describe ? `${uid}d` : undefined}>
        <span className="sc-label" id={`${uid}l`}>{label}</span>
        <span className="sc-value" id={`${uid}v`}>{value}</span>
        {describe ? <span className="sr-only" id={`${uid}d`}>{describe}</span> : null}
      </button>
    );
  }
  return (
    <button type="button" className={`ui-sumcard${className ? ` ${className}` : ''}`} data-card={id} onClick={onOpen}>
      <span className="sc-label">{label}{chip ? <Chip tone={chipTone}>{chip}</Chip> : null}</span>
      <span className="sc-value">{value}</span>
      {note ? <span className="sc-note">{note}</span> : null}
      <span className="sc-open" aria-hidden="true">{openLabel} <span className="chev">›</span></span>
      <span className="sr-only">{openLabel}</span>
    </button>
  );
}
