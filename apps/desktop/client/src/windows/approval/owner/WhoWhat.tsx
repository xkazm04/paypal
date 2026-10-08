// "Who and what": the set-type terms, one row each on Layer 1; the choices open in a popover.
// Also the slot, validity and currency, and adding / removing clause kinds.
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import type { AgentSlot } from '@bindings/AgentSlot';
import type { Currency } from '@bindings/Currency';
import type { DealKind } from '@bindings/DealKind';
import { Btn, Popover } from '../../../shared/ui';
import { CATEGORIES, CLAUSE_KINDS, CLAUSE_NUMBER, emptyClause, KINDS, missingKinds, ROLES, withClause, type ClauseDraft, type ClauseType, type MandateDraft } from '../mandateDraft';

const CURRENCIES: readonly Currency[] = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'CZK', 'PLN', 'SEK', 'NOK', 'DKK', 'NZD', 'HUF', 'JPY'];
const SLOTS: readonly AgentSlot[] = ['negotiator', 'shopper', 'assistant'];
const RULES = [
  ['paired', 'any wallet you connected (four words checked)'],
  ['pinned', 'only wallets you list by key'],
  ['house', 'only the house seller'],
  ['subscribers', 'only your own subscribers (fixing failed renewals)'],
] as const;

type Key = 'slot' | 'valid' | 'add' | `c${number}`;

function WRow({ n, label, value, changed, onOpen }: { n: ReactNode; label: string; value: string; changed: boolean; onOpen: (el: HTMLElement) => void }) {
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(e.currentTarget);
    }
  };
  return (
    <div className={`ui-row act ${changed ? 'chg' : ''}`} role="button" tabIndex={0} aria-haspopup="dialog" onClick={(e) => onOpen(e.currentTarget)} onKeyDown={key}>
      <span className="cn">{n}</span>
      <span className="lbl">{label}</span>
      <span className="val" title={value}>{value}</span>
      <span className="chev" aria-hidden="true" />
    </div>
  );
}

function Checks<T extends string>({ all, on, set, names }: { all: readonly T[]; on: readonly T[]; set: (v: T[]) => void; names?: Partial<Record<T, string>> }) {
  return (
    <div className="ow-picks" role="group">
      {all.map((v) => (
        <label key={v} className="pick">
          <input type="checkbox" className="ui-check" checked={on.includes(v)} onChange={(e) => set(e.target.checked ? [...on, v] : on.filter((x) => x !== v))} />
          {names?.[v] ?? v}
        </label>
      ))}
    </div>
  );
}

const summary = (c: ClauseDraft): string => {
  switch (c.type) {
    case 'roles': return c.roles.join(', ') || 'none';
    case 'counterparties': return c.rule === 'pinned' ? `listed wallets · ${c.keys || 'none yet'}` : RULES.find((r) => r[0] === c.rule)?.[1] ?? c.rule;
    case 'per_deal': return `${c.kind.replace('_', ' ')} · ${c.categories.join(', ') || 'any category'}`;
    case 'band': return c.items || 'no items yet';
    case 'payees': return c.payees || 'none';
    default: return '';
  }
};
const LABEL: Partial<Record<ClauseType, string>> = { roles: 'What agents may do', counterparties: 'Who they deal with', per_deal: 'What they may buy', band: 'Items with a price range', payees: 'Approved payees' };

