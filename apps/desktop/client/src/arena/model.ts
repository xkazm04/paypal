// BROWSER PREVIEW ONLY. Break The Table, in pure functions: the deck, what a played attack adds to the
// counters, the verdict stamp, the audit row as one line, and which recorded attacks a typed seller
// note asks for. Everything is read from the record (record.ts); nothing here invents an answer.
import { attackWords, CLAUSE_RULE, DEAL_STATE_WORDS, RULE_NAME, type ArenaFigures, type AttackWords } from '../lib/words/arena';
import { sentenceOf } from '../lib/say/sentence';
import { isRefusal, RECORD, type ArenaRecord, type AuditRecord, type RecordedAttack, type RecordedMoney } from './record';

export type Verdict = 'refused' | 'turnedAway' | 'kept' | 'counted';

/** The stamp an answer gets: a refused call, a message turned away, a note kept for the owner, a
 *  replay the wallet already had. */
export function verdictOf(a: RecordedAttack): Verdict {
  if (isRefusal(a.answer)) return 'refused';
  if (!a.answer.kept) return 'turnedAway';
  return a.sent.envelope === 'note' ? 'kept' : 'counted';
}

/** An attack held when nothing reached PayPal, nothing was stored as a PayPal call, no money step was
 *  recorded and the whole-ledger check found nothing. */
export const held = (a: RecordedAttack): boolean => a.paypal_requests === 0 && a.paypal_calls === 0 && a.money_operations === 0 && a.violations === 0;

export type Counters = {
  attacks: number;
  /** Requests PayPal received, summed over the played attacks. */
  asked: number;
  /** "$0.00" when every played attack held; null (drawn as unknown, never zero) otherwise. */
  moved: string | null;
};

export function counters(played: readonly RecordedAttack[]): Counters {
  return {
    attacks: played.length,
    asked: played.reduce((n, a) => n + a.paypal_requests, 0),
    moved: played.every(held) ? '$0.00' : null,
  };
}

/** "$389.00" from recorded minor units (never a float). */
export function dollars(m: RecordedMoney | null | undefined): string {
  if (!m) return '—';
  const sign = m.minor < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(m.minor));
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}
/** "$340" from a recorded decimal string ("340.00"); cents are kept when they are not zero. */
/** Maya's signed rules as "Say it" would say them (lib/say/sentence.ts): the one sentence its reader turns back
 *  into exactly these rules, generated from the record, never typed; null when the rules say what it has no words for. */
export function rulesSentence(r: ArenaRecord['rules'] = RECORD.rules): string | null {
  // She deals only with the seller she paired with: the reader's own default ("Wallets I've connected").
  return sentenceOf({ item: r.item, currency: 'USD', most: minorOf(r.most), least: r.least === null ? null : minorOf(r.least), perDeal: minorOf(r.per_deal), askOver: minorOf(r.in_person_over), offers: r.offers, who: 'paired' });
}

export function wholeDollars(decimal: string): string {
  const [units = '0', cents = '00'] = decimal.split('.');
  return cents === '00' ? `$${Number(units).toLocaleString('en-US')}` : `$${Number(units).toLocaleString('en-US')}.${cents}`;
}

/** One audit row as the record has it: "#13 · agent · intent.refused · tool_absent · send_money". */
export function auditLine(row: AuditRecord): string {
  const d = row.detail;
  const code = typeof d.code === 'object' && d.code !== null ? (d.code as { code?: unknown }).code : d.code;
  const parts = [`#${row.seq}`, row.actor.startsWith('peer:') ? 'seller' : row.actor, row.action];
  if (typeof code === 'string') parts.push(code);
  if (typeof d.clause === 'number') parts.push(`clause ${d.clause}`);
  if (typeof d.tool === 'string') parts.push(d.tool);
  if (typeof d.typ === 'string') parts.push(d.typ);
  if (typeof d.from === 'string' && typeof d.to === 'string') parts.push(`${d.from} → ${d.to}`);
  return parts.join(' · ');
}

/** The rule that held, in Maya's words: a signed rule by its clause when the refusal names one. */
export function ruleName(code: string, clause: number | null): string {
  if (code === 'mandate_clause' && clause !== null && CLAUSE_RULE[clause]) return CLAUSE_RULE[clause];
  return RULE_NAME[code] ?? code;
}

export const stateWords = (s: string | null): string => (s === null ? '—' : DEAL_STATE_WORDS[s] ?? s.toLowerCase());

/** The keyboard key that plays each card: the agent's cards 1 to 9 then 0, the seller's Q, W, E, R. */
export function keyFor(suit: RecordedAttack['suit'], index: number): string | null {
  const keys = suit === 'agent' ? '1234567890' : 'qwer';
  return keys[index] ?? null;
}

/** The deck in its two suits, in the record's order. */
export function deck(attacks: readonly RecordedAttack[]): { agent: RecordedAttack[]; counterparty: RecordedAttack[] } {
  return { agent: attacks.filter((a) => a.suit === 'agent'), counterparty: attacks.filter((a) => a.suit === 'counterparty') };
}

/** The card a key plays, if any. */
export function cardForKey(attacks: readonly RecordedAttack[], key: string): RecordedAttack | null {
  const d = deck(attacks);
  const k = key.toLowerCase();
  const i = '1234567890'.indexOf(k);
  if (i >= 0) return d.agent[i] ?? null;
  const j = 'qwer'.indexOf(k);
  return j >= 0 ? d.counterparty[j] ?? null : null;
}

