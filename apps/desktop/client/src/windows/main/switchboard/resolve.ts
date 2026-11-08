// The host side of a proposal: the assistant names an allowlisted action by reference; THIS file
// decides whether it can be armed and what it is called. The words the owner reads come from the
// resolved action (the deal's own label, the fixed step or agent name, the wallet's own facts), never
// from the proposal's text; the proposal's `why` is shown beside it as the assistant's reason, as text.
// Nothing here runs anything: the Switchboard runs the `run` descriptor when the owner activates the
// button. A hand-off run is `approval_open` or a plain navigation to the console. An act run carries
// the wallet's own closed act (`assistant_act`, SAFE_ACT_COMMAND) and its undo, and the Switchboard
// sends it only after the owner's press on the consent box drawn from `consent`, with the box's words
// so the wallet records what she was shown (docs/design/conversational-home-safe-acts.md).
import type { AgentSlot } from '@bindings/AgentSlot';
import type { AssistantAct } from '@bindings/AssistantAct';
import type { ActionRef } from '../../../lib/assistant';
import { BOARD_ACT, BOARD_PROPOSAL } from '../../../lib/words';
import { formatHash, parseHash } from '../logic';
import type { BoardKey } from './useBoardModel';

export type Run =
  | { kind: 'approval'; deal_id: string | null; target: 'credentials' | 'mandate' | 'unlock' | null }
  | { kind: 'console'; hash: string };

/** The one wallet command the board sends for every act and every undo (act tier, main only). */
export const SAFE_ACT_COMMAND = 'assistant_act' as const;

/** The host's table: each proposable act, the wallet act it runs and the wallet act that undoes it.
 *  Every one can only make the wallet do less; no undo is proposable. Its keys are exactly the
 *  `act` entries of ACTION_CLASS (lib/assistant/vocabulary.ts; resolve.test.ts pins it). */
export const SAFE_ACTS = {
  pause_agents: { act: 'pause_all', undo: 'resume_all' },
  pause_agent: { act: 'pause_agent', undo: 'resume_agent' },
  let_lapse: { act: 'let_lapse', undo: 'lapse_undo' },
} as const satisfies Record<string, { act: AssistantAct['act']; undo: AssistantAct['act'] }>;

/** The acts: proposals that change the wallet, reversibly, after the owner's press. */
export type SafeAct = keyof typeof SAFE_ACTS;

/** What an act sends, and the host words for its outcome. */
export type ActRun = {
  kind: 'act';
  act: SafeAct;
  wire: AssistantAct;
  undoWire: AssistantAct;
  done: string;
  undone: string;
  undoTitle: string;
};

/** What the board knows that an act depends on. null = not known (the act is disarmed). */
export type BoardFacts = {
  agentsPaused: boolean | null;
  agentsWorking: number | null;
  /** Agents paused one by one. */
  pausedAgents: readonly AgentSlot[] | null;
  /** Deals whose needs-you card offers to let it lapse (a gate, not a closed mismatch). */
  lapsable: ReadonlySet<string> | null;
};

/** The consent box, entirely from fixed words and the facts above. `words` is the box as one plain
 *  line (what the wallet records); `fingerprint` binds the press to what was shown: if the facts
 *  change before the press, the press does nothing. */
export type Consent = { title: string; does: string; doesNot: string; reverse: string; press: string; pressing: string; words: string; fingerprint: string };

export type Resolved =
  | { armed: true; act: false; label: string; confirm: string; run: Run }
  | { armed: true; act: true; label: string; confirm: string; run: ActRun; consent: Consent }
  | { armed: false; label: string; reason: string };

/** A hash the board may open in the console: short keys, plain values, the shapes parseHash knows. */
const SAFE_HASH = /^#[a-z]{1,4}=[A-Za-z0-9_.:-]{1,64}(&[a-z]{1,4}=[A-Za-z0-9_.:-]{1,64}){0,3}$/;

