// Mandates · What-if replay (prototype/pages/mandate/variant-3), in the 744 px approval window.
//
// Consequences first: this week's deals replayed under the signed version and under the draft,
// a scoreboard of outcomes, and levers that carry the week's deals as ticks. At 744 px the
// prototype's two panes (replay + 372 px inspector) become one column: the scoreboard stays
// pinned at the top of the scroll while a segmented switch shows Levers or Replay below it, so
// the counts move while you drag. The replay is a LOCAL PREVIEW (owner/preview.ts): exact checks
// only, unknown drawn dashed, and Rust re-checks everything on sign.
//
// Commands kept as built: mandate_list (via OwnerConfig), mandate_sign (privileged, idle-locked,
// Windows Hello through session.unlock), mandate_revoke (privileged, one click).
import { useMemo, useState } from 'react';
import type { Clause } from '@bindings/Clause';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import type { MandateSignArgs } from '@bindings/MandateSignArgs';
import type { Mode } from '@bindings/Mode';
import type { Money } from '@bindings/Money';
import type { OpenMandate } from '@bindings/OpenMandate';
import type { WalletError } from '../../lib/contract';
import { shortHash, shortId } from '../../lib/format';
import { useNow } from '../../lib/hooks';
import { ruleNameOf, rulesName, timeLeftWords } from '../../lib/words';
import { NO_LONGER_FITS, WalletNotice } from '../../shared/honesty';
import { AnswerBar, Btn, Chip, Hourglass, Kv, Popover, Seg, Spacer, type IconName } from '../../shared/ui';
import { buildMandate, CLAUSE_NUMBER, draftFrom, fromLocalInput, newDraft, previewClauses, ruleProblems, withClause, type ClauseDraft, type ClauseType, type MandateDraft } from './mandateDraft';
import { minorToInput } from './model';
import { useReplayData } from './owner/data';
import { diffPolicy, hitPhrase, oneClauseFromDraft, type Change, type DiffSide } from './owner/diff';
import { Lever } from './owner/Lever';
import { amountTicks, priceTicks } from './owner/levers';
import { replay, weekDeals, type Policy, type PreviewContext } from './owner/preview';
import { ReplayTable, rowTag, Scoreboard } from './owner/Replay';
import { SignSheet, type Consequence } from './owner/SignSheet';
import { WhoWhat } from './owner/WhoWhat';
import { useSession } from './session';
import { Header } from './ui';

type Props = {
  mode: Mode | undefined;
  entries: MandateListEntry[];
  /** Mandate id, or null for a new mandate. */
  selected: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
  onSigned: (m: OpenMandate) => void;
  onRevoked: () => void;
  /** A floor drafted in The Table (approval_handoff): pre-fills that mandate's band floor. */
  seedFloor?: { mandate_id: string; item_ref: string; floor: Money } | null;
};

const NEW = 'new';
type Pane = 'levers' | 'replay';

