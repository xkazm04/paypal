// The one client mirror of Rust's MandatePayload::validate (table-core mandate.rs), pinned to the
// wallet's own source: a reason or a clause number Rust gains that the client does not know turns
// this suite red instead of letting the editor, the mock and the wallet drift apart.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Clause } from '@bindings/Clause';
import type { MandatePayload } from '@bindings/MandatePayload';
import { buildScaleState, SCALE_NOW } from '../mock/scale';
import { mockValidate } from '../mock/simulate';
import { buildMandate, fromLocalInput, previewClauses, refusalWords, ruleProblems, toLocalInput, type MandateDraft } from '../windows/approval/mandateDraft';
import { templateDraft } from '../windows/approval/templates';
import type { DealKind } from '@bindings/DealKind';
import type { Role } from '@bindings/Role';
import type { Side } from '@bindings/Side';
import { CLAUSE_NUMBER, REASON_WORDS, roleActs, roleSide, VALIDATE_REASONS, validateRules } from './mandateRules';

// Resolved from this file, not from the working directory, so any runner location finds it.
const MANDATE_RS = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../crates/table-core/src/mandate.rs');

/** Rust source without its comments (string literals kept as they are). */
function stripComments(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 1;
    } else out += c;
  }
  return out;
}
const RS = stripComments(readFileSync(MANDATE_RS, 'utf8'));
const slice = (from: string, to: string): string => {
  const a = RS.indexOf(from);
  const b = RS.indexOf(to, a + from.length);
  if (a < 0 || b < 0) throw new Error(`mandate.rs no longer has ${from} … ${to}`);
  return RS.slice(a, b);
};
const snake = (s: string) => s.replace(/[A-Z]/g, (m, i) => (i ? '_' : '') + m.toLowerCase());

const T = 1_800_000_000;
const usd = (minor: number) => ({ minor, currency: 'USD' as const });
const payload = (clauses: Clause[]): MandatePayload => ({ id: 'M-1', version: 1, agent_key: [], clauses, not_before: T, expires: T + 30 * 86400 }) as unknown as MandatePayload;
const rescue = (lever: Extract<Clause, { type: 'lever' }> | null): Clause[] => [
  { type: 'roles', roles: ['rescue'] },
  { type: 'counterparties', rule: { type: 'subscribers' } },
  { type: 'per_deal', kind: 'rescue', max_amount: usd(3000), categories: ['service'] },
  { type: 'velocity', max_deals_day: 40, max_total_day: usd(60000) },
  { type: 'human_present_over', amount: usd(5000) },
  { type: 'payees', payees: ['hana-print-shop'] },
  ...(lever ? [lever] : []),
];
const discount = (o: Partial<Extract<Clause, { type: 'lever' }>> = {}): Extract<Clause, { type: 'lever' }> => ({ type: 'lever', levers: ['DISCOUNT_THIS_CYCLE'], max_discount_bp: 2000, max_discount: usd(500), ...o });

