// The Rewind (#r=rewind), a layer of the one main window (rebuild WP3c; replaces the WP2 host and
// Rewind.tsx / RewindParts.tsx): what happened while the owner was away, replayed from the wallet's
// own verified record (deal_history). One answer (the week's money steps and refusals), four figures
// by who decided, the scrubber with the hub (play, week back and forth, drag, day anchors, ticks
// that open their deal), and the tape: every step of the week newest first, windowed, searchable
// and filtered by who decided; a step opens its deal. `rewindAt` opens it at a moment (an "away"
// line). Read-only: nothing here moves money.
import { Suspense, useEffect, useMemo, useState } from 'react';
import type { Deal } from '@bindings/Deal';
import type { HistoryStep } from '@bindings/HistoryStep';
import { formatCount } from '../../../../../lib/data/counts';
import { useNow, usePrefersReducedMotion } from '../../../../../lib/hooks';
import { lazyPart } from '../../../../../lib/lazy';
import {
  LAYER_LOADING, REWIND_ANSWER, REWIND_BAR, REWIND_CARD, REWIND_KICKER, REWIND_TAPE, REWIND_THIS_WEEK,
} from '../../../../../lib/words';
import { shortTitle, weekLabel } from '../../../home/model';
import { endingCtx, isMoneyCall, isRefusal, laneSteps, narrate, stepTime, tickTone, type TickTone } from '../../../logic';
import { useWorldSelector, type World } from '../../../world';
import type { LayerProps } from '../../layers';
import { ListEngine, type ListFilter, type ListSort } from '../../ListEngine';
import { fitHeight, PlaceFrame, type LensCard } from '../settings/frame';
import { Reveal, Skeleton } from '../../stagger';
import { useRewind, type RewindState } from './clock';
import type { Labeller } from './Scrubber';
import { TickMark } from './TickMark';

const RewindBar = lazyPart(() => import('./Scrubber').then((m) => m.RewindBar));
const RewindHub = lazyPart(() => import('./Scrubber').then((m) => m.RewindHub));

const sel = (w: World) => ({ deals: w.deals.data, display: w.display });
const same = (a: ReturnType<typeof sel>, b: ReturnType<typeof sel>) => a.deals === b.deals && a.display === b.display;

/** One step of the tape: the step, its deal's title and its narration, built once per read. */
type TapeRow = { key: string; s: HistoryStep; tone: TickTone | null; title: string; said: string };

const money = (s: HistoryStep) => isMoneyCall(s) || isRefusal(s);
const TONES: readonly TickTone[] = ['owner', 'rule', 'buyer', 'default', 'refused'];
const FILTERS: readonly ListFilter<TapeRow>[] = [
  ...TONES.map((t) => ({ value: t, label: REWIND_BAR.legendShort[t], test: (r: TapeRow) => r.tone === t })),
  { value: 'none', label: REWIND_TAPE.none, test: (r: TapeRow) => r.tone === null },
];
const SORTS: readonly ListSort<TapeRow>[] = [
  { value: 'new', label: REWIND_TAPE.sorts.newest, compare: (a, b) => b.s.at - a.s.at || b.s.seq - a.s.seq },
  { value: 'old', label: REWIND_TAPE.sorts.oldest, compare: (a, b) => a.s.at - b.s.at || a.s.seq - b.s.seq },
];