export function MandateEditor({ mode, entries, selected, onSelect, onClose, onSigned, onRevoked, seedFloor }: Props) {
  const s = useSession();
  const now = useNow();
  const [t0] = useState(now);
  const data = useReplayData();
  const base = entries.find((e) => e.payload.id === selected) ?? null;
  const key = base ? `${base.payload.id}:${base.payload.version}` : NEW;
  const [drafts, setDrafts] = useState<Record<string, MandateDraft>>({});
  const seeded = !!base && !!seedFloor && seedFloor.mandate_id === base.payload.id;
  const d = drafts[key] ?? (base ? withFloorSeed(draftFrom(base, t0), seeded ? seedFloor : null) : newDraft(t0));
  const setD = (x: MandateDraft) => setDrafts((all) => ({ ...all, [key]: x }));
  const [pane, setPane] = useState<Pane | null>(null);
  const [preview, setPreview] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [info, setInfo] = useState<HTMLElement | null>(null);
  const [why, setWhy] = useState<HTMLElement | null>(null);
  const [done, setDone] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [revokeError, setRevokeError] = useState<WalletError | null>(null);
  const locked = s.settingsLocked || s.lockedByError;

  // ---- the draft, the signed version, and what changed ------------------------------------
  const built = buildMandate(d);
  const pclauses = useMemo(() => previewClauses(d), [d]);
  const problems = ruleProblems(pclauses, fromLocalInput(d.notBefore), fromLocalInput(d.expires));
  const baseCur = useMemo(() => (base ? draftFrom(base, t0).currency : null), [base, t0]);
  const baseSide: DiffSide | null = base && baseCur ? { clauses: base.payload.clauses, agent: base.agent, currency: baseCur, expires: base.payload.expires } : null;
  const changes = diffPolicy(baseSide, { clauses: pclauses, agent: d.agent, currency: d.currency, expires: fromLocalInput(d.expires) });
  const changedTypes = new Set(changes.map((c) => c.type));
  const changedTerm = (t: ClauseType | 'slot' | 'valid') =>
    t === 'slot' ? changes.some((c) => c.term === 'agent slot') : t === 'valid' ? changes.some((c) => c.term === 'expiry' || c.term === 'currency') : changedTypes.has(t);

  // ---- the replay (local preview) ---------------------------------------------------------
  const ctx: PreviewContext = { now, counterparties: data.counterparties };
  const signedPolicy: Policy = base ? { clauses: base.payload.clauses, invalid: null } : null;
  const draftPolicy: Policy = preview ? null : { clauses: pclauses, invalid: problems[0] ?? null };
  const week = data.deals ? weekDeals(data.deals, base?.payload.id ?? null, now) : data.deals;
  const rows = week ? replay(week, signedPolicy, draftPolicy, ctx) : week;
  const movedCount = rows ? rows.filter((r) => r.moved).length : 0;
  const shownPane: Pane = pane ?? (rows ? 'replay' : 'levers');
  const signedName = base ? 'Now' : 'No rules';
  const draftName = preview ? 'If withdrawn' : changes.length || !base ? 'Your change' : 'Unchanged';

  const consequences: Consequence[] | null = (() => {
    if (!rows || !week) return null;
    const baseClauses: readonly Clause[] = base?.payload.clauses ?? [];
    return changes.map((change) => {
      if (change.type === 'meta') return { change, text: 'Doesn’t change any outcome in this preview.', moved: 0 };
      const one = oneClauseFromDraft(baseClauses, pclauses, change.type);
      const r = replay(week, signedPolicy, { clauses: one, invalid: ruleProblems(one, fromLocalInput(d.notBefore), fromLocalInput(d.expires))[0] ?? null }, ctx);
      const phrase = hitPhrase(r, rowTag);
      return { change, text: phrase ? `With the rest of that rule, it would have ${phrase} this week.` : 'Changes nothing your agents did this week.', moved: r.filter((x) => x.moved).length };
    });
  })();

  // ---- levers (amounts) ---------------------------------------------------------------------
  const signedOf = <T extends Clause['type']>(t: T) => base?.payload.clauses.find((c): c is Extract<Clause, { type: T }> => c.type === t);
  const cur = d.currency;
  const sameCur = !baseCur || baseCur === cur;
  const dirOf = (t: ClauseType, term: string) => changes.find((c) => c.type === t && c.term === term)?.dir;
  const set = (i: number, c: ClauseDraft) => setD(withClause(d, i, c));
  const remove = (i: number) => setD({ ...d, clauses: d.clauses.filter((_, j) => j !== i) });
  const ticksOr = <T,>(f: () => T): T | null => (rows ? f() : null);
  const levers = d.clauses
    .map((c, i) => ({ c, i }))
    .sort((a, b) => CLAUSE_NUMBER[a.c.type] - CLAUSE_NUMBER[b.c.type])
    .map(({ c, i }) => {
      switch (c.type) {
        case 'per_deal': {
          const sp = signedOf('per_deal');
          return (
            <Lever key={i} n={3} title={`Most per ${c.kind === 'haggle' ? 'deal' : c.kind.replace('_', ' ')}`} value={c.max} currency={cur} signed={sameCur && sp ? sp.max_amount.minor : null}
              ticks={ticksOr(() => amountTicks(rows!, (r) => r.deal.kind === c.kind))} dir={dirOf('per_deal', 'per-deal max')}
              onChange={(max) => set(i, { ...c, max })} onRemove={() => remove(i)} />
          );
        }
        case 'band': {
          const sb = signedOf('band');
          const items = c.items.split(',').map((x) => x.trim()).filter(Boolean);
          const rounds = Number(c.rounds) || 0;
          return (
            <div key={i} className="ow-pair">
              <Lever n={4} title="Most you’ll pay · when your agents buy" value={c.ceiling} currency={cur} optional signed={sameCur && sb?.ceiling ? sb.ceiling.minor : null}
                ticks={ticksOr(() => priceTicks(rows!.filter((r) => r.deal.side === 'buyer'), items))} dir={dirOf('band', 'band ceiling')}
                onChange={(ceiling) => set(i, { ...c, ceiling })} onRemove={() => remove(i)} />
              <Lever n={4} title="Least you’ll accept · when your agents sell" value={c.floor} currency={cur} optional signed={sameCur && sb?.floor ? sb.floor.minor : null}
                ticks={ticksOr(() => priceTicks(rows!.filter((r) => r.deal.side === 'seller'), items))} dir={dirOf('band', 'band floor')}
                onChange={(floor) => set(i, { ...c, floor })}>
                <span className="ui-hint">offers</span>
                <span className="ow-stepper">
                  <Btn sm icon aria-label="fewer offers" disabled={rounds <= 1} onClick={() => set(i, { ...c, rounds: String(Math.max(1, rounds - 1)) })}>−</Btn>
                  <output aria-live="polite">{c.rounds || '—'}</output>
                  <Btn sm icon aria-label="more offers" disabled={rounds >= 255} onClick={() => set(i, { ...c, rounds: String(Math.min(255, rounds + 1)) })}>+</Btn>
                </span>
                {sb && String(sb.max_rounds) !== c.rounds ? <span className="ui-hint gold">was {sb.max_rounds}</span> : null}
                <label className="ui-hint ow-inline">
                  until <input className="ui-field" type="datetime-local" value={c.deadline} onChange={(e) => set(i, { ...c, deadline: e.target.value })} />
                </label>
              </Lever>
            </div>
          );
        }
        case 'velocity': {
          const sv = signedOf('velocity');
          const deals = Number(c.deals) || 0;
          return (
            <Lever key={i} n={5} title="Most per day, all deals together" value={c.total} currency={cur} signed={sameCur && sv ? sv.max_total_day.minor : null}
              ticks={null} tickNote="Today’s spending isn’t shown in this window, so the preview can’t tell what this limit would change." dir={dirOf('velocity', 'money per day')}
              onChange={(total) => set(i, { ...c, total })} onRemove={() => remove(i)}>
              <span className="ui-hint">deals per day</span>
              <span className="ow-stepper">
                <Btn sm icon aria-label="fewer deals per day" disabled={deals <= 1} onClick={() => set(i, { ...c, deals: String(Math.max(1, deals - 1)) })}>−</Btn>
                <output aria-live="polite">{c.deals || '—'}</output>
                <Btn sm icon aria-label="more deals per day" disabled={deals >= 65535} onClick={() => set(i, { ...c, deals: String(deals + 1) })}>+</Btn>
              </span>
              {sv && String(sv.max_deals_day) !== c.deals ? <span className="ui-hint gold">was {sv.max_deals_day}</span> : null}
            </Lever>
          );
        }
        case 'human_present_over': {
          const sh = signedOf('human_present_over');
          return (
            <Lever key={i} n={6} title="Ask me above" value={c.amount} currency={cur} signed={sameCur && sh ? sh.amount.minor : null}
              ticks={ticksOr(() => amountTicks(rows!, () => true))} dir={dirOf('human_present_over', '“you decide over” threshold')}
              onChange={(amount) => set(i, { ...c, amount })} onRemove={() => remove(i)} />
          );
        }
        default:
          return null;
      }
    });

  // ---- revoke: one click, privileged; hovering previews it in the replay ------------------
  const revoke = async () => {
    if (!base) return;
    if (locked) {
      void s.unlock();
      return;
    }
    setPreview(false);
    setRevokeError(null);
    const r = await s.call('mandate_revoke', { id: base.payload.id }, true);
    if (r.ok) {
      setDone({ tone: 'bad', text: `${rulesName(base.agent)} withdrawn. Agents that used them are refused from their next request. Nothing touched PayPal; anything on hold is still yours to decide.` });
      onRevoked();
    } else setRevokeError(r.error);
  };

  const args: MandateSignArgs | null = built.ok ? { id: d.id, agent: d.agent, clauses: built.clauses, not_before: built.notBefore, expires: built.expires } : null;
  const errs = built.ok ? [] : built.errors;
  const canReview = !!args && (changes.length > 0 || !base);
  // The answer on top: where these rules stand, in one sentence (display only; signing is unchanged).
  const tighter = changes.filter((c) => c.dir === 'restricts').length;
  const looser = changes.filter((c) => c.dir === 'widens').length;
  const answer: { tone: 'need' | 'calm' | 'alert'; icon: IconName; title: string; sub?: string; plain?: boolean } = preview
    ? { tone: 'alert', icon: 'block', title: 'Preview: if you withdraw these rules, every next request from their agents is refused.', sub: 'Nothing touches PayPal; anything on hold stays yours.' }
    : !base
      ? { tone: 'need', icon: 'rules', title: 'New rules: nothing is signed yet, so your agents can’t do anything.', sub: seeded && !drafts[key] ? `The lowest price for ${seedFloor?.item_ref} is filled in from The Table; check it before you sign.` : 'Fill in the limits, then review and sign.' }
      : changes.length
        ? {
            tone: 'need', icon: 'rules', plain: true,
            title: `You changed ${changes.length} ${changes.length === 1 ? 'thing' : 'things'}${tighter || looser ? ` (${[tighter ? `${tighter} tighter` : '', looser ? `${looser} looser` : ''].filter(Boolean).join(', ')})` : ''}. Nothing is signed yet.`,
            sub: rows ? `${movedCount} ${movedCount === 1 ? 'deal would' : 'deals would'} have gone differently this week.` : undefined,
          }
        : base.refusal
          ? { tone: 'alert', icon: 'block', title: NO_LONGER_FITS, sub: 'Fix what the line at the bottom says, then sign again, or withdraw them.' }
          : { tone: 'calm', icon: 'shield', title: 'No changes yet. Your agents follow these rules.', sub: 'Drag a limit and this week’s deals replay as you go.' };

  return (
    <div className="aw ow ow-ed">
      <Header mode={mode} />
      <div className="ui-toolbar ow-tabs">
        <Btn kind="plain" sm onClick={onClose} aria-label="Back to wallet setup">‹ Wallet setup</Btn>
        <div className="ui-seg" role="tablist" aria-label="Agent rules">
          {entries.map((e) => {
            const k = `${e.payload.id}:${e.payload.version}`;
            const dk = drafts[k];
            const n = dk && k !== key ? '●' : null;
            return (
              <button key={k} type="button" role="tab" aria-selected={e.payload.id === selected} aria-pressed={e.payload.id === selected} onClick={() => { setPreview(false); setPane(null); onSelect(e.payload.id); }} title={`${rulesName(e.agent)} · ${shortId(e.payload.id)}${e.refusal ? ' · needs signing again' : ''}`}>
                {rulesName(e.agent).replace(/ rules$/, '')}{sameAgent(entries, e.agent) ? <span className="dim"> {agentIndex(entries, e)}</span> : null}
                {n ? <span className="gold"> {n}</span> : null}
                {e.refusal ? <span className="gold" aria-label="needs signing again"> !</span> : null}
              </button>
            );
          })}
          <button type="button" role="tab" aria-selected={selected === null} aria-pressed={selected === null} onClick={() => { setPreview(false); setPane(null); onSelect(null); }}>+ New</button>
        </div>
        <Spacer />
        <Btn kind="plain" sm aria-label="About these rules" aria-haspopup="dialog" onClick={(e) => { const el = e.currentTarget; setInfo((x) => (x ? null : el)); }}>ⓘ</Btn>
      </div>

      <main className="aw-body ow-body">
        <div className="ow-q">
          <h1 tabIndex={-1}>What would my agents have done this week?</h1>
          <span className="ui-hint">
            {base ? `${rulesName(base.agent)} · ${base.refusal ? 'not in force: needs signing again' : `in force for ${timeLeftWords(base.payload.expires - now)}`}` : `New ${rulesName(d.agent).toLowerCase()}`}
          </span>
        </div>
        {done ? <div className={`ow-done ${done.tone}`} role="status">{done.text}</div> : null}
        {revokeError ? <WalletNotice error={revokeError} what="Not withdrawn" /> : null}

        <div className="ow-ans">
          <AnswerBar
            tone={answer.tone}
            icon={answer.icon}
            title={answer.title}
            sub={answer.sub}
            actions={answer.plain ? <Btn kind="plain" sm aria-haspopup="dialog" onClick={(e) => { const el = e.currentTarget; setWhy((w) => (w ? null : el)); }}>In plain words ›</Btn> : null}
          />
        </div>

        <div className="ow-scorebar">
          <Scoreboard rows={rows ?? null} signedName={signedName} draftName={draftName} />
          <div className="ow-switch">
            <Seg<Pane>
              label="Show"
              value={shownPane}
              onChange={setPane}
              options={[
                { value: 'levers', label: `Limits${changes.length ? ` · ${changes.length}` : ''}` },
                { value: 'replay', label: rows ? `This week · ${rows.length} deals${movedCount ? ` · ${movedCount} change` : ''}` : 'This week · not available' },
              ]}
            />
            <Chip tone="dashed" title="A preview of the checks that can be worked out here. Anything it can’t work out shows as unknown, never as passed.">preview · checked again when you sign</Chip>
          </div>
        </div>

        {shownPane === 'replay' ? (
          <ReplayTable rows={rows} error={data.dealsError} signedName={signedName} draftName={draftName} />
        ) : (
          <div className="ow-levers">
            <div className="ui-section-h">
              <h2>Limits</h2>
              <span className="end">drag, or type an amount</span>
            </div>
            <div className="ow-lgd ui-hint" aria-hidden={!rows}>
              <span><i className="tk policy" />agent may</span>
              <span><i className="tk asks" />asks you</span>
              <span><i className="tk refused" />refused</span>
              <span><i className="tk unknown" />unknown</span>
              <span>▾ now</span>
            </div>
            {levers.some(Boolean) ? levers : <p className="ui-hint">No money limits yet. Add a limit per deal, a daily limit or an ask-me limit below.</p>}
            <WhoWhat d={d} setD={setD} now={t0} changed={changedTerm} baseAgent={base?.agent ?? null} />
          </div>
        )}
        <p className="ui-silence ow-endline">
          <Hourglass /><span className="if">If you close this: </span><b>nothing is signed</b> · {base ? 'your current rules stay in force' : 'no rules are created'} · no money moves
        </p>
      </main>

      <footer className="ow-foot">
        {base ? (
          <Btn kind="danger" locked={locked} disabled={!s.tokenReady || s.pending !== null}
            onMouseEnter={() => setPreview(true)} onMouseLeave={() => setPreview(false)} onFocus={() => setPreview(true)} onBlur={() => setPreview(false)}
            title={locked ? 'Unlock with Windows Hello first' : 'Point at it to preview · one click withdraws now'} onClick={() => void revoke()}>
            {s.pending === 'mandate_revoke' ? 'Withdrawing…' : 'Withdraw these rules'}
          </Btn>
        ) : null}
        <span className="status" aria-live="polite">
          {errs.length ? <span className="red">Fix {errs.length} field{errs.length > 1 ? 's' : ''} before signing: {errs[0]}</span>
            : problems.length ? <span className="gold">This can’t be signed yet: {ruleNameOf(problems[0]!.clause).toLowerCase()} · {problems[0]!.why}</span>
            : changes.length ? <><b>{changes.length} change{changes.length > 1 ? 's' : ''}</b> · not signed yet · no money moves</>
            : base ? 'No changes · your agents follow these rules' : 'Fill in the rules, then sign'}
        </span>
        <Spacer />
        {changes.length && base ? <Btn onClick={() => setDrafts((all) => { const n = { ...all }; delete n[key]; return n; })}>Reset</Btn> : null}
        <Btn kind="gold" disabled={!canReview} onClick={() => { setPreview(false); setSheet(true); }}>
          {base ? 'Review & sign changes…' : 'Review & sign rules…'}
        </Btn>
      </footer>

      {info ? (
        <Popover anchor={info} onClose={() => setInfo(null)} title={base ? `${rulesName(base.agent)} · in force` : `New ${rulesName(d.agent).toLowerCase()}`} className="ow-pop">
          {base ? (
            <Kv
              items={[
                ['For', `your ${base.agent} agent`],
                ['In force', `${new Date(base.payload.not_before * 1000).toLocaleString('en-GB')} → ${new Date(base.payload.expires * 1000).toLocaleString('en-GB')}`],
                ['Rules', base.payload.clauses.length],
                ['Signed', 'with your owner key'],
                ['Version', base.payload.version],
                ['Reference', <span key="id" className="mono">{base.payload.id} · agent key {shortHash(base.payload.agent_key)}</span>],
                ['Earlier versions', <span key="v" className="dim">not shown here, only the rules in force</span>],
              ]}
            />
          ) : (
            <p className="ow-p">When you sign, the wallet gives these rules a reference number and links them to your {d.agent} agent.</p>
          )}
        </Popover>
      ) : null}
      {why && !preview ? (
        <Popover anchor={why} onClose={() => setWhy(null)} title="What the changes did this week" className="ow-pop wide">
          <Conseq changes={changes} consequences={consequences} />
        </Popover>
      ) : null}
      {sheet && args ? (
        <SignSheet
          base={base}
          args={args}
          changes={changes}
          consequences={consequences}
          problems={problems}
          onClose={() => setSheet(false)}
          onSigned={(m) => {
            setSheet(false);
            setDrafts((all) => { const n = { ...all }; delete n[key]; return n; });
            setDone({ tone: 'ok', text: `Signed with your owner key. Your agents follow the new rules from their next request.` });
            onSigned(m);
          }}
        />
      ) : null}
    </div>
  );
}

