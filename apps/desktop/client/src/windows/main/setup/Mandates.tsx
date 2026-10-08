// Agent rules (mandates), as cards (docs/ux/ROUND-1.md): one card per signed rule set, named by the
// agent it is signed for, with the three limits a person checks first as large readable lines,
// "active until 2 Nov" and Change. Detailed keeps the full list of every rule set, as before, and
// every rule, the version, the id and the agent key are one popover away. Signing, new versions and
// revoking happen only in the approval window (approval_open): Change only hands off.
import type { Clause } from '@bindings/Clause';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import { shortHash, shortId } from '../../../lib/format';
import { useNow, useQuery } from '../../../lib/hooks';
import { kindWord, RULE_NAME, RULE_NUMBER, rulesName, ruleSentence } from '../../../lib/words';
import { NO_LONGER_FITS, WalletNotice } from '../../../shared/honesty';
import { AnswerBar, Chip, DetailToggle, Group, Icon, Kv, Loading, Silence, useDetail, type IconName } from '../../../shared/ui';
import { useWorld } from '../world';
import { Handoff, Info } from './common';
import { agentTitle, limitLines, rulesAnswer, ruleState, setsLine } from './limits';
import './setup.css';

const dateLabel = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const shortDate = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** The limits a person checks first: how much per purchase, and when they are asked. */
const HIGHLIGHT: readonly Clause['type'][] = ['per_deal', 'human_present_over', 'band', 'velocity'];
export function highlights(clauses: readonly Clause[], n = 2): string[] {
  return HIGHLIGHT.map((t) => clauses.find((c) => c.type === t)).filter((c): c is Clause => !!c).slice(0, n).map(ruleSentence);
}

const AGENT_ORDER: readonly string[] = ['shopper', 'negotiator', 'assistant'];
const AGENT_ICON: Record<string, IconName> = { shopper: 'box', negotiator: 'chat', assistant: 'store' };
const cap = (t: string) => `${t.charAt(0).toUpperCase()}${t.slice(1)}`;

export function MandatesList() {
  const q = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  const w = useWorld();
  const now = useNow();
  const [detail, setDetail] = useDetail('mandates');
  const list = q.data ?? [];
  const first = !!w.settings.data?.first_run || !list.length;
  const answer = rulesAnswer(list, now);
  const inForce = list.filter((m) => ruleState(m.payload, now) === 'active' && !m.refusal).length;
  const shared = (m: MandateListEntry) => list.filter((x) => x.agent === m.agent).length > 1;
  // Cards read by agent: Shopper, Negotiator, Assistant (an agent's several sets stay side by side).
  const rank = (a: string) => { const i = AGENT_ORDER.indexOf(a); return i < 0 ? AGENT_ORDER.length : i; };
  const ordered = [...list].sort((a, b) => rank(a.agent) - rank(b.agent) || a.agent.localeCompare(b.agent));
  return (
    <div className="mand">
      {q.data ? (
        <AnswerBar tone={answer.tone} title={answer.title} sub={answer.sub} icon="rules"
          actions={first || answer.tone === 'need'
            ? <Handoff label={first ? 'Set your first rules' : 'Change rules'} locked={w.locked} sm={false} target="mandate" title={w.locked ? 'Locked: the approval window asks for Windows Hello first' : 'Opens the approval window, where you sign rules'} /> : null} />
      ) : null}
      <div className="mand-bar">
        <h3>{detail === 'detailed' ? 'Every rule set' : 'Your agents'}</h3>
        {detail === 'simple' && setsLine(list) ? <span className="mand-n">{setsLine(list)}</span> : null}
        <span className="ui-spacer" />
        {q.data && list.length && detail === 'detailed' ? <Handoff label="Change rules" kind="default" locked={w.locked} target="mandate" title={w.locked ? 'Locked: the approval window asks for Windows Hello first' : 'Opens the approval window, where you sign rules'} /> : null}
        {q.data && list.length ? <DetailToggle value={detail} onChange={setDetail} detailedLabel="Full list" /> : null}
      </div>
      {q.error ? <WalletNotice error={q.error} what="Agent rules" /> : null}
      {!q.data && !q.error ? <Loading what="your rules" /> : null}
      {q.data && detail === 'simple' && list.length ? (
        <div className="ag-grid">
          {ordered.map((m) => <AgentCard key={`${m.payload.id}-${m.payload.version}`} m={m} now={now} shared={shared(m)} locked={w.locked} />)}
        </div>
      ) : null}
      {q.data && (detail === 'detailed' || !list.length) ? (
        <Group empty={<>No rules signed yet. Until you sign some, every agent request is refused before PayPal is asked.</>}>
          {list.map((m) => <MandateRow key={`${m.payload.id}-${m.payload.version}`} m={m} now={now} shared={shared(m)} />)}
        </Group>
      ) : null}
      {q.data && list.length ? (
        <p className="mand-foot">
          <Silence text={inForce ? 'your rules stay as signed' : 'every agent request stays refused'}>{inForce ? null : ' · nothing is sent to PayPal'}</Silence>
        </p>
      ) : null}
    </div>
  );
}

function nameOf(m: MandateListEntry, shared: boolean): string {
  const kinds = m.payload.clauses.flatMap((c) => (c.type === 'per_deal' ? [kindWord(c.kind)] : []));
  return agentTitle(m.agent, shared ? kinds : []);
}

