// The Rewind (#r=rewind), a layer of the one main window (rebuild WP3c; replaces the WP2 host and
// Rewind.tsx / RewindParts.tsx): what happened while the owner was away, replayed from the wallet's
// own verified record (deal_history). One answer (the week's money steps and refusals), four figures
// by who decided, the scrubber with the hub (play, week back and forth, drag, day anchors, ticks
// that move the playhead to their step), and the tape: every step of the week newest first, windowed, searchable
// and filtered by who decided; a step opens its deal. `rewindAt` opens it at a moment (an "away"
// line). The scrubber runs on past the gold "now" line into the forecast's next 72 hours, and shows what
// the rules the owner just said (the Say it panel above it) would allow there. In the director's film with
// `film_ending=today` (lib/preview.ts filmEndingPreview) the Say it panel and the forecast side are left out,
// so the film's Rewind shot is the one it always was; the app itself always shows them. Read-only: nothing
// here moves money.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryStep } from '@bindings/HistoryStep';
import { formatCount } from '../../../../../lib/data/counts';
import { Reveal as Sweep } from '../../../../../design/Reveal';
import { usePrefersReducedMotion } from '../../../../../lib/hooks';
import { reachOf } from '../../../../../lib/say/draft';
import { useSayReading } from '../../../setup/useSay';
import { SayPanel } from '../../../setup/SayIt';
import { bringIn } from '../../../setup/bringIn';
import { lazyPart } from '../../../../../lib/lazy';
import { filmEndingPreview } from '../../../../../lib/preview';
import { keyOf } from '../../../../../lib/data/keys';
import { useDataClient } from '../../../../../lib/data/provider';
import {
  READING_WHAT, REWIND_ANSWER, REWIND_BAR, REWIND_CARD, REWIND_KICKER, REWIND_SAY, REWIND_TAPE, REWIND_THIS_WEEK, REWIND_TRUNCATED,
} from '../../../../../lib/words';
import { weekLabel } from '../../../home/model';
import { endingCtx, isMoneyCall, isRefusal, laneSteps, narrate, stepSentence, stepTime, tickTone, type TickTone } from '../../../logic';
import { Btn, ExplainHint, Placeholder, ReadFailed } from '../../../../../shared/ui';
import type { LayerProps } from '../../layers';
import { ListEngine, type ListFilter, type ListSort } from '../../ListEngine';
import { fitHeight, PlaceFrame, type LensCard } from '../settings/frame';
import { Reveal, Skeleton } from '../../stagger';
import type { RewindState } from './clock';
import { useTimeline } from './useTimeline';
import type { Labeller } from './Scrubber';
import { TickMark } from './TickMark';

const RewindBar = lazyPart(() => import('./Scrubber').then((m) => m.RewindBar));
const RewindHub = lazyPart(() => import('./Scrubber').then((m) => m.RewindHub));

/** One step of the tape: the step, its deal's title and its narration, built once per read. */
type TapeRow = { key: string; s: HistoryStep; tone: TickTone | null; title: string; said: string; short: string };

/** A row's one line: the step's sentence without the deal's name (the row shows it already), at most twelve words.
 *  The full sentence is the row's accessible name, and is on the deal page. */
export function shortStep(sentence: string, title: string): string {
  const it = sentence.replace(title, 'it');
  const line = it.charAt(0).toUpperCase() + it.slice(1);
  const words = (t: string) => t.split(/\s+/).filter(Boolean);
  if (words(line).length <= 12) return line;
  const first = line.split(/(?<=[.!?])\s/)[0] ?? line;
  return words(first).length <= 12 ? first : `${words(first).slice(0, 12).join(' ')}…`;
}

