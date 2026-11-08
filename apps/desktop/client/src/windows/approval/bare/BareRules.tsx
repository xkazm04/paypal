// spark abstract-first-home round 4: the bare rules form, the sign sheet only. The draft is
// the approval window's own: a rules draft The Table handed over (approval_handoff, `draft=` as
// approval_open carries it, MandateEditor's seedRules path: draftFromRules) or, without one, a
// starter template (`template=careful|restock|haggle`, default careful; templates.ts, with the
// payees of wallets already connected, as the editor's first-run picker fills them). It reads as
// the rules in plain words (one line per rule: model.ts clauseText, as the setup list shows them),
// the end date, "Sign with your owner key" and "Edit", which opens the few numbers a person changes
// in place. Validation is the editor's (buildMandate + ruleProblems); signing is the editor's
// (mandate_sign, privileged, through the session); Rust validates again on sign.
import { useEffect, useMemo, useState } from 'react';
import type { MandateSignArgs } from '@bindings/MandateSignArgs';
import type { WalletError } from '../../../lib/contract';
import { useNow, useQuery } from '../../../lib/hooks';
import { WalletNotice } from '../../../shared/honesty';
import { Btn } from '../../../shared/ui';
import { buildMandate, CLAUSE_NUMBER, draftFromRules, fromLocalInput, isIncomplete, previewClauses, refusalWords, ruleProblems, withClause, type ClauseDraft, type MandateDraft } from '../mandateDraft';
import { clauseText, isMandateActive } from '../model';
import { useSession } from '../session';
import { connectedPayees, templateDraft, TEMPLATES, type TemplateKey } from '../templates';
import { postToHost } from './protocol';
import { BareDone, Gate } from './parts';
import { BARE_RULES as W } from './words';

export const TEMPLATE_PARAM = 'template';

/** The starter the page was asked for (`?template=`), careful by default. */
export function starterKey(search: string = typeof location === 'undefined' ? '' : location.search): TemplateKey {
  const v = new URLSearchParams(search).get(TEMPLATE_PARAM);
  return TEMPLATES.some((t) => t.key === v) ? (v as TemplateKey) : 'careful';
}

/** The plain-words lines of a draft: one per complete rule, in the rules' own order. */
export function ruleLines(d: MandateDraft): string[] {
  return previewClauses(d)
    .flatMap((c) => (isIncomplete(c) ? [] : [c]))
    .sort((a, b) => CLAUSE_NUMBER[a.type] - CLAUSE_NUMBER[b.type])
    .map((c) => clauseText(c));
}

