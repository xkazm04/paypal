// The Shield layer (rebuild WP3b): scam checks and holds. The summary answers "did anything
// suspicious happen?" in one line; when a payment is paused for the owner, "Your call" says how
// many and what happens if they do nothing, and the one gold action opens the approval window on
// the first one (the payee's name is typed there to release it; releasing never happens here, and a
// block has no release anywhere). Four cards open the stopped payments, the ones the owner let go
// on, every check side by side (the old matrix, as rows) and the ones that looked safe. One level
// down: each paused payment as a decision, the lists, and how the shield decides.
import { useMemo } from 'react';
import { LATEST_OF, OPEN_THE_DEAL, SHIELD, SHIELD_VIEWS_TITLE, shieldReleased, shieldRuleWord, shieldWord } from '../../../../../lib/words';
import type { GridColumn } from '../../../../../shared/DataGrid';
import { Chip, ExplainHint, Icon, Placeholder, ReadFailed, Silence } from '../../../../../shared/ui';
import { silenceParts } from '../../../home/model';
import { useModuleRoute } from '../../../viewNav';
import { useDeals } from '../../../world';
import { useLayerNav, type LayerProps } from '../../layers';
import { fewRows, ListEngine } from '../../ListEngine';
import { MAX_ROWS, type LatestProps } from '../../Latest';
import { ModuleLayer } from '../../ModuleLayer';
import { dealTotal, stateLabel } from '../../../logic';
import { formatMinor } from '../../../../../lib/format';
import type { Deal } from '@bindings/Deal';
import { paypalLine } from '../../../modules/shield/matrix';
import { Amount, Countdown } from '../../rows';
import { Checks, HowShield } from './Checks';
import { PausedDecision, ReleaseHandoff, ShieldRow, shieldRowSay, useShieldWorld, VerdictChip, type ShieldWorld } from './parts';

/** The row's kind and short clause. KEEP IN STEP with rowLine in parts.tsx, which ShieldRow draws. */
function kindOf(deal: Deal, s: ShieldWorld) {
  const need = s.need(deal);
  const [a, b] = paypalLine(deal);
  const kind = deal.shield === 'BLOCK' ? 'block' : need ? 'paused' : deal.shield === 'HOLD' && !deal.shield_release ? 'closed' : deal.shield === 'CLEAR' ? 'clear' : 'other';
  const why = deal.shield_rule ? shieldRuleWord(deal.shield_rule).text : null;
  const sub = kind === 'block' ? SHIELD.row.blocked(why, b)
    : kind === 'paused' ? SHIELD.row.paused(why)
      : kind === 'closed' ? SHIELD.row.closed(why, stateLabel(deal.state, deal).toLowerCase(), a.toLowerCase())
        : kind === 'clear' ? SHIELD.row.clear(stateLabel(deal.state, deal))
          : shieldReleased(deal) ? SHIELD.row.released(s.moduleName(deal)) : SHIELD.row.other(why, s.moduleName(deal));
  return { kind, short: sub.split(' · ')[kind === 'block' && why ? 1 : 0] ?? sub };
}

/** A shield list as grid columns: the same cells as ShieldRow. The rows keep the order they come in. */
function shieldColumns(s: ShieldWorld): GridColumn<Deal>[] {
  const says = (d: Deal) => {
    if (kindOf(d, s).kind === 'closed') return SHIELD.closedChip;
    return d.shield ? shieldWord(d.shield).text : SHIELD.noVerdict;
  };
  return [
    { id: 'kind', header: SHIELD.col.kind, width: 72, sortable: false, filter: false, value: () => null,
      cell: (d) => { const { kind } = kindOf(d, s); return <span className={`sh-lead k-${kind}`} aria-hidden="true"><Icon name={kind === 'block' ? 'block' : kind === 'paused' || kind === 'closed' ? 'pause' : kind === 'clear' ? 'check' : 'eye'} size={13} /></span>; } },
    { id: 'who', header: SHIELD.col.payee, flex: 1.2, minWidth: 150, value: (d) => s.who(d), cell: (d) => <b className="sh-what" title={s.who(d)}>{s.who(d)}</b> },
    { id: 'says', header: SHIELD.col.says, width: 135, value: says,
      cell: (d) => (kindOf(d, s).kind === 'closed' ? <Chip tone="line" title={SHIELD.closedTitle}>{SHIELD.closedChip}</Chip> : <VerdictChip v={d.shield} />) },
    { id: 'left', header: SHIELD.col.left, width: 110, filter: false, value: (d) => s.need(d)?.deadline ?? null, cell: (d) => { const need = s.need(d); return need ? <Countdown deadline={need.deadline} /> : null; } },
    { id: 'amount', header: SHIELD.col.amount, width: 120, end: true, filter: 'number', value: (d) => dealTotal(d).minor, filterValue: (d) => dealTotal(d).minor / 100,
      cell: (d) => <Amount money={dealTotal(d)} tone={kindOf(d, s).kind === 'block' ? 'struck' : undefined} className="sh-amt" /> },
    { id: 'note', header: SHIELD.col.note, flex: 1.8, minWidth: 180, value: (d) => `${s.title(d)} ${kindOf(d, s).short}`,
      cell: (d) => { const { kind, short } = kindOf(d, s); return <span className="sh-sub">{s.title(d)} · {kind === 'block' ? <span className="tx-red">{short}</span> : short}</span>; } },
  ];
}

