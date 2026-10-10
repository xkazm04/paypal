// How a bead on the dial looks and what its tip says: now (a deal as it stands) and on the Rewind
// (where it stood at the playhead). A payment whose outcome is not known (being checked with
// PayPal, ended before PayPal showed what happened, or an ending whose record could not be read)
// is drawn as a dashed outline with the check's words, never as on hold. Pure: no React, no IO.
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import type { HistoryStep } from '@bindings/HistoryStep';
import type { ChipTone } from '../../shared/ui';
import { moneyCheckNow, moneyCheckPill } from '../../lib/words';
import { chipTone } from './home/model';
import { beadKind, chipClass, isTerminal, moneyNow, rewindCheckTip, stateLabel, type BeadKind, type HistoryPoint } from './logic';

export type BeadLook = { kind: BeadKind; state: string; tone: ChipTone; money: string };

/** A deal's bead as it stands now; `need` is its open attention item, if any. */
export function liveLook(d: Deal, need: AttentionItem | undefined): BeadLook {
  if (need?.money_check) {
    const ended = isTerminal(d);
    return { kind: 'unknown', state: moneyCheckPill(need.money_check, ended).text, tone: 'dashed', money: moneyCheckNow(ended) };
  }
  return { kind: beadKind(d), state: stateLabel(d.state, d), tone: chipTone(chipClass(d)), money: moneyNow(d) };
}

/** A deal's bead on the Rewind, where it stood at `p`. `unshown` and `unread` are the endings the
 *  deal's own record placed, or could not be read (useEndedUnshown). */
export function pastLook(steps: readonly HistoryStep[], p: HistoryPoint, d: Deal, unshown: ReadonlySet<string>, unread: ReadonlySet<string>): BeadLook {
  const ck = rewindCheckTip(steps, p, d, unshown, unread);
  if (ck) return { kind: 'unknown', state: ck.state, tone: 'dashed', money: ck.money };
  const then = { ...d, state: p.state, shield: p.paused ? 'HOLD' as const : null };
  return { kind: beadKind(then), state: stateLabel(p.state, d), tone: chipTone(chipClass(then)), money: moneyNow(then) };
}