export function BareRules() {
  const s = useSession();
  const now = useNow();
  const handoff = useQuery('approval_handoff', null);
  const cps = useQuery('counterparty_list', null, { refreshOn: ['settings:changed'] });
  const mandates = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  const [d, setD] = useState<MandateDraft | null>(null);
  const [starter, setStarter] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [signed, setSigned] = useState(false);
  const [error, setError] = useState<WalletError | null>(null);

  // The draft starts once, from what The Table handed over, else from the starter template.
  const settled = !handoff.loading && !cps.loading && !mandates.loading;
  const inForce = (mandates.data ?? []).some((m) => isMandateActive(m, now) && !m.refusal);
  // Rules already in force when the page opened: this step is done, there is nothing to sign here.
  const [already, setAlready] = useState(false);
  useEffect(() => {
    if (d || !settled) return;
    if (inForce) setAlready(true);
    const t0 = Math.floor(Date.now() / 1000);
    const seed = handoff.data?.draft?.type === 'rules' ? handoff.data.draft : null;
    if (seed) { setD(draftFromRules(seed, t0)); return; }
    const key = starterKey();
    setStarter(TEMPLATES.find((t) => t.key === key)?.name ?? null);
    setD(templateDraft(key, t0, { payees: connectedPayees(cps.data) }));
  }, [d, settled, inForce, handoff.data, cps.data]);

  const built = useMemo(() => (d ? buildMandate(d) : null), [d]);
  const problems = useMemo(() => (d ? ruleProblems(previewClauses(d), fromLocalInput(d.notBefore), fromLocalInput(d.expires)) : []), [d]);

  if (signed || already) return <BareDone title={W.signed} sub={W.signedSub} />;
  if (!d || !built) return <section className="sc-form sc-rules" aria-busy="true"><div className="sc-skel" /></section>;

  const lines = ruleLines(d);
  const errs = built.ok ? [] : built.errors;
  const blockers = [...errs, ...problems.map((p) => p.why)];
  const payeesAt = d.clauses.findIndex((c) => c.type === 'payees');
  const payees = d.clauses[payeesAt];
  const payeesBlank = payees?.type === 'payees' && !payees.payees.trim();
  const ends = fromLocalInput(d.expires);
  const args: MandateSignArgs | null = built.ok ? { id: d.id, agent: d.agent, clauses: built.clauses, not_before: built.notBefore, expires: built.expires } : null;
  const busy = s.pending !== null || s.unlocking;

  const sign = async () => {
    if (!args) return;
    setError(null);
    const r = await s.call('mandate_sign', args, true);
    if (!r.ok) { setError(r.error); return; }
    setSigned(true);
    void s.refreshSettings();
    postToHost({ type: 'secure-done', kind: 'rules' });
  };
  const set = (i: number, c: ClauseDraft) => setD(withClause(d, i, c));

  return (
    <section className="sc-form sc-rules" aria-labelledby="sc-rules-h">
      <header className="sc-head sc-head-row">
        <h1 id="sc-rules-h">{W.title}</h1>
        {starter ? <span className="sc-tag">{W.starter} · {starter}</span> : null}
      </header>
      <ul className="sc-lines">
        {lines.map((l, i) => <li key={i}>{l.charAt(0).toUpperCase() + l.slice(1)}</li>)}
      </ul>
      <p className="sc-dim sc-until">{ends ? W.until(new Date(ends * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })) : W.noEnd}</p>

      {editing || payeesBlank ? (
        <div className="sc-edit">
          {d.clauses.map((c, i) => <EditRow key={i} c={c} i={i} set={set} only={editing ? null : 'payees'} />)}
          {editing ? (
            <label className="sc-field sc-field-row">
              <span>{W.ends}</span>
              <input className="ui-field sc-in" type="datetime-local" value={d.expires} onChange={(e) => setD({ ...d, expires: e.target.value })} />
            </label>
          ) : null}
        </div>
      ) : null}

      {blockers.length ? <p className="sc-err" role="status">{W.fix(blockers.length, blockers[0] ?? '')}</p> : null}
      <Gate>
        <div className="sc-acts">
          <Btn kind="gold" disabled={!args || problems.length > 0 || busy || !s.tokenReady} onClick={() => void sign()}>
            {s.pending === 'mandate_sign' ? W.signing : W.sign}
          </Btn>
          <Btn aria-expanded={editing} onClick={() => setEditing((x) => !x)}>{editing ? W.editDone : W.edit}</Btn>
        </div>
      </Gate>
      <p className="sc-kept sc-dim">{W.how}</p>
      {error ? <WalletNotice error={error} what={W.notSigned} message={error.code === 'REFUSED' ? refusalWords(error.message) : undefined} /> : null}
    </section>
  );
}

/** The numbers a person changes, in the draft's own strings (the editor's levers, as plain fields). */
function EditRow({ c, i, set, only }: { c: ClauseDraft; i: number; set: (i: number, c: ClauseDraft) => void; only: 'payees' | null }) {
  if (only && c.type !== only) return null;
  const money = (label: string, value: string, put: (v: string) => void) => (
    <label key={label} className="sc-field sc-field-row">
      <span>{label}</span>
      <input className="ui-field sc-in num" inputMode="decimal" value={value} onChange={(e) => put(e.target.value)} />
    </label>
  );
  switch (c.type) {
    case 'per_deal': return money(W.perDeal, c.max, (max) => set(i, { ...c, max }));
    case 'band': return money(W.ceiling, c.ceiling, (ceiling) => set(i, { ...c, ceiling }));
    case 'velocity':
      return (
        <>
          {money(W.perDay, c.total, (total) => set(i, { ...c, total }))}
          <label className="sc-field sc-field-row">
            <span>{W.dealsDay}</span>
            <input className="ui-field sc-in num" inputMode="numeric" value={c.deals} onChange={(e) => set(i, { ...c, deals: e.target.value })} />
          </label>
        </>
      );
    case 'human_present_over': return money(W.askOver, c.amount, (amount) => set(i, { ...c, amount }));
    case 'payees':
      return (
        <label className="sc-field sc-field-row">
          <span>{W.payeesAsk}</span>
          <input className="ui-field sc-in" value={c.payees} placeholder={W.payeesHint} onChange={(e) => set(i, { ...c, payees: e.target.value })} />
        </label>
      );
    default: return null;
  }
}