/** True when more than one rule set is signed for the same agent (the tab then needs a number). */
function sameAgent(entries: readonly MandateListEntry[], agent: MandateListEntry['agent']): boolean {
  return entries.filter((e) => e.agent === agent).length > 1;
}
/** 1-based position of this rule set among those signed for the same agent. */
function agentIndex(entries: readonly MandateListEntry[], e: MandateListEntry): number {
  return entries.filter((x) => x.agent === e.agent).indexOf(e) + 1;
}

/** The Table's floor draft, applied to the band that names its item (strings, as the editor holds them). */
function withFloorSeed(d: MandateDraft, seed: { item_ref: string; floor: Money } | null | undefined): MandateDraft {
  if (!seed || seed.floor.currency !== d.currency) return d;
  return { ...d, clauses: d.clauses.map((c) => (c.type === 'band' && c.items.split(/[\s,]+/).includes(seed.item_ref) ? { ...c, floor: minorToInput(seed.floor.minor, d.currency) } : c)) };
}

function Conseq({ changes, consequences }: { changes: Change[]; consequences: Consequence[] | null }) {
  return (
    <ul className="ow-conseq">
      {consequences
        ? consequences.map((c, i) => <li key={i} className={c.change.dir}>{c.change.text}. {c.text}</li>)
        : changes.map((c, i) => <li key={i} className={c.dir}>{c.text} <span className="dim">· this week’s effect is not computable here</span></li>)}
    </ul>
  );
}

