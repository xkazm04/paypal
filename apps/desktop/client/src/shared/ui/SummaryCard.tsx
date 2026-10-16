import type { ReactNode } from 'react';
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
};
export function SummaryCard({ id, label, value, note, chip, chipTone, onOpen, openLabel = SUMMARY_OPEN, className }: SummaryCardProps) {
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