export function RewindLayer({ nav, state }: LayerProps) {
  const reduced = usePrefersReducedMotion();
  const now = useNow();
  const r = useRewind(true, now, reduced);
  const { deals, display } = useWorldSelector(sel, same);
  const labelOf = useMemo<Labeller>(() => {
    const by = new Map((deals ?? []).map((d) => [d.id, d] as const));
    return (id: string): { deal: Deal; label: string; title: string } | null => {
      const d = by.get(id);
      if (!d) return null;
      const disp = display(d);
      return { deal: d, label: disp.label, title: shortTitle(disp.title) };
    };
  }, [deals, display]);

  // Opening at a moment: step back to that week, then seek (the old "See it on the Rewind").
  const [want, setWant] = useState<number | null>(state.rewindAt);
  const { seek, shiftWeek, start, end, weekBack } = r;
  useEffect(() => {
    if (want === null) return;
    if (want < start && weekBack < 52) { shiftWeek(-1); return; }
    if (want >= end && weekBack > 0) { shiftWeek(1); return; }
    seek(want);
    setWant(null);
  }, [want, start, end, weekBack, seek, shiftWeek]);

  const tape = useTape(r, labelOf);
  const lane = laneSteps(r.steps);
  const calls = lane.filter((s) => !isRefusal(s)).length;
  const refused = r.steps.filter(isRefusal).length;
  const count = (t: TickTone) => lane.filter((s) => tickTone(s) === t).length;
  const answer = r.loading ? REWIND_ANSWER.reading : r.error && !r.steps.length ? REWIND_ANSWER.unread : !calls && !refused ? REWIND_ANSWER.quiet : REWIND_ANSWER.steps(calls, refused);
  const figure = (n: number) => (r.loading ? null : n ? REWIND_CARD.steps(formatCount(n)) : REWIND_CARD.none);
  const cards: LensCard[] = [
    { id: 'owner', label: REWIND_CARD.owner, value: figure(count('owner')), note: REWIND_CARD.ownerNote },
    { id: 'rule', label: REWIND_CARD.rule, value: figure(count('rule') + count('buyer')), note: count('buyer') ? `${REWIND_CARD.ruleNote} · ${REWIND_CARD.buyerNote}` : REWIND_CARD.ruleNote },
    { id: 'default', label: REWIND_CARD.default, value: figure(count('default')), note: REWIND_CARD.defaultNote },
    { id: 'refused', label: REWIND_CARD.refused, value: r.loading ? null : refused ? formatCount(refused) : REWIND_CARD.none, note: REWIND_CARD.refusedNote },
  ];

  return (
    <PlaceFrame root="ar-rewind" place="rewind" tone="var(--teal)" kicker={REWIND_KICKER(r.weekBack === 0 ? REWIND_THIS_WEEK : weekLabel(r.start, r.end))}
      answer={answer} sub={REWIND_ANSWER.sub} cards={cards}
      lead={(
        // The hub and the scrubber are the page's picture (its heaviest part): they take the last turn,
        // the tape (the list) comes before them (stagger.tsx).
        <Reveal wave={3} sizeKey="rewind:hub" skeleton={<Skeleton className="rw-host" h="23rem" />}>
          <div className="rw-host">
            <Suspense fallback={<p className="layer-loading" role="status">{LAYER_LOADING}</p>}>
              <div className="rw-stage"><RewindHub r={r} labelOf={labelOf} onOpenDeal={nav.deal} /></div>
              <RewindBar r={r} labelOf={labelOf} onOpenDeal={nav.deal} onExit={nav.back} />
            </Suspense>
          </div>
        </Reveal>
      )}>
      <section className="rw-tape" aria-label={REWIND_TAPE.title} style={{ height: `calc(${fitHeight(tape.length, 62, '70vh')} + 2rem)` }}>
        <h2 className="cs-h3">{REWIND_TAPE.title}</h2>
        <ListEngine<TapeRow> label={REWIND_TAPE.label} rows={tape} getKey={(t) => t.key} filters={FILTERS} filterLabel={REWIND_TAPE.filter} sorts={SORTS}
          searchText={(t) => `${t.title} ${t.said}`} estimateSize={58}
          renderRow={(t) => <TapeLine t={t} />} rowLabel={(t) => `${stepTime(t.s.at)} · ${t.said}`} onOpen={(t) => nav.deal(t.s.deal_id)}
          empty={REWIND_TAPE.empty} noMatch={REWIND_TAPE.noMatch} />
      </section>
    </PlaceFrame>
  );
}

/** The week's steps as tape rows, newest first (only the steps of deals the wallet knows). */
function useTape(r: RewindState, labelOf: Labeller): TapeRow[] {
  const { steps, unshown, unread } = r;
  return useMemo(() => {
    const out: TapeRow[] = [];
    for (const s of steps) {
      const who = labelOf(s.deal_id);
      if (!who) continue;
      out.push({
        key: `${s.deal_id}-${s.seq}`, s, tone: money(s) ? tickTone(s) : null, title: who.title,
        said: narrate(s, { title: who.title, side: who.deal.side, ...endingCtx(steps, s, unshown, unread) }),
      });
    }
    return out.sort((a, b) => b.s.at - a.s.at || b.s.seq - a.s.seq);
  }, [steps, unshown, unread, labelOf]);
}

function TapeLine({ t }: { t: TapeRow }) {
  return (
    <span className={`rw-line${t.tone ? ` t-${t.tone}` : ''}`}>
      <span className="rw-lt">{stepTime(t.s.at)}<small>{t.tone ? REWIND_BAR.legendShort[t.tone] : REWIND_TAPE.none}</small></span>
      <span className="rw-lm">{t.tone ? <TickMark tone={t.tone} /> : <i className="rw-ldot" aria-hidden="true" />}</span>
      <span className="rw-lx"><b>{t.title}</b><span>{t.said}</span></span>
      {t.tone && t.tone !== 'refused' ? <span className="rw-lp">{REWIND_TAPE.paypal}</span> : <span />}
    </span>
  );
}

