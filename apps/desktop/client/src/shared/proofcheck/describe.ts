// How the checker's screen words its lines and changes: what a dashed line says, what a tamper does in numbers
// a person recognises, what a hand edit changed, and the report as plain text. Pure; the words are in lib/words.
import { formatMoney } from '../../lib/format';
import type { CheckLine } from '../../lib/proof/checks';
import { readAt } from '../../lib/proof/edits';
import type { editsFor, TamperId } from '../../lib/proof/tamper';
import { PROOF_CHECKER as W, PROOF_CHECKS, PROOF_NOT_APPLICABLE, PROOF_NOT_CHECKED, PROOF_NOTHING, PROOF_NOTHING_SAID } from '../../lib/words';

/** The reason a dashed line is dashed: nothing of its kind in the deal, or a check not made. */
export function dashedWords(line: CheckLine): string {
  if (vacuous(line)) return PROOF_NOTHING[line.id] ?? W.nothing;
  if (!line.applies) return PROOF_NOT_APPLICABLE[line.id] ?? PROOF_CHECKER_OLDER;
  if (line.detail.includes('cannot check Ed25519')) return W.noEd25519;
  if (line.detail.includes('this page does not') || line.detail.includes('this page ran into')) return W.notYetBuilt;
  return PROOF_NOT_CHECKED;
}
const PROOF_CHECKER_OLDER = 'Not checked: files saved by older versions of the wallet don’t carry this record.';

export type Kind = 'ok' | 'bad' | 'dashed';
/** A line the verifier passed because the file has nothing of its kind (no approval, no money step, no PayPal
 *  order): shown dashed, never as a tick that claims something was compared. */
export const vacuous = (line: CheckLine): boolean => line.ok && PROOF_NOTHING_SAID[line.id]?.test(line.detail) === true;
export const kindOf = (line: CheckLine): Kind => (vacuous(line) ? 'dashed' : line.ok ? 'ok' : line.checked && line.applies ? 'bad' : 'dashed');

/** Every place two files differ, as a path with what was there and what is there now. */
function changes(before: unknown, after: unknown, path = ''): Array<{ path: string; before: unknown; after: unknown }> {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
  if (object(before) && object(after) && Array.isArray(before) === Array.isArray(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap((k) => changes(before[k], after[k], `${path}/${k}`));
  }
  return [{ path, before, after }];
}
const brief = (v: unknown): string => {
  const text = typeof v === 'string' ? v : JSON.stringify(v) ?? '—';
  return text.length > 36 ? `${text.slice(0, 35)}…` : text;
};


/** What a tamper does to this file, in numbers a person recognises. */
export function caption(tid: TamperId, doc: unknown, edits: ReturnType<typeof editsFor> & object): string {
  const first = edits[0];
  if (!first) return '';
  const before = readAt(doc, first.path);
  const currency = String(readAt(doc, '/deal/terms/unit_price/currency') ?? 'USD');
  const money = (minor: unknown): string => (typeof minor === 'number' ? formatMoney({ minor, currency } as Parameters<typeof formatMoney>[0]) : '—');
  switch (tid) {
    case 'price':
    case 'receipt':
    case 'rules':
      return `${money(before)} → ${money(first.value)}`;
    case 'paypal-amount':
      return `${String(before)} → ${String(first.value)} ${currency}`;
    case 'payee':
      return `${String(before)} → ${String(first.value)}`;
    case 'audit-line':
      return 'one number, a deadline moved later';
    case 'audit-gap':
      return first.path.replace('/audit/', 'record ').replace(/^record (\d+)$/, (_m, n: string) => `one of the ${(readAt(doc, '/audit') as unknown[]).length} records, the ${Number(n) + 1}th, removed`);
    case 'signature':
      return 'message 3, its signature’s first character';
    case 'refund':
      return 'a call to refund the capture';
    case 'owner-key':
      return 'the buyer’s owner key in its place';
    case 'shield-release':
      return 'the owner’s release of the safety hold, removed';
    case 'market-price':
      return `${money(before)} → ${money(first.value)}, the lowest comparable`;
    case 'group-winner':
      return 'the other table named the winner';
    case 'group-agreed':
      return 'the other table: withdrawn → receipted';
    case 'request-id':
      return `${String(before).slice(0, 14)}… → a-second-request-id`;
    default:
      return '';
  }
}
/** How many values a hand edit changed, with the first one. */
export function changed(before: unknown, after: unknown): string {
  if (after === null) return W.editedByHand;
  const all = changes(before, after);
  const [first] = all;
  if (!first) return W.editedByHand;
  return all.length === 1 ? `${brief(first.before)} → ${brief(first.after)}` : `${all.length} values, by hand (the first: ${brief(first.before)} → ${brief(first.after)})`;
}

// ---- the verdict, the lines, what the file says -----------------------------------------------

/** The report as plain text, to paste somewhere: one line per check, the checker's own line under each. */
export function reportText(name: string, lines: ReadonlyArray<CheckLine | null>, verdict: string): string {
  const mark = (l: CheckLine): string => (kindOf(l) === 'ok' ? '✓' : kindOf(l) === 'bad' ? '✗' : '–');
  const body = lines.flatMap((l) => (l ? [`${mark(l)} ${PROOF_CHECKS[l.id] ?? l.id}\n    ${l.detail}`] : []));
  return [name, verdict, '', ...body, '', 'Checked in the browser, not by the wallet. Compare the owner key with the one the owner shows you.'].join('\n');
}

