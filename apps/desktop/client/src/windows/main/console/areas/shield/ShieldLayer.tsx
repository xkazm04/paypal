// The Shield layer (rebuild WP3b): scam checks and holds. The summary answers "did anything
// suspicious happen?" in one line; when a payment is paused for the owner, "Your call" says how
// many and what happens if they do nothing, and the one gold action opens the approval window on
// the first one (the payee's name is typed there to release it; releasing never happens here, and a
// block has no release anywhere). Four cards open the stopped payments, the ones the owner let go
// on, every check side by side (the old matrix, as rows) and the ones that looked safe. One level
// down: each paused payment as a decision, the lists, and how the shield decides.
import { LATEST_OF, OPEN_THE_DEAL, SHIELD, SHIELD_VIEWS_TITLE } from '../../../../../lib/words';
import { WalletNotice } from '../../../../../shared/honesty';
import { silenceParts } from '../../../home/model';
import { Loading } from '../../../ui';
import { useModuleRoute } from '../../../viewNav';
import { useLayerNav, type LayerProps } from '../../layers';
import { fewRows, ListEngine } from '../../ListEngine';
import { MAX_ROWS, type LatestProps } from '../../Latest';
import { ModuleLayer } from '../../ModuleLayer';
import { dealTotal } from '../../../logic';
import { formatMinor } from '../../../../../lib/format';
import type { Deal } from '@bindings/Deal';
import { paypalLine } from '../../../modules/shield/matrix';
import { Checks, HowShield } from './Checks';
import { PausedDecision, ReleaseHandoff, ShieldRow, useShieldWorld, type ShieldWorld } from './parts';

/** One of the shield's lists: windowed, searchable; a row opens its deal (a paused one, beside it). */
function ShieldList({ rows, s, label, empty, paused }: { rows: Deal[]; s: ShieldWorld; label: string; empty: string; paused?: boolean }) {
  const nav = useLayerNav();
  return (
    <ListEngine<Deal> className={fewRows(rows.length)} label={label} rows={rows} getKey={(d) => d.id} estimateSize={56} wideAt={paused ? 1200 : undefined}
      searchText={(d) => `${s.who(d)} ${s.title(d)}`}
      renderRow={(d) => <ShieldRow deal={d} s={s} />}
      rowLabel={(d) => `${s.who(d)}, ${s.title(d)}`}
      onOpen={(d) => nav.deal(d.id)}
      detail={paused ? (d) => <PausedDecision key={d.id} deal={d} s={s} onDeal={() => nav.deal(d.id)} /> : undefined}
      empty={empty} />
  );
}

/** The answer line, from the same sets the page lists. */
function answerOf(s: ShieldWorld): { answer: string; sub: string } {
  const safe = s.cleared.length ? SHIELD.answer.safe(s.cleared.length) : '';
  const lead = s.paused[0];
  if (lead) {
    const t = dealTotal(lead);
    return {
      answer: s.paused.length === 1 ? SHIELD.answer.onePaused(formatMinor(t.minor, t.currency), s.who(lead)) : SHIELD.answer.manyPaused(s.paused.length),
      sub: [SHIELD.answer.nothingSent, s.blocked.length ? SHIELD.answer.blocked(s.blocked.length) : '', safe].filter(Boolean).join(' '),
    };
  }
  if (s.stopped.length) {
    const neverSent = s.stopped.every((d) => paypalLine(d)[0].startsWith(SHIELD.nothingSentPrefix));
    return {
      answer: SHIELD.answer.stopped(s.stopped.length),
      sub: [SHIELD.answer.stoppedParts(s.blocked.length, s.closed.length), neverSent ? SHIELD.answer.neverAsked : '', SHIELD.answer.nothingNeeds, safe].filter(Boolean).join(' '),
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
    rows: rows.slice(0, MAX_ROWS).map((d) => ({ key: d.id, label: `${s.who(d)}, ${s.title(d)}, ${OPEN_THE_DEAL}`, onOpen: () => deal(d.id), node: <ShieldRow deal={d} s={s} /> })),
    seeAll: { onOpen: () => open(s.paused.length ? 'paused' : s.stopped.length ? 'stopped' : flagged.length ? 'through' : 'week') },
  };
}

export function ShieldLayer({ nav }: LayerProps) {
  const s = useShieldWorld();
  const route = useModuleRoute();
  if (!s.loaded) {
    return (
      <div className="ar-shield">
        <ModuleLayer module="shield" answer={SHIELD.title} yourCall={null}>
          {s.error ? <WalletNotice error={s.error} what={SHIELD.ledgerWhat} /> : <Loading what={SHIELD.loading} />}
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
        explain={{ summary: SHIELD.how.title, body: <><ul className="sh-howlist">{SHIELD.how.short.map((x) => <li key={x.title}><b>{x.title}.</b> {x.text}</li>)}</ul><p><button type="button" className="linkbtn" onClick={() => route.open('how')}>{SHIELD.how.all}</button></p></> }}
        views={{
          paused: { title: SHIELD_VIEWS_TITLE.paused, sub: SHIELD.pausedSub, render: () => <ShieldList rows={s.paused} s={s} label={SHIELD_VIEWS_TITLE.paused} empty={SHIELD.empty.paused} paused /> },
          stopped: { title: SHIELD_VIEWS_TITLE.stopped, sub: SHIELD.stoppedSub, render: () => <ShieldList rows={s.stopped} s={s} label={SHIELD_VIEWS_TITLE.stopped} empty={SHIELD.empty.stopped} /> },
          through: { title: SHIELD_VIEWS_TITLE.through, sub: SHIELD.throughSub, render: () => <ShieldList rows={s.released} s={s} label={SHIELD_VIEWS_TITLE.through} empty={SHIELD.empty.through} /> },
          safe: { title: SHIELD_VIEWS_TITLE.safe, sub: SHIELD.safeSub, render: () => <ShieldList rows={s.cleared} s={s} label={SHIELD_VIEWS_TITLE.safe} empty={SHIELD.empty.safe} /> },
          week: { title: SHIELD_VIEWS_TITLE.week, sub: SHIELD.weekSub, render: () => <Checks s={s} /> },
          how: { title: SHIELD_VIEWS_TITLE.how, render: () => <HowShield /> },
        }} />
    </div>
  );
}