export function WhoWhat({ d, setD, now, changed, baseAgent }: { d: MandateDraft; setD: (d: MandateDraft) => void; now: number; changed: (t: ClauseType | 'slot' | 'valid') => boolean; baseAgent: AgentSlot | null }) {
  const [open, setOpen] = useState<{ k: Key; el: HTMLElement } | null>(null);
  const toggle = (k: Key) => (el: HTMLElement) => setOpen((o) => (o?.k === k ? null : { k, el }));
  const close = () => setOpen(null);
  const remove = (i: number) => {
    setD({ ...d, clauses: d.clauses.filter((_, j) => j !== i) });
    close();
  };
  const missing = missingKinds(d);
  const at = open?.k.startsWith('c') ? Number(open.k.slice(1)) : -1;
  const c = at >= 0 ? d.clauses[at] : undefined;
  const set = (x: ClauseDraft) => setD(withClause(d, at, x));

  return (
    <section className="ui-section ow-ww">
      <div className="ui-section-h">
        <h2>Who and what</h2>
        <span className="end">click a line to change it</span>
      </div>
      <div className="ui-group">
        <WRow n="·" label="For which agent" value={d.agent} changed={changed('slot')} onOpen={toggle('slot')} />
        <WRow n="·" label="In force · currency" value={`${d.notBefore.replace('T', ' ')} → ${d.expires.replace('T', ' ')} · ${d.currency}`} changed={changed('valid')} onOpen={toggle('valid')} />
        {d.clauses.map((x, i) =>
          LABEL[x.type] ? <WRow key={`${x.type}-${i}`} n={CLAUSE_NUMBER[x.type]} label={LABEL[x.type]!} value={summary(x)} changed={changed(x.type)} onOpen={toggle(`c${i}`)} /> : null,
        )}
        {missing.length ? <WRow n="+" label="Add a rule" value={missing.map((t) => CLAUSE_KINDS.find((k) => k.type === t)?.name).join(', ')} changed={false} onOpen={toggle('add')} /> : null}
      </div>

      {open?.k === 'slot' ? (
        <Popover anchor={open.el} onClose={close} title="For which agent" className="ow-pop">
          <div className="ow-picks" role="radiogroup" aria-label="For which agent">
            {SLOTS.map((s) => (
              <label key={s} className="pick">
                <input type="radio" className="ui-check" name="slot" checked={d.agent === s} onChange={() => setD({ ...d, agent: s })} />
                {s}
              </label>
            ))}
          </div>
          <p className="ui-hint">{baseAgent ? `Now signed for your ${baseAgent} agent. ` : ''}These rules apply to the agent you pick. Its key stays in your computer’s secure store.</p>
        </Popover>
      ) : null}

      {open?.k === 'valid' ? (
        <Popover anchor={open.el} onClose={close} title="When they apply, and the currency" className="ow-pop">
          <div className="ow-form">
            <label>
              <span>Start</span>
              <input className="ui-field" type="datetime-local" value={d.notBefore} onChange={(e) => setD({ ...d, notBefore: e.target.value })} />
            </label>
            <label>
              <span>End</span>
              <input className="ui-field" type="datetime-local" value={d.expires} onChange={(e) => setD({ ...d, expires: e.target.value })} />
            </label>
            <label>
              <span>Currency</span>
              <select className="ui-field" value={d.currency} onChange={(e) => setD({ ...d, currency: e.target.value as Currency })}>
                {CURRENCIES.map((x) => <option key={x}>{x}</option>)}
              </select>
            </label>
          </div>
          <p className="ui-hint">When the rules end, their agents stop. No money moves.</p>
        </Popover>
      ) : null}

      {open?.k === 'add' ? (
        <Popover anchor={open.el} onClose={close} title="Add a rule" className="ow-pop">
          <div className="ow-adds">
            {missing.map((t) => {
              const k = CLAUSE_KINDS.find((x) => x.type === t)!;
              return (
                <Btn key={t} sm onClick={() => { setD({ ...d, clauses: [...d.clauses, emptyClause(t, now)] }); close(); }}>
                  {CLAUSE_NUMBER[t]} · {k.name} <span className="dim">· {k.hint}</span>
                </Btn>
              );
            })}
          </div>
          <p className="ui-hint">One of each kind. Every set needs what agents may do, who they deal with, a limit per deal, a daily limit, an ask-me limit and approved payees.</p>
        </Popover>
      ) : null}

      {open && c ? (
        <Popover anchor={open.el} onClose={close} title={LABEL[c.type] ?? c.type} className="ow-pop">
          <ClauseEditor c={c} set={set} />
          <div className="ow-popfoot">
            <Btn kind="plain" sm className="red" onClick={() => remove(at)}>Remove this rule</Btn>
          </div>
        </Popover>
      ) : null}
    </section>
  );
}

function ClauseEditor({ c, set }: { c: ClauseDraft; set: (c: ClauseDraft) => void }) {
  switch (c.type) {
    case 'roles':
      return <Checks all={ROLES} on={c.roles} set={(roles) => set({ ...c, roles })} />;
    case 'counterparties':
      return (
        <>
          <div className="ow-picks" role="radiogroup" aria-label="Counterparty rule">
            {RULES.map(([v, l]) => (
              <label key={v} className="pick">
                <input type="radio" className="ui-check" name="cprule" checked={c.rule === v} onChange={() => set({ ...c, rule: v })} />
                {l}
              </label>
            ))}
          </div>
          {c.rule === 'pinned' ? (
            <label className="ow-form">
              <span>Wallet keys, separated by commas</span>
              <input className="ui-field mono" value={c.keys} spellCheck={false} onChange={(e) => set({ ...c, keys: e.target.value })} />
            </label>
          ) : null}
        </>
      );
    case 'per_deal':
      return (
        <>
          <label className="ow-form">
            <span>What this limit covers</span>
            <select className="ui-field" value={c.kind} onChange={(e) => set({ ...c, kind: e.target.value as DealKind })}>
              {KINDS.map((k) => <option key={k}>{k}</option>)}
            </select>
          </label>
          <Checks all={CATEGORIES} on={c.categories} set={(categories) => set({ ...c, categories })} />
          <p className="ui-hint">Any other kind of deal is refused. Set the amount with the limit above.</p>
        </>
      );
    case 'band':
      return (
        <label className="ow-form">
          <span>Items, separated by commas</span>
          <input className="ui-field mono" value={c.items} spellCheck={false} onChange={(e) => set({ ...c, items: e.target.value })} />
          <span className="ui-hint">Anything for an item not listed here is refused, purchases included.</span>
        </label>
      );
    case 'payees':
      return (
        <label className="ow-form">
          <span>Payees, separated by commas</span>
          <input className="ui-field mono" value={c.payees} spellCheck={false} onChange={(e) => set({ ...c, payees: e.target.value })} />
          <span className="ui-hint">Agents may pay only these payees on their own. Anyone else comes to you.</span>
        </label>
      );
    default:
      return null;
  }
}
