// BROWSER PREVIEW ONLY. Break The Table's record: what the real wallet answered to each named attack,
// written by `cargo test -p table-app --test gauntlet arena` (crates/table-app/tests/gauntlet/arena.rs)
// and pinned by the same test, which fails when this file drifts from the wallet. The arena draws
// nothing else: no answer on the page is typed by hand. Pure: types, the record, and reads of it.
import raw from './arena.json';

export type RecordedMoney = { currency: string; minor: number };
export type AuditRecord = { seq: number; at: number; actor: string; action: string; detail: Record<string, unknown> };
export type TableStep = { act: string; by: 'you' | 'them'; price: RecordedMoney | null; seq: number; at: number };

/** The agent's own view of the table (`table_view`), as recorded. */
export type AgentTable = {
  allowed: string[];
  band: { ceiling: RecordedMoney | null; floor: RecordedMoney | null; max_rounds: number; rounds_left: number; rounds_used: number } | null;
  history: TableStep[];
  turn: string;
  phase: string;
  [k: string]: unknown;
};

/** An agent call's answer (the MCP tool result's structured content) or an envelope's fate. */
export type RecordedAnswer =
  | { code: string; clause: number | null; text: string; detail?: string }
  | { kept: boolean; why?: string };

export type RecordedAttack = {
  id: string;
  suit: 'agent' | 'counterparty';
  /** The role the agent's session was started under (agent calls only). */
  as?: string;
  /** What was sent: the MCP `tools/call` params, or the envelope the seller sent. */
  sent: Record<string, unknown>;
  answer: RecordedAnswer;
  refused?: boolean;
  /** Every audit row the attack wrote, read back from the verified export. */
  audit: AuditRecord[];
  /** The agent's own table after a counterparty attack. */
  agent_saw?: AgentTable | null;
  envelopes_out: number;
  paypal_requests: number;
  paypal_calls: number;
  money_operations: number;
  deal: { which: 'haggle' | 'purchase'; before: string | null; after: string | null };
  violations: number;
};

/** The gauntlet's own seeded hostile sessions, summed by the recorder (beside the named attacks). */
export type GauntletSummary = {
  sessions: number;
  first_seed: string;
  agent_calls: number;
  refused: number;
  refusals: Record<string, number>;
  agent_calls_reaching_paypal: number;
  rejected_envelopes: number;
  notes: number;
  /** Money operations, "<operation> by <authority>" -> count. */
  operations: Record<string, number>;
  violations: number;
};

export type ArenaRecord = {
  format: string;
  check: string;
  seed: string;
  rules: { item: string; least: string; most: string; per_deal: string; in_person_over: string; offers: number; payee: string; shop_payee: string };
  table: AgentTable;
  attacks: RecordedAttack[];
  gauntlet: GauntletSummary;
  totals: { attacks: number; paypal_requests: number; paypal_calls: number; money_operations: number };
};

export const RECORD: ArenaRecord = raw as unknown as ArenaRecord;

export const isRefusal = (a: RecordedAnswer): a is Extract<RecordedAnswer, { code: string }> => 'code' in a;

export function attackById(id: string, record: ArenaRecord = RECORD): RecordedAttack | undefined {
  return record.attacks.find((a) => a.id === id);
}