/** One of the shield's lists: windowed, searchable; a row opens its deal (a paused one, beside it). */
function ShieldList({ rows, s, label, empty, paused }: { rows: Deal[]; s: ShieldWorld; label: string; empty: string; paused?: boolean }) {
  const nav = useLayerNav();
  // The rows keep to columns: the paused list says once what silence does; the picked decision says it in full.
  const need = paused && rows[0] ? s.need(rows[0]) : undefined;
  const columns = useMemo(() => shieldColumns(s), [s]);
  return (<>
    {need ? <p className="sh-quiet"><Silence text={silenceParts(need.on_silence).head} /></p> : null}
    <ListEngine<Deal> className={fewRows(rows.length)} label={label} rows={rows} getKey={(d) => d.id} columns={columns} estimateSize={36} wideAt={paused ? 1200 : undefined}
      searchText={(d) => `${s.who(d)} ${s.title(d)}`}
      renderRow={(d) => <ShieldRow deal={d} s={s} />}
      rowLabel={(d) => shieldRowSay(d, s)}
      onOpen={(d) => nav.deal(d.id)}
      detail={paused ? (d) => <PausedDecision key={d.id} deal={d} s={s} onDeal={() => nav.deal(d.id)} /> : undefined}
      empty={empty} />
  </>);
}

/** The answer line, from the same sets the page lists. */
function answerOf(s: ShieldWorld): { answer: string; sub: string } {
  const safe = s.cleared.length ? SHIELD.answer.safe(s.cleared.length) : '';
  const lead = s.paused[0];
  if (lead) {
    const t = dealTotal(lead);
    return {
      answer: s.paused.length === 1 ? SHIELD.answer.onePaused(formatMinor(t.minor, t.currency), s.who(lead)) : SHIELD.answer.manyPaused(s.paused.length),
      sub: [SHIELD.answer.nothingSent, s.blocked.length ? SHIELD.answer.blocked(s.blocked.length) : ''].filter(Boolean).join(' '),
    };
  }
  if (s.stopped.length) {
    const neverSent = s.stopped.every((d) => paypalLine(d)[0].startsWith(SHIELD.nothingSentPrefix));
    return {
      answer: SHIELD.answer.stopped(s.stopped.length),
      sub: [SHIELD.answer.stoppedParts(s.blocked.length, s.closed.length), neverSent ? SHIELD.answer.neverAsked : '', SHIELD.answer.nothingNeeds].filter(Boolean).join(' '),
    };
  }
  return { answer: SHIELD.answer.quiet, sub: s.checked.length ? safe || SHIELD.answer.quietSub : SHIELD.answer.notYet };
}

/** Latest: what the checks paused, stopped or let go on (paused first), else every deal checked. */
function latestOf(s: ShieldWorld, open: (v: string) => void, deal: (id: string) => void): LatestProps {
  const seen = new Set<string>();
  const flagged = [...s.paused, ...s.stopped, ...s.released].filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
  const rows = [...flagged, ...s.checked.filter((d) => !seen.has(d.id))];
  return {
    title: LATEST_OF.shield, total: rows.length,
    rows: rows.slice(0, MAX_ROWS).map((d) => ({ key: d.id, label: `${shieldRowSay(d, s)}, ${OPEN_THE_DEAL}`, onOpen: () => deal(d.id), node: <ShieldRow deal={d} s={s} /> })),
    seeAll: { onOpen: () => open(s.paused.length ? 'paused' : s.stopped.length ? 'stopped' : flagged.length ? 'through' : 'week') },
  };
}