/** The whole rule set, one popover: every rule in words, then the proof (version, ids, signature). */
function AllRules({ m, name }: { m: MandateListEntry; name: string }) {
  const p = m.payload;
  return (
    <Info label={`All rules for ${name}`} text="All rules ›" title={`${name} · ${p.clauses.length} rules`} className="wide">
      <Group>
        {p.clauses.map((c, i) => (
          <div key={i} className="ui-row cl"><span className="lbl">{RULE_NAME[c.type]}</span><span className="tx" title={ruleSentence(c)}>{ruleSentence(c)}</span></div>
        ))}
      </Group>
      <details className="ui-disclosure">
        <summary>Proof details</summary>
        <Kv items={[
          ['Version', `${p.version} · valid ${dateLabel(p.not_before)} to ${dateLabel(p.expires)}`],
          ['Rules id', <span className="mono">{shortId(p.id)}</span>],
          ['Agent key', <span className="mono">{shortHash(p.agent_key)}</span>],
          ['Rule numbers', p.clauses.map((c) => `${RULE_NUMBER[c.type]} ${RULE_NAME[c.type].toLowerCase()}`).join(' · ')],
          ['Signature', m.owner_sig.length ? 'signed by you' : 'missing'],
        ]} />
      </details>
      <p className="ui-hint">To change a rule, use Change: you read and sign the new version in the approval window.</p>
    </Info>
  );
}

function StateChip({ m, now }: { m: MandateListEntry; now: number }) {
  const p = m.payload;
  const state = ruleState(p, now);
  return (
    <>
      {m.owner_sig.length ? null : <Chip tone="red" title="This rule set has no owner signature, so it allows nothing">not signed</Chip>}
      {m.refusal ? <Chip tone="gold" title={NO_LONGER_FITS}>needs signing again</Chip> : null}
      <Chip tone={state === 'active' ? 'ok' : state === 'ended' ? 'red' : 'gold'} title={`Valid ${dateLabel(p.not_before)} to ${dateLabel(p.expires)}`}>
        {state === 'active' ? `active until ${shortDate(p.expires)}` : state === 'ended' ? `ended ${shortDate(p.expires)}` : `starts ${shortDate(p.not_before)}`}
      </Chip>
    </>
  );
}

/** One agent's rule set: who it is, the three limits it can never pass, how long it lasts, and Change. */
function AgentCard({ m, now, shared, locked }: { m: MandateListEntry; now: number; shared: boolean; locked: boolean }) {
  const name = nameOf(m, shared);
  const roles = m.payload.clauses.find((c) => c.type === 'roles');
  const kind = m.payload.clauses.flatMap((c) => (c.type === 'per_deal' ? [kindWord(c.kind)] : [])).join(', ');
  const limits = limitLines(m.payload.clauses);
  return (
    <article className="ag-card" aria-label={`${name} rules`}>
      <header className="ag-h">
        <span className="ag-ico" aria-hidden="true"><Icon name={AGENT_ICON[m.agent] ?? 'agent'} size={20} /></span>
        <div className="ag-t"><h3>{agentTitle(m.agent)}</h3>{shared && kind ? <span>{cap(kind)} deals</span> : roles ? <span>{cap(ruleSentence(roles))}</span> : null}</div>
        <span className="ag-all"><AllRules m={m} name={name} /></span>
      </header>
      {m.refusal ? <p className="ag-none" role="note">{NO_LONGER_FITS}</p> : null}
      {limits.length ? (
        <ul className="ag-lim">
          {limits.map((l) => <li key={l.key}><b>{l.value}</b><span>{l.label}</span></li>)}
        </ul>
      ) : <p className="ag-none">{m.payload.clauses.length} rules. Open them under All rules.</p>}
      <footer className="ag-f">
        <StateChip m={m} now={now} />
        <span className="ui-spacer" />
        <Handoff label="Change" kind="default" locked={locked} target="mandate" title={locked ? 'Locked: the approval window asks for Windows Hello first' : 'Opens the approval window, where you sign the new version'} />
      </footer>
    </article>
  );
}

/** `shared`: more than one rule set for this agent, so the name says which kind of deal each covers. */
function MandateRow({ m, now, shared }: { m: MandateListEntry; now: number; shared: boolean }) {
  const p = m.payload;
  const hi = highlights(p.clauses);
  const kinds = p.clauses.flatMap((c) => (c.type === 'per_deal' ? [kindWord(c.kind)] : []));
  const name = shared && kinds.length ? `${rulesName(m.agent)} · ${kinds.join(', ')}` : rulesName(m.agent);
  return (
    <div className="ui-row two mrow">
      <span className="mico" aria-hidden="true">
        <svg viewBox="0 0 16 16"><path d="M4 1.5h6l3 3v10H4z" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M6 8h5M6 11h4" stroke="currentColor" strokeWidth="1.3" /></svg>
      </span>
      <span className="main">
        <span className="t1"><b>{name}</b></span>
        <span className="t2">{m.refusal ? NO_LONGER_FITS : hi.length ? hi.join(' · ') : `${p.clauses.length} rules`}</span>
      </span>
      <span className="end">
        <StateChip m={m} now={now} />
        <AllRules m={m} name={name} />
      </span>
    </div>
  );
}
