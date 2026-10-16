// The one way from an owner place to the approval window (rebuild WP3c): the existing Handoff
// (setup/common.tsx: `approval_open` with the same targets as before, the lock glyph while
// idle-locked, disabled while the window opens, a WalletNotice on error), with the console's
// locked title ("Locked after 15 quiet minutes: ..."). Main never stores, signs, unlocks or pins.
import type { ReactNode } from 'react';
import type { H256 } from '@bindings/H256';
import { APPROVAL_LOCKED_TITLE } from '../../../../../lib/words';
import type { BtnKind } from '../../../../../shared/ui';
import { Handoff } from '../../../setup/common';
import { useLocked } from '../../../world';

export function ToApproval({ label, kind = 'gold', target, pairing, title, sm = false }: {
  label: ReactNode; kind?: BtnKind; target?: 'credentials' | 'mandate' | 'unlock'; pairing?: H256; title: string; sm?: boolean;
}) {
  const locked = useLocked();
  return <Handoff label={label} kind={kind} sm={sm} locked={locked} target={target} pairing={pairing} title={locked ? APPROVAL_LOCKED_TITLE : title} />;
}
