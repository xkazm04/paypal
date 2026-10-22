// Hold to confirm (docs/ux/ROUND-2.md; approved and permanent). For actions that release or pay money:
// press and hold for `ms` while the rosette fills, then `onConfirm` runs once. Releasing early cancels.
// Pointer: hold the button. Keyboard: hold Space while it is focused. Enter never runs it, so the
// approval window's "Enter never releases money" rule holds by construction.
//
// Since rebuild WP4b this is a thin face over HoldGesture (the Calibre "press the seal" presenter):
// the same rule, plus a gauge with aria-valuenow, losing focus cancels a hold, and calm / reduced
// motion fills in quarter steps. The API, the `ui-hold` class and the kinds are unchanged, so every
// caller (and actions.test.tsx) keeps working.
import type { ReactNode } from 'react';
import { HOLD_WORDS } from '../../lib/words';
import { HOLD_MS } from '../../design/motion';
import { HoldGesture } from './HoldGesture';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

export type HoldButtonProps = {
  children: ReactNode;
  onConfirm: () => void;
  /** Hold duration in milliseconds. */
  ms?: number;
  disabled?: boolean;
  /** Visual kind, matching Btn: gold is the money action. */
  kind?: 'gold' | 'primary' | 'danger';
  title?: string;
  className?: string;
  /** Read by screen readers before the label, e.g. "Hold to approve". */
  hint?: string;
};

export function HoldButton({ children, onConfirm, ms = HOLD_MS, disabled, kind = 'gold', title, className, hint = HOLD_WORDS.hint }: HoldButtonProps) {
  return (
    <HoldGesture
      className={cx('ui-btn', 'ui-hold', kind, className)}
      label={children}
      onComplete={onConfirm}
      ms={ms}
      disabled={disabled}
      title={title}
      hint={hint}
      progressLabel={HOLD_WORDS.progress}
      holdingText={HOLD_WORDS.holding}
      doneText={HOLD_WORDS.done}
    />
  );
}
