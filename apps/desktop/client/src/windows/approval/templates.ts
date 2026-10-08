// Starting rule sets for a first signature (the mandate editor's first-run state). Each one is only
// a draft in the editor's own strings: the owner sees every limit, may change any of it, and signs
// it in the approval window like any other rules. Rust validates and signs; nothing is signed here.
//
// Two things the wallet cannot know for the owner stay blanks the owner fills before signing:
// who agents may pay (the payee names of the wallets they connected, prefilled from those) and,
// for the haggler, which one item it haggles for.
import type { AgentSlot } from '@bindings/AgentSlot';
import { toLocalInput, type ClauseDraft, type MandateDraft } from './mandateDraft';

export type TemplateKey = 'careful' | 'restock' | 'haggle';
export type RulesTemplate = {
  key: TemplateKey;
  /** The card's name: what the rules do, with the one number that matters most. */
  name: string;
  /** One line under the name, the two or three limits a person checks first. */
  line: string;
  agent: AgentSlot;
};

export const TEMPLATES: readonly RulesTemplate[] = [
  { key: 'careful', name: 'Careful: asks me above $50', line: 'Buys supplies up to $100 each, $150 a day', agent: 'shopper' },
  { key: 'restock', name: 'Shop assistant', line: 'Restocks your shop up to $200 each · asks you above $150', agent: 'shopper' },
  { key: 'haggle', name: 'Haggler for one item', line: 'Haggles for one item, most you’ll pay $250 · asks you above $200', agent: 'negotiator' },
];

/** What the owner still has to add to a template before it can be signed, in plain words. */
export type TemplateBlank = 'payees' | 'item';
export const BLANK_WORDS: Record<TemplateBlank, string> = { payees: 'who they may pay', item: 'which item' };

export type TemplateFill = {
  /** Payee names the agents may pay: the declared payees of the wallets already connected. */
  payees: readonly string[];
  /** The haggler's one item (its item reference). */
  item?: string;
};

const DAY = 86400;

/** The draft a template starts the editor with (USD; valid from now for 30 days). */
export function templateDraft(key: TemplateKey, now: number, fill: TemplateFill): MandateDraft {
  const t = TEMPLATES.find((x) => x.key === key) ?? TEMPLATES[0]!;
  const payees: ClauseDraft = { type: 'payees', payees: [...new Set(fill.payees.map((p) => p.trim()).filter(Boolean))].join(', ') };
  const base = { id: null, agent: t.agent, currency: 'USD' as const, notBefore: toLocalInput(now), expires: toLocalInput(now + 30 * DAY) };
  switch (key) {
    case 'careful':
      return {
        ...base,
        clauses: [
          { type: 'roles', roles: ['buy'] },
          { type: 'counterparties', rule: 'paired', keys: '' },
          { type: 'per_deal', kind: 'purchase', max: '100.00', categories: ['office', 'parts'] },
          { type: 'velocity', deals: '3', total: '150.00' },
          { type: 'human_present_over', amount: '50.00' },
          payees,
        ],
      };
    case 'restock':
      return {
        ...base,
        clauses: [
          { type: 'roles', roles: ['buy'] },
          { type: 'counterparties', rule: 'paired', keys: '' },
          { type: 'per_deal', kind: 'purchase', max: '200.00', categories: ['office', 'parts', 'other'] },
          { type: 'velocity', deals: '10', total: '600.00' },
          { type: 'human_present_over', amount: '150.00' },
          payees,
        ],
      };
    case 'haggle':
      return {
        ...base,
        clauses: [
          { type: 'roles', roles: ['buy'] },
          { type: 'counterparties', rule: 'paired', keys: '' },
          { type: 'per_deal', kind: 'haggle', max: '250.00', categories: ['office'] },
          { type: 'band', items: (fill.item ?? '').trim(), floor: '', ceiling: '250.00', rounds: '6', deadline: toLocalInput(now + 7 * DAY) },
          { type: 'velocity', deals: '2', total: '250.00' },
          { type: 'human_present_over', amount: '200.00' },
          payees,
        ],
      };
  }
}

/** The blanks a template draft still has (empty when it can be reviewed and signed as it is). */
export function templateBlanks(d: MandateDraft): TemplateBlank[] {
  const out: TemplateBlank[] = [];
  if (d.clauses.some((c) => c.type === 'payees' && !c.payees.trim())) out.push('payees');
  if (d.clauses.some((c) => c.type === 'band' && !c.items.trim())) out.push('item');
  return out;
}

/** Payee names of the wallets already connected (counterparty_list), house seller included. */
export function connectedPayees(list: ReadonlyArray<{ declared_payee: string | null }> | null | undefined): string[] {
  return [...new Set((list ?? []).map((c) => c.declared_payee).filter((p): p is string => !!p))];
}