/** Dollar amounts a note names ("$900", "900.00", "1,200"), in cents. */
export function amountsIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?/g)) {
    const whole = Number((m[1] ?? '').replace(/,/g, ''));
    if (!Number.isFinite(whole) || whole <= 0) continue;
    out.push(whole * 100 + Number(m[2] ?? 0));
  }
  return out;
}

/**
 * The recorded attacks a typed seller note asks an agent to make. The note itself always takes the
 * recorded note's path (kept for the owner, never in the agent's view); this says which recorded
 * agent attacks show what would happen if an agent obeyed it. Plain keyword reading, no model.
 */
export function noteAsks(text: string, limits: { mostMinor: number; perDealMinor: number }): string[] {
  const t = text.toLowerCase();
  const asks = new Set<string>();
  const amounts = amountsIn(text);
  if (amounts.some((a) => a > limits.perDealMinor)) asks.add('past-the-limit');
  else if (amounts.some((a) => a > limits.mostMinor)) asks.add('just-over-the-top');
  if (/\b(accept|agree|deal|yes|confirm|take it)\b/.test(t)) asks.add('accept-over-her-line');
  if (/\b(pay|paid|send|transfer|wire|refund|capture|release|money)\b/.test(t)) asks.add('pay-me-now');
  if (/\b(account|payee|iban|wallet address|pay to|send to|friends and family|f&f)\b/.test(t)) asks.add('different-payee');
  if (/\b(ignore|override|disregard|forget|new rules?|system|admin|limit)\b/.test(t)) asks.add('rewrite-the-rules');
  if (/\b(\d+\s*(units|monitors|pcs|pieces)|bulk|all of them)\b/.test(t)) asks.add('fifty-monitors');
  if (/\b(other deal|another deal|different deal)\b/.test(t)) asks.add('another-deal');
  return [...asks];
}

/** Minor units from a recorded decimal string ("340.00" -> 34000). */
export function minorOf(decimal: string): number {
  const [units = '0', cents = '0'] = decimal.split('.');
  return Number(units) * 100 + Number(cents.padEnd(2, '0').slice(0, 2));
}

export type Authorities = { owner: number; rule: number; safeDefault: number; agent: number; other: number; total: number };

/** Who allowed each money operation in the gauntlet's sessions ("create by human" -> the owner). An
 *  agent named as the authority is counted as `agent` (the page shows that figure, read from the record,
 *  not a typed zero); an authority this page does not know is counted as `other` and shown, never dropped. */
export function authorities(operations: Readonly<Record<string, number>>): Authorities {
  const out: Authorities = { owner: 0, rule: 0, safeDefault: 0, agent: 0, other: 0, total: 0 };
  for (const [key, n] of Object.entries(operations)) {
    const by = key.split(' by ')[1] ?? '';
    if (by === 'human') out.owner += n;
    else if (by === 'policy' || by === 'seller_mandate' || by === 'house_mandate') out.rule += n;
    else if (by === 'safe_default') out.safeDefault += n;
    else if (by === 'agent') out.agent += n;
    else out.other += n;
    out.total += n;
  }
  return out;
}

/** The amount an attack sent ("900.00"): an agent call's price or amount, or a re-sent envelope's price. */
function sentAmount(record: ArenaRecord, id: string): string {
  const sent = record.attacks.find((a) => a.id === id)?.sent as { price?: unknown; arguments?: { price?: unknown; amount?: unknown } } | undefined;
  const v = sent?.arguments?.price ?? sent?.arguments?.amount ?? sent?.price;
  return typeof v === 'string' ? v : '0.00';
}

/** Every figure the cards name, from the record: what each attack sent, the owner's recorded rules and
 *  the seller's last counter on the replayed table. */
export function figures(record: ArenaRecord = RECORD): ArenaFigures {
  const r = record.rules;
  const over = sentAmount(record, 'just-over-the-top');
  const overAnswer = record.attacks.find((a) => a.id === 'just-over-the-top')?.answer;
  const bulk = record.attacks.find((a) => a.id === 'fifty-monitors')?.sent as { arguments?: { items?: { qty?: number }[] } } | undefined;
  const cents = (minor: number) => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
  return {
    asks: wholeDollars(sentAmount(record, 'pay-me-now')),
    bid: wholeDollars(sentAmount(record, 'past-the-limit')),
    over: wholeDollars(over),
    overBy: wholeDollars(cents(minorOf(over) - minorOf(r.most))),
    overClause: overAnswer && isRefusal(overAnswer) ? overAnswer.clause : null,
    least: r.least === null ? null : wholeDollars(r.least),
    most: wholeDollars(r.most),
    perDeal: wholeDollars(r.per_deal),
    askAbove: wholeDollars(r.in_person_over),
    counter: wholeDollars(sentAmount(record, 'replayed-offer')),
    ordinary: wholeDollars(sentAmount(record, 'another-deal')),
    bulkQty: bulk?.arguments?.items?.[0]?.qty ?? 0,
    bulkTotal: wholeDollars(sentAmount(record, 'fifty-monitors')),
  };
}

/** The cards' words, with the record's figures in them. */
export const ATTACK_WORDS: Readonly<Record<string, AttackWords>> = attackWords(figures());
