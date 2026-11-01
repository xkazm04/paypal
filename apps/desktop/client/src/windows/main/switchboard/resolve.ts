// The host side of a proposal: the assistant names an allowlisted action by reference; THIS file
// decides whether it can be armed and what it is called. The words the owner reads come from the
// resolved action (the deal's own label, the fixed step name, the wallet's own facts), never from the
// proposal's text; the proposal's `why` is shown beside it as the assistant's reason, as text.
// Nothing here runs anything: the Switchboard runs the `run` descriptor when the owner activates the
// button. A hand-off run is `approval_open` or a plain navigation to the console. An act run names one
// entry of SAFE_ACTS, the host's own table of the one act-tier command each act may invoke, and the
// Switchboard invokes it only after the owner's press on the consent box drawn from `consent`
// (docs/design/conversational-home-safe-acts.md).
import type { AUTHORITY } from '@bindings/authority';
import type { ActionRef } from '../../../lib/assistant';
import { BOARD_ACT, BOARD_PROPOSAL } from '../../../lib/words';
import { formatHash, parseHash } from '../logic';
import type { BoardKey } from './useBoardModel';

export type Run =
  | { kind: 'approval'; deal_id: string | null; target: 'credentials' | 'mandate' | 'unlock' | null }
  | { kind: 'console'; hash: string };

/** The acts: proposals that change the wallet, reversibly, after the owner's press. */
export type SafeAct = keyof typeof SAFE_ACTS;
export type ActRun = { kind: 'act'; act: SafeAct };

/** The host's table: the ONE command each act invokes and the ONE command that undoes it. Both are
 *  `act` tier in the authority table (tests pin it). `pause_all_agents` can only make the wallet do
 *  less; its undo `resume_all_agents` is never proposable, only offered after a pause made here.
 *  Its keys are exactly the `act` entries of ACTION_CLASS (lib/assistant/vocabulary.ts; resolve.test.ts). */
export const SAFE_ACTS = {
  pause_agents: { command: 'pause_all_agents', undo: 'resume_all_agents' },
} as const satisfies Record<string, { command: keyof typeof AUTHORITY; undo: keyof typeof AUTHORITY }>;

/** What the board knows that an act depends on. null = not known (the act is disarmed). */
export type BoardFacts = { agentsPaused: boolean | null; agentsWorking: number | null };

/** The consent box, entirely from fixed words and the facts above. `fingerprint` binds the press to
 *  what was shown: if the facts change before the press, the press does nothing. */
export type Consent = { title: string; does: string; doesNot: string; reverse: string; press: string; pressing: string; fingerprint: string };

export type Resolved =
  | { armed: true; act: false; label: string; confirm: string; run: Run }
  | { armed: true; act: true; label: string; confirm: string; run: ActRun; consent: Consent }
  | { armed: false; label: string; reason: string };

/** A hash the board may open in the console: short keys, plain values, the shapes parseHash knows. */
const SAFE_HASH = /^#[a-z]{1,4}=[A-Za-z0-9_.:-]{1,64}(&[a-z]{1,4}=[A-Za-z0-9_.:-]{1,64}){0,3}$/;

export const NO_FACTS: BoardFacts = { agentsPaused: null, agentsWorking: null };

export function resolveAction(a: ActionRef, byId: ReadonlyMap<string, BoardKey>, facts: BoardFacts = NO_FACTS): Resolved {
  switch (a.action) {
    case 'open_decision': {
      const k = byId.get(a.deal_id);
      if (!k) return { armed: false, label: BOARD_PROPOSAL.disarmed, reason: BOARD_PROPOSAL.whyDisarmed.gone };
      const label = BOARD_PROPOSAL.openDecision(`${k.title} (${k.label})`);
      if (k.fate !== 'needs' || !k.review) return { armed: false, label, reason: BOARD_PROPOSAL.whyDisarmed.notWaiting };
      return { armed: true, label, confirm: BOARD_PROPOSAL.confirm, run: { kind: 'approval', deal_id: k.id, target: null }, act: false };
    }
    case 'open_setup': {
      const t = a.target;
      if (t !== 'credentials' && t !== 'mandate' && t !== 'unlock') return { armed: false, label: BOARD_PROPOSAL.disarmed, reason: BOARD_PROPOSAL.whyDisarmed.badTarget };
      return { armed: true, label: BOARD_PROPOSAL.openSetup[t], confirm: BOARD_PROPOSAL.confirm, run: { kind: 'approval', deal_id: null, target: t }, act: false };
    }
    case 'open_console': {
      const h = a.hash;
      if (typeof h !== 'string' || !SAFE_HASH.test(h)) return { armed: false, label: BOARD_PROPOSAL.disarmed, reason: BOARD_PROPOSAL.whyDisarmed.badRoute };
      // Normalised through the console's own parser, so only a route it knows is opened.
      let norm: string;
      try { norm = formatHash(parseHash(h).route); } catch { return { armed: false, label: BOARD_PROPOSAL.disarmed, reason: BOARD_PROPOSAL.whyDisarmed.badRoute }; }
      return { armed: true, label: BOARD_PROPOSAL.openConsole, confirm: BOARD_PROPOSAL.confirmConsole, run: { kind: 'console', hash: norm || '#' }, act: false };
    }
    case 'pause_agents': {
      const w = BOARD_ACT.pause;
      if (facts.agentsPaused === null) return { armed: false, label: w.title, reason: BOARD_ACT.whyDisarmed.pausedUnknown };
      if (facts.agentsPaused) return { armed: false, label: w.title, reason: BOARD_ACT.whyDisarmed.alreadyPaused };
      const working = facts.agentsWorking;
      return {
        armed: true,
        act: true,
        label: w.title,
        confirm: BOARD_ACT.needsOk,
        run: { kind: 'act', act: 'pause_agents' },
        consent: { title: w.title, does: w.does(working), doesNot: w.doesNot, reverse: w.reverse, press: w.press, pressing: w.pressing, fingerprint: `pause_agents|paused=false|working=${working ?? 'unknown'}` },
      };
    }
    default:
      return { armed: false, label: BOARD_PROPOSAL.disarmed, reason: BOARD_PROPOSAL.whyDisarmed.badTarget };
  }
}
