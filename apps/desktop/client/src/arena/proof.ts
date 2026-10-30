// BROWSER PREVIEW ONLY. "Your attacks, as a file": the attacks a judge played, each with the record the
// wallet wrote for it (record.ts), and the command that replays them all against the wallet. Pure: the
// file is built from the record only, so it says nothing the record does not.
import { counters, held } from './model';
import { RECORD, type ArenaRecord, type RecordedAttack } from './record';

export type ProofFile = {
  format: 'table-arena-session/1';
  /** The command that replays every attack against the wallet and fails if one answer changed. */
  check: string;
  /** The recording these answers come from. */
  recorded: { format: string; seed: string };
  rules: ArenaRecord['rules'];
  summary: { played: number; distinct: number; of: number; held: number; moved: string | null; paypal_requests: number; paypal_calls: number; money_operations: number };
  attacks: { n: number; id: string; suit: RecordedAttack['suit']; sent: RecordedAttack['sent']; answer: RecordedAttack['answer']; audit: RecordedAttack['audit']; paypal_requests: number; paypal_calls: number; money_operations: number }[];
};

export function proofFile(played: readonly RecordedAttack[], record: ArenaRecord = RECORD): ProofFile {
  const c = counters(played);
  return {
    format: 'table-arena-session/1',
    check: record.check,
    recorded: { format: record.format, seed: record.seed },
    rules: record.rules,
    summary: {
      played: played.length,
      distinct: new Set(played.map((a) => a.id)).size,
      of: record.attacks.length,
      held: played.filter(held).length,
      moved: c.moved,
      paypal_requests: c.asked,
      paypal_calls: played.reduce((n, a) => n + a.paypal_calls, 0),
      money_operations: played.reduce((n, a) => n + a.money_operations, 0),
    },
    attacks: played.map((a, i) => ({
      n: i + 1, id: a.id, suit: a.suit, sent: a.sent, answer: a.answer, audit: a.audit,
      paypal_requests: a.paypal_requests, paypal_calls: a.paypal_calls, money_operations: a.money_operations,
    })),
  };
}

export const PROOF_FILE_NAME = 'break-the-table-attacks.json';