describe('pinned to the wallet’s own validate()', () => {
  it('knows every reason validate() can give, with its clause, and has words for each', () => {
    const body = slice('pub fn validate(', 'pub fn check(');
    const found = [...body.matchAll(/Refusal::new\(\s*([^,]+?)\s*,\s*"([^"]*)"\s*,?\s*\)/g)].map((m) => ({ clause: /^\d+$/.test(m[1]!) ? Number(m[1]) : null, reason: m[2]! }));
    expect(found.length).toBeGreaterThan(20);
    expect([...new Set(VALIDATE_REASONS.map((r) => r.reason))].sort()).toEqual([...new Set(found.map((r) => r.reason))].sort());
    for (const f of found) {
      if (f.clause !== null) expect(VALIDATE_REASONS, f.reason).toContainEqual({ clause: f.clause, reason: f.reason });
      expect((REASON_WORDS as Record<string, string>)[f.reason], f.reason).toBeTruthy();
    }
  });
  it('numbers the clauses as Clause::number does', () => {
    const body = slice('pub const fn number(', '\n    }\n}');
    const arms = Object.fromEntries([...body.matchAll(/Self::(\w+)\s*\{\s*\.\.\s*\}\s*=>\s*(\d+)/g)].map((m) => [snake(m[1]!), Number(m[2])]));
    expect(Object.keys(arms).length).toBe(9);
    expect(CLAUSE_NUMBER).toEqual(arms);
  });
  it('lets a role act on exactly the sides and deal kinds role_acts does, on the side role_side gives', () => {
    const acts = slice('fn role_acts(', '\n}');
    const allowed = new Set<string>();
    for (const m of acts.matchAll(/\(\s*Role::(\w+)\s*,\s*Side::(\w+)\s*,\s*([^)]*?)\s*,?\s*\)/g)) {
      for (const kind of m[3]!.split('|').map((k) => k.trim().replace(/^DealKind::/, ''))) allowed.add(`${snake(m[1]!)} ${snake(m[2]!)} ${snake(kind)}`);
    }
    expect(allowed.size).toBeGreaterThan(5);
    const ROLES: Role[] = ['buy', 'sell', 'shop', 'rescue'];
    const SIDES: Side[] = ['buyer', 'seller'];
    const KINDS: DealKind[] = ['purchase', 'haggle', 'shop_order', 'rescue', 'invoice'];
    for (const role of ROLES) for (const side of SIDES) for (const kind of KINDS) {
      expect(roleActs(role, side, kind), `${role} ${side} ${kind}`).toBe(allowed.has(`${role} ${side} ${kind}`));
    }
    const side: Record<string, string> = {};
    for (const arm of slice('fn role_side(', '\n}').matchAll(/([^{,]*?)=>\s*Side::(\w+)/g)) {
      for (const r of arm[1]!.matchAll(/Role::(\w+)/g)) side[snake(r[1]!)] = snake(arm[2]!);
    }
    expect(Object.fromEntries(ROLES.map((r) => [r, roleSide(r)]))).toEqual(side);
  });
});

describe('the rescue fixes rule, as the wallet refuses it at signing', () => {
  const shopWithFixes: Clause[] = [
    { type: 'roles', roles: ['shop'] },
    { type: 'counterparties', rule: { type: 'pinned', keys: ['k-1'] } },
    { type: 'per_deal', kind: 'shop_order', max_amount: usd(50000), categories: ['office'] },
    { type: 'band', item_refs: ['monitor-arm'], floor: usd(100), ceiling: null, max_rounds: 6, deadline: T + 86400 },
    { type: 'velocity', max_deals_day: 40, max_total_day: usd(600000) },
    { type: 'human_present_over', amount: usd(25000) },
    { type: 'payees', payees: ['hana-print-shop'] },
    discount(),
  ];
  it('a shop rule with a fixes clause: the rescue role and the fixes clause go together', () => {
    const want = { clause: 8, reason: 'the rescue role and the fixes clause go together' };
    expect(validateRules(payload(shopWithFixes))).toContainEqual(expect.objectContaining(want));
    expect(mockValidate(payload(shopWithFixes))).toEqual(want);
  });
  it('a fix nothing can carry out is refused', () => {
    const p = payload(rescue(discount({ levers: ['DISCOUNT_THIS_CYCLE', 'PAUSE'] })));
    expect(validateRules(p)).toContainEqual(expect.objectContaining({ clause: 8, reason: 'only the discount this cycle is available' }));
    expect(mockValidate(p)).toEqual({ clause: 8, reason: 'only the discount this cycle is available' });
  });
  it('the discount cap counts in the one-currency rule', () => {
    const p = payload(rescue(discount({ max_discount: { minor: 500, currency: 'EUR' } })));
    expect(validateRules(p)).toContainEqual(expect.objectContaining({ clause: 8, reason: 'currency differs across clauses' }));
    expect(mockValidate(p)).toEqual({ clause: 8, reason: 'currency differs across clauses' });
    expect(validateRules(payload(rescue(discount())))).toEqual([]);
  });
});

describe('the scale worlds sign only what the wallet accepts', () => {
  it.each(['small', 'large'] as const)('%s: every signed rule validates', (scale) => {
    for (const m of buildScaleState(scale, SCALE_NOW).mandates) expect(validateRules(m.payload), `${m.payload.id} v${m.payload.version}`).toEqual([]);
  });
});

// Six drafts the editor and the wallet must read alike.
const NOW = 1_800_000_000;
const fill = { payees: ['packrite-supply', 'HOUSE'], item: 'monitor-24-ips' };
const careful = templateDraft('careful', NOW, fill);
const haggle = templateDraft('haggle', NOW, fill);
const GOLDEN: Record<string, MandateDraft> = {
  'valid careful template': careful,
  'missing payees': { ...careful, clauses: careful.clauses.filter((c) => c.type !== 'payees') },
  'haggle without band': { ...haggle, clauses: haggle.clauses.filter((c) => c.type !== 'band') },
  'sell on purchase': { ...careful, clauses: careful.clauses.map((c) => (c.type === 'roles' ? { ...c, roles: ['sell'] } : c)) },
  'rescue without lever': {
    ...careful, agent: 'assistant', clauses: [
      { type: 'roles', roles: ['rescue'] }, { type: 'counterparties', rule: 'subscribers', keys: '' },
      { type: 'per_deal', kind: 'rescue', max: '30.00', categories: ['service'] }, { type: 'velocity', deals: '40', total: '600.00' },
      { type: 'human_present_over', amount: '50.00' }, { type: 'payees', payees: 'hana-print-shop' },
    ],
  },
  'band ending after the rules': { ...haggle, clauses: haggle.clauses.map((c) => (c.type === 'band' ? { ...c, deadline: toLocalInput(NOW + 40 * 86400) } : c)) },
};
const editor = (d: MandateDraft) => ruleProblems(previewClauses(d), fromLocalInput(d.notBefore), fromLocalInput(d.expires));
/** The editor's words for these drafts as they read before the mirrors were folded into one (b563874). */
const WORDING: Record<string, { clause: number; why: string }[]> = {
  'valid careful template': [],
  'missing payees': [{ clause: 7, why: '“Approved payees” is required' }],
  'haggle without band': [{ clause: 4, why: 'haggles and shop orders need a price range' }],
  'sell on purchase': [{ clause: 1, why: 'none of what you allowed agents to do fits this kind of deal, so nothing would ever be allowed' }],
  'rescue without lever': [{ clause: 8, why: 'rescuing renewals needs “Fixes for failed renewals”' }],
  'band ending after the rules': [{ clause: 4, why: 'it ends after the rules themselves end' }],
};

describe('the editor footer and the wallet agree', () => {
  for (const [name, d] of Object.entries(GOLDEN)) {
    it(`${name}: the same rules are at fault`, () => {
      const built = buildMandate(d);
      if (!built.ok) throw new Error(`${name} must build: ${built.errors.join('; ')}`);
      const wallet = validateRules({ ...payload(built.clauses), not_before: built.notBefore, expires: built.expires });
      expect(new Set(editor(d).map((p) => p.clause))).toEqual(new Set(wallet.map((r) => r.clause)));
    });
    // guard: folding the mirrors keeps the editor's own detailed words, not Rust's terse reasons
    it(`${name}: the editor's words are unchanged`, () => {
      expect(editor(d)).toEqual(WORDING[name]);
    });
  }
});

describe('a refusal from signing, in plain words', () => {
  it('every reason validate() gives reads as a sentence with no rule number and no internal term', () => {
    const fallback = refusalWords('mandate clause 1: something new');
    for (const { clause, reason } of VALIDATE_REASONS) {
      const t = refusalWords(`mandate clause ${clause ?? 3}: ${reason}`);
      expect(t, reason).not.toBe(fallback);
      expect(t, reason).not.toMatch(/clause|mandate|\brole\b|band|velocity|payee allowance/);
      expect(t.endsWith('.'), reason).toBe(true);
    }
  });
});