export function ShieldLayer({ nav }: LayerProps) {
  const s = useShieldWorld();
  // The shield is read from the world's deals: Try again asks for them again.
  const dealsQ = useDeals();
  const route = useModuleRoute();
  if (!s.loaded) {
    return (
      <div className="ar-shield">
        <ModuleLayer module="shield" answer={SHIELD.title} yourCall={null}>
          {s.error ? <ReadFailed error={s.error} what={SHIELD.ledgerWhat} onRetry={dealsQ.refetch} /> : <Placeholder what={SHIELD.loading} shape="cards" />}
        </ModuleLayer>
      </div>
    );
  }
  const { answer, sub } = answerOf(s);
  const first = s.paused[0];
  const firstNeed = first ? s.need(first) : undefined;
  return (
    <div className="ar-shield">
      <ModuleLayer module="shield" answer={answer} sub={sub} latest={latestOf(s, (v) => route.open(v), nav.deal)}
        purpose={<ExplainHint label={SHIELD.how.title} line={SHIELD.purpose}><ul className="tr-steps">{SHIELD.how.short.map((x) => <li key={x.title}><b>{x.title}.</b> {x.text}</li>)}</ul><p><button type="button" className="linkbtn" onClick={() => route.open('how')}>{SHIELD.how.all}</button></p></ExplainHint>}
        yourCall={first && firstNeed ? { count: s.paused.length, ifNothing: silenceParts(firstNeed.on_silence).head, onOpen: () => route.open('paused', 'your-call') } : null}
        action={first && firstNeed ? <ReleaseHandoff deal={first} need={firstNeed} /> : undefined}
        cards={[
          { id: 'stopped', view: 'stopped', label: SHIELD_VIEWS_TITLE.stopped, value: s.stopped.length ? SHIELD.count(s.stopped.length) : SHIELD.none,
            note: s.stopped.length ? (s.blocked.length ? SHIELD.cards.blocked(s.blocked.length) : SHIELD.answer.nothingSent) : SHIELD.cards.nothingStopped },
          { id: 'through', view: 'through', label: SHIELD_VIEWS_TITLE.through, value: s.released.length ? SHIELD.count(s.released.length) : SHIELD.none,
            note: s.released.length ? SHIELD.cards.letGo : SHIELD.cards.noneReleased },
          { id: 'week', view: 'week', label: SHIELD_VIEWS_TITLE.week, value: SHIELD.cards.checked(s.checked.length), note: SHIELD.cards.weekNote(s.paused.length, s.blocked.length) },
          { id: 'safe', view: 'safe', label: SHIELD_VIEWS_TITLE.safe, value: s.cleared.length ? SHIELD.count(s.cleared.length) : SHIELD.none,
            note: s.cleared.length ? SHIELD.cards.nothingFound : SHIELD.cards.nothingChecked },
        ]}
        views={{
          paused: { title: SHIELD_VIEWS_TITLE.paused, sub: <ExplainHint label={SHIELD.pausedSubLabel} line={SHIELD.pausedSubLine}>{SHIELD.pausedSub}</ExplainHint>, render: () => <ShieldList rows={s.paused} s={s} label={SHIELD_VIEWS_TITLE.paused} empty={SHIELD.empty.paused} paused /> },
          stopped: { title: SHIELD_VIEWS_TITLE.stopped, sub: SHIELD.stoppedSub, render: () => <ShieldList rows={s.stopped} s={s} label={SHIELD_VIEWS_TITLE.stopped} empty={SHIELD.empty.stopped} /> },
          through: { title: SHIELD_VIEWS_TITLE.through, sub: SHIELD.throughSub, render: () => <ShieldList rows={s.released} s={s} label={SHIELD_VIEWS_TITLE.through} empty={SHIELD.empty.through} /> },
          safe: { title: SHIELD_VIEWS_TITLE.safe, sub: SHIELD.safeSub, render: () => <ShieldList rows={s.cleared} s={s} label={SHIELD_VIEWS_TITLE.safe} empty={SHIELD.empty.safe} /> },
          week: { title: SHIELD_VIEWS_TITLE.week, sub: SHIELD.weekSub, render: () => <Checks s={s} /> },
          how: { title: SHIELD_VIEWS_TITLE.how, render: () => <HowShield /> },
        }} />
    </div>
  );
}
