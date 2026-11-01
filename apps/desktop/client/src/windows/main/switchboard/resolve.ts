// The host side of a proposal: the assistant names an allowlisted action by reference; THIS file
// decides whether it can be armed and what it is called. The words the owner reads come from the
// resolved action (the deal's own label, the fixed step name), never from the proposal's text; the
// proposal's `why` is shown beside it as the assistant's reason, as text. Nothing here runs anything:
// the Switchboard runs the `run` descriptor when the owner activates the button, and every run is
// `approval_open` or a plain navigation to the console.
import type { ActionRef } from '../../../lib/assistant';
import { BOARD_PROPOSAL } from '../../../lib/words';
import { formatHash, parseHash } from '../logic';
import type { BoardKey } from './useBoardModel';

export type Run =
  | { kind: 'approval'; deal_id: string | null; target: 'credentials' | 'mandate' | 'unlock' | null }
  | { kind: 'console'; hash: string };

export type Resolved =
  | { armed: true; label: string; confirm: string; run: Run }
  | { armed: false; label: string; reason: string };

/** A hash the board may open in the console: short keys, plain values, the shapes parseHash knows. */
const SAFE_HASH = /^#[a-z]{1,4}=[A-Za-z0-9_.:-]{1,64}(&[a-z]{1,4}=[A-Za-z0-9_.:-]{1,64}){0,3}$/;

export function resolveAction(a: ActionRef, byId: ReadonlyMap<string, BoardKey>): Resolved {
  switch (a.action) {
    case 'open_decision': {
      const k = byId.get(a.deal_id);
      if (!k) return { armed: false, label: BOARD_PROPOSAL.disarmed, reason: BOARD_PROPOSAL.whyDisarmed.gone };
      const label = BOARD_PROPOSAL.openDecision(`${k.title} (${k.label})`);
      if (k.fate !== 'needs' || !k.review) return { armed: false, label, reason: BOARD_PROPOSAL.whyDisarmed.notWaiting };
      return { armed: true, label, confirm: BOARD_PROPOSAL.confirm, run: { kind: 'approval', deal_id: k.id, target: null } };
    }
    case 'open_setup': {
      const t = a.target;
      if (t !== 'credentials' && t !== 'mandate' && t !== 'unlock') return { armed: false, label: BOARD_PROPOSAL.disarmed, reason: BOARD_PROPOSAL.whyDisarmed.badTarget };
      return { armed: true, label: BOARD_PROPOSAL.openSetup[t], confirm: BOARD_PROPOSAL.confirm, run: { kind: 'approval', deal_id: null, target: t } };
    }
    case 'open_console': {
      const h = a.hash;
      if (typeof h !== 'string' || !SAFE_HASH.test(h)) return { armed: false, label: BOARD_PROPOSAL.disarmed, reason: BOARD_PROPOSAL.whyDisarmed.badRoute };
      // Normalised through the console's own parser, so only a route it knows is opened.
      let norm: string;
      try { norm = formatHash(parseHash(h).route); } catch { return { armed: false, label: BOARD_PROPOSAL.disarmed, reason: BOARD_PROPOSAL.whyDisarmed.badRoute }; }
      return { armed: true, label: BOARD_PROPOSAL.openConsole, confirm: BOARD_PROPOSAL.confirmConsole, run: { kind: 'console', hash: norm || '#' } };
    }
  }
}