export const NO_FACTS: BoardFacts = { agentsPaused: null, agentsWorking: null, pausedAgents: null, lapsable: null };

function consentOf(parts: Omit<Consent, 'words'>): Consent {
  return { ...parts, words: [BOARD_ACT.needsOk, parts.title, parts.does, parts.doesNot, parts.reverse].join(' ').replace(/\s+/g, ' ').trim() };
}

function armedAct(label: string, run: ActRun, parts: Omit<Consent, 'words'>): Resolved {
  return { armed: true, act: true, label, confirm: BOARD_ACT.needsOk, run, consent: consentOf(parts) };
}

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
      return armedAct(w.title,
        { kind: 'act', act: 'pause_agents', wire: { act: 'pause_all' }, undoWire: { act: 'resume_all' }, done: w.done, undone: w.undone, undoTitle: w.undoTitle },
        { title: w.title, does: w.does(working), doesNot: w.doesNot, reverse: w.reverse, press: w.press, pressing: w.pressing, fingerprint: `pause_agents|paused=false|working=${working ?? 'unknown'}` });
    }
    case 'pause_agent': {
      const w = BOARD_ACT.pauseOne;
      const slot = a.agent;
      if (slot !== 'negotiator' && slot !== 'shopper' && slot !== 'assistant') return { armed: false, label: BOARD_PROPOSAL.disarmed, reason: BOARD_PROPOSAL.whyDisarmed.badTarget };
      const name = w.name[slot];
      const title = w.title(name);
      if (facts.agentsPaused === null || facts.pausedAgents === null) return { armed: false, label: title, reason: BOARD_ACT.whyDisarmed.pausedUnknown };
      if (facts.agentsPaused) return { armed: false, label: title, reason: BOARD_ACT.whyDisarmed.allPaused };
      if (facts.pausedAgents.includes(slot)) return { armed: false, label: title, reason: BOARD_ACT.whyDisarmed.agentPaused };
      return armedAct(title,
        { kind: 'act', act: 'pause_agent', wire: { act: 'pause_agent', agent: slot }, undoWire: { act: 'resume_agent', agent: slot }, done: w.done(name), undone: w.undone(name), undoTitle: w.undoTitle(name) },
        { title, does: w.does(w.role[slot]), doesNot: w.doesNot, reverse: w.reverse, press: w.press(name), pressing: w.pressing, fingerprint: `pause_agent|${slot}|paused=false` });
    }
    case 'let_lapse': {
      const w = BOARD_ACT.lapse;
      const k = byId.get(a.deal_id);
      if (!k) return { armed: false, label: BOARD_PROPOSAL.disarmed, reason: BOARD_ACT.whyDisarmed.gone };
      const title = w.title(k.label);
      if (facts.lapsable === null || k.fate !== 'needs' || !facts.lapsable.has(k.id)) return { armed: false, label: title, reason: BOARD_ACT.whyDisarmed.notLapsable };
      return armedAct(title,
        { kind: 'act', act: 'let_lapse', wire: { act: 'let_lapse', deal_id: k.id }, undoWire: { act: 'lapse_undo', deal_id: k.id }, done: w.done(k.label), undone: w.undone(k.label), undoTitle: w.undoTitle },
        { title, does: w.does, doesNot: w.doesNot, reverse: w.reverse, press: w.press, pressing: w.pressing, fingerprint: `let_lapse|${k.id}|deadline=${k.deadline_s ?? 'none'}` });
    }
    default:
      return { armed: false, label: BOARD_PROPOSAL.disarmed, reason: BOARD_PROPOSAL.whyDisarmed.badTarget };
  }
}

/** Whether the undo of a pressed act still has something to undo, from the wallet's facts. */
export function undoAvailable(run: ActRun, facts: BoardFacts): boolean {
  switch (run.wire.act) {
    case 'pause_all': return facts.agentsPaused === true;
    case 'pause_agent': return !!facts.pausedAgents?.includes(run.wire.agent);
    case 'let_lapse': return true;
    default: return false;
  }
}