const money = (s: HistoryStep) => isMoneyCall(s) || isRefusal(s);
/** Rows per page of the tape: as many as its box shows without a scroll of its own. */
const TAPE_PAGE = 12;
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
  // The director's film switch: under `film_ending=today` no Say it panel and no past-now forecast;
  // under `film_ending=say` the panel starts open, so that film's shot is the one it always was.
  const sayIt = filmEndingPreview() !== 'today';
  const said = useSayReading();
  // Say it sits behind one button, so the replay fills the first screen; a sentence (typed, or the director's) opens it.
  const [sayOpen, setSayOpen] = useState(() => filmEndingPreview() === 'say' || !!said.text);
  useEffect(() => { if (said.text) setSayOpen(true); }, [said.text]);
  const focusSay = useRef(false);
  const toggleSay = () => { focusSay.current = !sayOpen; setSayOpen(!sayOpen); };
  const reach = useMemo(() => (sayIt && said.reading ? reachOf(said.reading.facts, said.reading.facts.ends) : null), [said.reading, sayIt]);
  const { r, labelOf, ahead: forecast } = useTimeline(reach, reach ? said.text : null, sayIt);
  const ahead = sayIt ? forecast : undefined;
  // A sentence was just read: bring the timeline it draws on into view (the window may be short), once its chips have landed.
  const picture = useRef<HTMLDivElement>(null);
  const sentence = reach ? said.text : null;
  useEffect(() => {
    if (!sentence) return;
    const id = setTimeout(() => bringIn(picture.current, picture.current?.closest<HTMLElement>('.ar-rewind')?.querySelector<HTMLElement>('.say-readas') ?? null, reduced), 900);
    return () => clearTimeout(id);
  }, [sentence, reduced]);

  // Opened by its button: the box takes the focus.
  useEffect(() => {
    if (!sayOpen || !focusSay.current) return;
    focusSay.current = false;
    picture.current?.closest<HTMLElement>('.ar-rewind')?.querySelector<HTMLElement>('.say-input')?.focus();
  }, [sayOpen]);

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
  // Try again on a week that never answered: the same read (this week's range) asked again.
  const client = useDataClient();
  const retry = () => client.refetchQueries({ queryKey: keyOf('deal_history', { deal_id: null, from: r.start, to: r.end }).key });
  const lane = laneSteps(r.steps);
  const calls = lane.filter((s) => !isRefusal(s)).length;
  const refused = r.steps.filter(isRefusal).length;
  const count = (t: TickTone) => lane.filter((s) => tickTone(s) === t).length;
  // A week cut to its latest steps (truncated) counts a floor and says why, never "nothing moved".
  const answer = r.loading ? REWIND_ANSWER.reading : r.error && !r.steps.length ? REWIND_ANSWER.unread : r.truncated ? REWIND_ANSWER.steps(calls, refused, true) : !calls && !refused ? REWIND_ANSWER.quiet : REWIND_ANSWER.steps(calls, refused);
  // Not read yet, or never answered: the figures are unknown (a dash), never "None".
  const unknown = r.loading || (!!r.error && !r.steps.length);
  const figure = (n: number) => (unknown ? null : n ? REWIND_CARD.steps(formatCount(n)) : REWIND_CARD.none);
  const cards: LensCard[] = [
    { id: 'owner', label: REWIND_CARD.owner, value: figure(count('owner')), note: REWIND_CARD.ownerNote },
    { id: 'rule', label: REWIND_CARD.rule, value: figure(count('rule') + count('buyer')), note: count('buyer') ? `${REWIND_CARD.ruleNote} · ${REWIND_CARD.buyerNote}` : REWIND_CARD.ruleNote },
    { id: 'default', label: REWIND_CARD.default, value: figure(count('default')), note: REWIND_CARD.defaultNote },
    { id: 'refused', label: REWIND_CARD.refused, value: unknown ? null : refused ? formatCount(refused) : REWIND_CARD.none, note: REWIND_CARD.refusedNote },
  ];

  return (
    <PlaceFrame root="ar-rewind" place="rewind" tone="var(--teal)" kicker={REWIND_KICKER(r.weekBack === 0 ? REWIND_THIS_WEEK : weekLabel(r.start, r.end))}
      answer={answer} cards={cards}
      sub={r.truncated && !r.loading ? REWIND_TRUNCATED : <ExplainHint label={REWIND_ANSWER.subHint} line={REWIND_ANSWER.sub}>{REWIND_ANSWER.subLong}</ExplainHint>}
      action={sayIt ? <Btn aria-expanded={sayOpen} onClick={toggleSay}>{REWIND_SAY.open}</Btn> : null}
      lead={(
        // The hub and the scrubber are the page's picture (its heaviest part): they take the last turn,
        // the tape (the list) comes before them (stagger.tsx). Above them, the sentence that draws on them.
        <>
        {sayIt && sayOpen ? <SayPanel said={said} compact /> : null}
        <Reveal wave={3} sizeKey="rewind:hub" skeleton={<Skeleton className="rw-host" h="23rem" />}>
          <div className="rw-host" ref={picture}>
            <Suspense fallback={<Placeholder what={READING_WHAT.picture} shape="pane" />}>
              {/* A one-time sweep-in when the picture mounts; the Reveals animate on mount only, so scrubbing never replays it. */}
              <Sweep><div className="rw-stage"><RewindHub r={r} labelOf={labelOf} onOpenDeal={nav.deal} ahead={ahead} /></div></Sweep>
              <Sweep><RewindBar r={r} labelOf={labelOf} onOpenDeal={nav.deal} ahead={ahead} /></Sweep>
            </Suspense>
          </div>
        </Reveal>
        </>
      )}>
      <section className="rw-tape" aria-label={REWIND_TAPE.title} style={{ height: `calc(${fitHeight(Math.min(tape.length, TAPE_PAGE), 38, '70vh')} + 2rem)` }}>
        <h2 className="cs-h3">{REWIND_TAPE.title}</h2>
        {/* The tape's states: unknown until the week's first answer (never "nothing happened"), a
            failure with Try again when it never came; once read, the list (a refresh keeps it). */}
        {!r.steps.length && r.error ? <ReadFailed error={r.error} what={REWIND_TAPE.title} onRetry={retry} />
          : !r.steps.length && r.loading ? <Placeholder what={READING_WHAT.week} count={TAPE_PAGE / 2} /> : (
        <ListEngine<TapeRow> label={REWIND_TAPE.label} rows={tape} getKey={(t) => t.key} filters={FILTERS} filterLabel={REWIND_TAPE.filter} sorts={SORTS}
          searchText={(t) => `${t.title} ${t.said}`} estimateSize={36} pageSize={TAPE_PAGE}
          renderRow={(t) => <TapeLine t={t} />} rowLabel={(t) => `${stepTime(t.s.at)} · ${t.said}`} onOpen={(t) => nav.deal(t.s.deal_id)}
          empty={REWIND_TAPE.empty} noMatch={REWIND_TAPE.noMatch} />
        )}
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
      const ctx = { title: who.title, side: who.deal.side, ...endingCtx(steps, s, unshown, unread) };
      out.push({
        key: `${s.deal_id}-${s.seq}`, s, tone: money(s) ? tickTone(s) : null, title: who.title,
        said: narrate(s, ctx),
        short: shortStep(stepSentence(s, ctx), who.title),
      });
    }
    return out.sort((a, b) => b.s.at - a.s.at || b.s.seq - a.s.seq);
  }, [steps, unshown, unread, labelOf]);
}

function TapeLine({ t }: { t: TapeRow }) {
  return (
    <span className={`rw-line${t.tone ? ` t-${t.tone}` : ''}`}>
      <span className="rw-lt">{stepTime(t.s.at)}{t.tone ? <small>{REWIND_BAR.legendShort[t.tone]}</small> : null}</span>
      <span className="rw-lm">{t.tone ? <TickMark tone={t.tone} /> : <i className="rw-ldot" aria-hidden="true" />}</span>
      <span className="rw-lx"><b>{t.title}</b><span>{t.short}</span></span>
      {t.tone && t.tone !== 'refused' ? <span className="rw-lp">{REWIND_TAPE.paypal}</span> : <span />}
    </span>
  );
}

