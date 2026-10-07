// Agent rules, as cards (docs/ux/ROUND-1.md): per signed rule set, the three limits a person checks
// first as short figure + words lines, the agent's name and what the whole sheet answers. Pure:
// from mandate_list entries; display only, nothing here signs or changes a rule.
import type { Clause } from '@bindings/Clause';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import { formatMoney } from '../../../lib/format';
import { kindWord } from '../../../lib/words';

export type Limit = { key: 'per_deal' | 'band' | 'velocity' | 'ask'; value: string; label: string };

/** Which limits make the card, most telling first. */
const PRIORITY: readonly Limit['key'][] = ['per_deal', 'band', 'ask', 'velocity'];
/** Which order they read in on the card. */
const ORDER: readonly Limit['key'][] = ['per_deal', 'band', 'velocity', 'ask'];

function limitOf(key: Limit['key'], clauses: readonly Clause[]): Limit | null {
  for (const c of clauses) {
    if (key === 'per_deal' && c.type === 'per_deal') return { key, value: formatMoney(c.max_amount), label: `most per ${kindWord(c.kind)}` };
    if (key === 'band' && c.type === 'band') {
      if (c.ceiling) return { key, value: formatMoney(c.ceiling), label: 'most you’ll pay' };
      if (c.floor) return { key, value: formatMoney(c.floor), label: 'least you’ll accept' };
    }
    if (key === 'velocity' && c.type === 'velocity') return { key, value: formatMoney(c.max_total_day), label: `a day, up to ${c.max_deals_day} deals` };
    if (key === 'ask' && c.type === 'human_present_over') return { key, value: formatMoney(c.amount), label: 'above this it asks you' };
  }
  return null;
}

/** Up to three limits for a card. A rule set that lacks one (a seller has no "most you'll pay") just shows fewer. */
export function limitLines(clauses: readonly Clause[], n = 3): Limit[] {
  const picked = PRIORITY.map((k) => limitOf(k, clauses)).filter((l): l is Limit => l !== null).slice(0, n);
  return picked.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
}

/** "Shopper" for the agent a rule set is signed for; `kinds` tells apart several sets of one agent. */
export function agentTitle(agent: string, kinds: readonly string[] = []): string {
  const name = agent ? `${agent.charAt(0).toUpperCase()}${agent.slice(1)}` : 'Agent';
  return kinds.length ? `${name} · ${kinds.join(', ')}` : name;
}

export type RuleState = 'active' | 'soon' | 'ended';
export const ruleState = (m: Pick<MandateListEntry['payload'], 'not_before' | 'expires'>, now: number): RuleState =>
  now < m.not_before ? 'soon' : now >= m.expires ? 'ended' : 'active';

export type RulesAnswer = { tone: 'calm' | 'need' | 'done'; title: string; sub: string };

/** "What may my agents do?" in one sentence. Gold when there is nothing signed or a set is not in force. */
export function rulesAnswer(list: readonly MandateListEntry[], now: number): RulesAnswer {
  if (!list.length) return { tone: 'need', title: 'No rules are signed yet', sub: 'Until you sign some, every agent request is refused before PayPal is asked.' };
  // A set the wallet now refuses (refusal) is listed but not in force.
  const inForce = list.filter((m) => ruleState(m.payload, now) === 'active' && m.owner_sig.length > 0 && !m.refusal);
  const off = list.length - inForce.length;
  if (off) return { tone: 'need', title: `${off} rule ${off === 1 ? 'set is' : 'sets are'} not in force`, sub: 'An agent without active rules can’t do anything. Change rules to sign them again.' };
  const agents = new Set(inForce.map((m) => m.agent)).size;
  return { tone: 'done', title: `${agents} ${agents === 1 ? 'agent works' : 'agents work'} inside limits you signed`, sub: 'They can never pass these limits. Only you can change them.' };
}
