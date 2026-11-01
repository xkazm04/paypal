// The assistant wire contract (conversational home). ONE authority for the vocabulary the assistant
// may speak: the closed panel kinds, the closed UI ops and the allowlisted action references. The
// emitter (scripted engine or the claude-code bridge) produces an `AssistantReply`; the validator
// (validate.ts, the single door) turns it into a `ValidatedReply`; the board (windows/main/switchboard)
// only ever sees a ValidatedReply. A reply is a PROPOSAL: rendering it never executes anything.
// Absent-value convention for the whole feature: a value that is not known is `null` (never 0, never
// omitted); the UI shows it dashed, "not available yet".
import type { ApprovalTarget } from '@bindings/ApprovalTarget';
import type { Module } from '@bindings/Module';

export const ASSISTANT_V = 1 as const;

/** What is happening to a deal's money: the four columns of the switchboard. */
export type Fate = 'needs' | 'moving' | 'stopped' | 'paid';
export const FATES: readonly Fate[] = ['needs', 'moving', 'stopped', 'paid'];
export const MODULE_KEYS: readonly Module[] = ['tables', 'spend', 'counter', 'book', 'shield', 'rescue'];

/** Closed set of answer panels. Each is a thin read of an existing command (see docs). */
export const PANEL_KINDS = ['needs', 'decision', 'deal', 'money', 'rules', 'rescue', 'safety', 'book', 'week', 'setup'] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];

export type PanelSpec =
  | { kind: 'needs'; module: Module | null }
  | { kind: 'decision'; deal_id: string }
  | { kind: 'deal'; deal_id: string }
  | { kind: 'money' }
  | { kind: 'rules'; module: Module | null }
  | { kind: 'rescue' }
  | { kind: 'safety' }
  | { kind: 'book'; module: Module | null; fate: Fate | null }
  | { kind: 'week' }
  | { kind: 'setup' };

/** Allowlisted actions. A reference + typed identity only (no free text, no code). No action moves
 *  money or signs: those hand off to the approval window through `approval_open`.
 *  Two classes (ACTION_CLASS in vocabulary.ts): a `handoff` opens something and changes nothing; an
 *  `act` changes the wallet in a small, reversible way, and only after the owner's explicit press on
 *  a consent box the HOST draws (docs/design/conversational-home-safe-acts.md). The one act is
 *  `pause_agents`, which can only make the wallet do less. */
export type ActionRef =
  | { action: 'open_decision'; deal_id: string }
  | { action: 'open_setup'; target: Extract<ApprovalTarget, 'credentials' | 'mandate' | 'unlock'> }
  | { action: 'open_console'; hash: string }
  | { action: 'pause_agents' };

export type UiOp =
  /** Put an answer panel in the answer area (replaces the current one). */
  | { op: 'show'; panel: PanelSpec }
  /** Light up a module row, a fate column, a cell or a deal on the board (never hides anything). */
  | { op: 'focus'; module: Module | null; fate: Fate | null; deal_id: string | null }
  /** Dim everything that is not this module and/or fate. Both null clears. */
  | { op: 'filter'; module: Module | null; fate: Fate | null }
  /** A proposal button. The host resolves it and arms it through the consent hand-off; text is `why`. */
  | { op: 'propose'; action: ActionRef; why: string };

/** What an engine returns (before validation). Untrusted, whoever wrote it. */
export type AssistantReply = { v: typeof ASSISTANT_V; say: string; ops: UiOp[] };

export type Dropped = { count: number; reasons: string[] };
/** What the board renders. `dropped.count > 0` is disclosed in the UI ("2 parts could not be shown"). */
export type ValidatedReply = { say: string; ops: UiOp[]; dropped: Dropped; repaired: boolean };

/** One deal as the board shows it; produced by windows/main/switchboard (useBoardModel), consumed by
 *  digest.ts, scripted.ts and the panel renderer. `label` is the owner-visible deal label (untrusted
 *  text is already quarantined/cut upstream; the digest cuts it again). */
export type BoardDeal = {
  id: string;
  module: Module;
  fate: Fate;
  label: string;
  state_word: string;
  amount_minor: number | null;
  currency: string | null;
  deadline_ms: number | null;
  on_silence: string | null;
};

/** The numbers the instrument strip shows; all minor units; null = not available. */
export type BoardMoney = {
  room_left_minor: number | null;
  day_cap_minor: number | null;
  held_minor: number | null;
  paid_today_minor: number | null;
  deals_today: number | null;
  deals_cap: number | null;
  currency: string | null;
};

export type BoardSetupStep = { key: 'paypal' | 'rules' | 'practice' | 'engine'; done: boolean | null };

/** Everything the assistant is allowed to know. No counterparty free text, no ids of secrets. */
export type DigestInput = {
  now_ms: number;
  first_run: boolean;
  deals: BoardDeal[];
  money: BoardMoney;
  rules_in_force: number | null;
  setup: BoardSetupStep[];
};

export type EngineId = 'scripted' | 'claude-code';
export type EngineInfo = { id: EngineId; label: string };

/** An engine produces a raw (untrusted) reply for a question over the digest. */
export interface AssistantEngine {
  readonly info: EngineInfo;
  ask(question: string, input: DigestInput, signal?: AbortSignal): Promise<unknown>;
}

/** Wire format of the dev bridge (scripts/assistantBridge.ts <-> lib/assistant/bridgeEngine). */
export type BridgeRequest = { question: string; digest: DigestInput };
export type BridgeResponse =
  | { ok: true; engine: 'claude-code'; ms: number; reply: unknown }
  | { ok: false; reason: 'unavailable' | 'timeout' | 'bad_output' | 'busy' | 'bad_request' };
export const BRIDGE_PATH = '/__assistant/ask' as const;
