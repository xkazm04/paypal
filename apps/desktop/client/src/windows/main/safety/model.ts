// "Your safety record" in plain words. Every number comes from the wallet's own check of its
// record (safety_record, counted in Rust from the verified chain and each deal's verified
// export); this file only puts them into sentences. A break is never softened: any finding turns
// the whole record red and names the deals.
import type { H256 } from '@bindings/H256';
import type { SafetyMoney } from '@bindings/SafetyMoney';
import type { SafetyRecord } from '@bindings/SafetyRecord';
import type { SafetyRefusalFamily } from '@bindings/SafetyRefusalFamily';
import type { SafetyViolationKind } from '@bindings/SafetyViolationKind';

/** "1,284" (grouped, never a decimal). */
export const count = (n: number): string => Math.max(0, Math.trunc(n)).toLocaleString('en-US');
/** "1 record" / "1,284 records". */
export const plural = (n: number, one: string, many: string): string => `${count(n)} ${n === 1 ? one : many}`;
/** "once" / "twice" / "5 times". */
export const times = (n: number): string => (n === 1 ? 'once' : n === 2 ? 'twice' : `${count(n)} times`);

/** "a, b and c". */
function andList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The colour of who decided a money step: the Rewind's colours (you gold, a rule you signed
 *  teal, the buyer's approval under your shop rules green, a safe default grey). */
export type SafetyTone = 'owner' | 'rule' | 'buyer' | 'default';
export type AuthorityPart = { key: keyof SafetyMoney; tone: SafetyTone; label: string; n: number; words: string };

/** Money steps by who decided them, in a fixed order, only the ones that happened. */
export function authorityParts(m: SafetyMoney): AuthorityPart[] {
  const cancelled = m.safe_default > 0 && m.safe_default_voids === m.safe_default;
  const all: AuthorityPart[] = [
    { key: 'owner', tone: 'owner', label: 'You', n: m.owner, words: `${count(m.owner)} by you` },
    { key: 'signed_rule', tone: 'rule', label: 'Your rule', n: m.signed_rule, words: `${count(m.signed_rule)} by ${m.signed_rule === 1 ? 'a rule' : 'rules'} you signed` },
    { key: 'house_rules', tone: 'rule', label: 'House seller’s rules', n: m.house_rules, words: `${count(m.house_rules)} by the house seller’s signed rules` },
    { key: 'shop_rules', tone: 'buyer', label: 'Buyer approved', n: m.shop_rules, words: `${count(m.shop_rules)} by your shop rules after the buyer approved` },
    {
      key: 'safe_default', tone: 'default', label: 'Safe default', n: m.safe_default,
      words: cancelled ? `${plural(m.safe_default, 'safe default', 'safe defaults')} that only cancelled` : `${count(m.safe_default)} by a safe default`,
    },
  ];
  return all.filter((p) => p.n > 0);
}

export const moneySteps = (m: SafetyMoney): number => m.owner + m.signed_rule + m.house_rules + m.shop_rules + m.safe_default;

/** Why the wallet said no, by kind, in plain words. */
export const FAMILY_WORDS: Record<SafetyRefusalFamily, string> = {
  your_rules: 'Broke a rule you signed',
  scam_check: 'Stopped by the scam check',
  out_of_turn: 'Out of turn or too late',
  not_allowed: 'Asked for something it may not do',
  unusable: 'A request the wallet couldn’t use',
  older: 'Older records with no reason kept',
};

/** What a finding means, in plain words (the precise finding stays in Details). */
export const VIOLATION_WORDS: Record<SafetyViolationKind, string> = {
  authority: 'A money step was taken without an authority that allows it.',
  untracked_call: 'PayPal was asked to move money with no recorded decision behind it.',
  counterparty_text: 'The other side’s words reached PayPal.',
  refused_deal_called: 'A deal your rules refused reached PayPal.',
  verifier_check: 'The independent check disagrees with the record.',
  chain_broken: 'A record was changed, removed or damaged after it was written.',
  evidence_unreadable: 'This deal’s record doesn’t check out.',
};

export type SafetyWords = {
  /** 'ok' only when the chain is unbroken and nothing was found. */
  tone: 'ok' | 'bad';
  verdict: string;
  /** The headline's sentences, in order: the record, the money, the refusals. */
  lines: string[];
};

/** The record in Maya's words: one verdict and up to three sentences. */
export function safetyWords(r: SafetyRecord): SafetyWords {
  const found = r.violations_total;
  if (!r.intact) {
    return {
      tone: 'bad',
      verdict: 'Your record doesn’t check out.',
      lines: [`${plural(r.records, 'record', 'records')}, and the chain linking them is broken. Nothing in it can be counted until it is fixed.`],
    };
  }
  const lines: string[] = [];
  lines.push(r.records === 0 ? 'Nothing on record yet.' : `${plural(r.records, 'record', 'records')}, unbroken.`);
  const steps = moneySteps(r.money);
  lines.push(steps === 0
    ? 'PayPal hasn’t been asked to move money yet.'
    : `PayPal was asked to move money ${times(steps)}: ${andList(authorityParts(r.money).map((p) => p.words))}.`);
  if (r.refusals === 0) lines.push('Your agents haven’t been refused anything.');
  else if (found === 0 && r.refused_deal_calls === 0) lines.push(`Your agents were refused ${times(r.refusals)}; PayPal was never asked for any of them.`);
  else lines.push(`Your agents were refused ${times(r.refusals)}.`);
  if (found > 0) {
    return {
      tone: 'bad',
      verdict: found === 1 ? 'Something on record broke your safety rules.' : `${count(found)} things on record broke your safety rules.`,
      lines,
    };
  }
  return { tone: 'ok', verdict: 'Nothing moved without your say-so.', lines };
}

/** How much was checked, honestly: every deal, or the newest N of them. */
export function scopeWords(r: SafetyRecord): string {
  if (!r.intact) return 'No deal could be checked.';
  if (r.deals_total === 0) return 'No deals yet.';
  if (r.deals_checked >= r.deals_total) return r.deals_total === 1 ? 'Your one deal was checked.' : `All ${count(r.deals_total)} deals checked.`;
  return `Checked the latest ${count(r.deals_checked)} of ${plural(r.deals_total, 'deal', 'deals')}.`;
}

/** The chain head as hex, in groups of 8 (Details only). */
export function headGroups(h: H256 | null): string[] {
  if (!h) return [];
  const hex = h.map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.match(/.{1,8}/g) ?? [];
}

// ---- the sheet's place in the hash (#…&p=safety), beside the main window's route ----------------

/** True when the hash asks for the safety record ("p=safety"). */
export function safetyInHash(hash: string): boolean {
  return new URLSearchParams(hash.replace(/^#/, '')).get('p') === 'safety';
}
/** `hash` (as formatHash writes it) with the safety record open or not. */
export function withSafety(hash: string, open: boolean): string {
  if (!open) return hash;
  return hash ? `${hash}&p=safety` : '#p=safety';
}
