// The Rewind chat flow (spark chat-configure): ONE live card with a day stepper (Earlier / Later), a short
// recap of the day and up to three notable moments, from the same record the Rewind page reads
// (deal_history, logic.ts laneSteps / tickTone / stepSentence). Read-only: it moves nothing and signs
// nothing. "Replay in Everything" opens the Rewind page (the page has no way to be told a day by its
// address, so it opens on its own latest moment). The scrubber is never embedded.
import { useMemo, useState } from 'react';
import type { HistoryStep } from '@bindings/HistoryStep';
import { useNow, useQuery } from '../../../../lib/hooks';
import { Btn } from '../../../../shared/ui';
import { isRefusal, laneSteps, stepSentence, stepTime, tickTone } from '../../logic';
import { shortTitle } from '../model';
import { useWorldSelector, type World } from '../../world';
import { setHomeView } from '../../switchboard/view';
import { FlowCard } from './FlowCard';
import { endFlow, type FlowTurn } from './store';
import { REWIND_FLOW_WORDS as W } from './rewindWords';
import './rewindFlow.css';

const DAY = 86_400;
/** How many days back one read covers (one read returns the newest 500 steps; older are left out). */
export const WINDOW_DAYS = 28;
const MAX_NOTABLE = 3;

const sel = (w: World) => ({ deals: w.deals.data, display: w.display });
const same = (a: ReturnType<typeof sel>, b: ReturnType<typeof sel>) => a.deals === b.deals && a.display === b.display;

/** Local midnight, `back` days before the day of `nowUnix`, in Unix seconds (calendar days: DST-safe). */
export function dayStart(nowUnix: number, back: number): number {
  const d = new Date(nowUnix * 1000);
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime() / 1000);
}

export type Recap = { decided: number; paid: number; stopped: number; needed: number; notable: HistoryStep[]; empty: boolean };

/** The recap of the steps that fall in [from, to): money calls decided, captured (paid), refused (stopped),
 *  and the ones the owner decided themselves (needed you). Notable: the latest few money steps. */
export function recapOf(steps: readonly HistoryStep[], from: number, to: number): Recap {
  const lane = laneSteps(steps.filter((s) => s.at >= from && s.at < to));
  const calls = lane.filter((s) => !isRefusal(s));
  return {
    decided: calls.length,
    paid: calls.filter((s) => s.kind === 'captured').length,
    stopped: lane.length - calls.length,
    needed: lane.filter((s) => tickTone(s) === 'owner').length,
    notable: [...lane].sort((a, b) => b.at - a.at || b.seq - a.seq).slice(0, MAX_NOTABLE).sort((a, b) => a.at - b.at || a.seq - b.seq),
    empty: lane.length === 0,
  };
}

/** "Today", "Yesterday" or "Tue 3 Nov". */
export function dayName(startUnix: number, nowUnix: number): string {
  const back = Math.round((dayStart(nowUnix, 0) - startUnix) / DAY);
  if (back === 0) return W.today;
  if (back === 1) return W.yesterday;
  const d = new Date(startUnix * 1000);
  return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`;
}

export function RewindFlow({ turn }: { turn: FlowTurn }) {
  if (turn.summary !== null) return <FlowCard turn={turn}>{null}</FlowCard>;
  return <LiveRewind turn={turn} />;
}

function LiveRewind({ turn }: { turn: FlowTurn }) {
  const now = useNow();
  const [back, setBack] = useState(0);
  const from = dayStart(now, WINDOW_DAYS - 1);
  const to = dayStart(now, -1);
  const q = useQuery('deal_history', { deal_id: null, from, to }, { refreshOn: ['deal:changed'] });
  const steps = useMemo(() => q.data?.steps ?? [], [q.data]);
  const { deals, display } = useWorldSelector(sel, same);
  const titles = useMemo(() => new Map((deals ?? []).map((d) => [d.id, shortTitle(display(d).title)] as const)), [deals, display]);

  // The oldest day the record holds (the window's first day when older steps were left out).
  const oldest = steps.length ? Math.min(...steps.map((s) => s.at)) : now;
  const maxBack = Math.max(0, Math.min(WINDOW_DAYS - 1, Math.round((dayStart(now, 0) - dayStart(oldest, 0)) / DAY)));
  const at = Math.min(back, maxBack);
  const start = dayStart(now, at);
  const end = dayStart(now, at - 1);
  const recap = useMemo(() => recapOf(steps, start, end), [steps, start, end]);
  const name = dayName(start, now);
  const reading = q.loading && !q.data;

  const replay = () => {
    window.location.hash = '#r=rewind';
    setHomeView('console');
    endFlow(W.replayed(name));
  };
  const figures: ReadonlyArray<readonly [string, number]> = [[W.decided, recap.decided], [W.paid, recap.paid], [W.stopped, recap.stopped], [W.needed, recap.needed]];

  return (
    <FlowCard turn={turn}>
      <p className="rwf-q">{W.q}</p>
      <div className="rwf-step">
        <Btn sm disabled={at >= maxBack} onClick={() => setBack(at + 1)} aria-label={W.earlierDay}>{W.earlier}</Btn>
        <b className="rwf-day" aria-live="polite" data-day={start}>{name}</b>
        <Btn sm disabled={at <= 0} onClick={() => setBack(at - 1)} aria-label={W.laterDay}>{W.later}</Btn>
      </div>
      {reading ? <p className="rwf-quiet" role="status">{W.reading}</p>
        : q.error && !steps.length ? <p className="rwf-quiet" role="status">{W.unread}</p>
        : recap.empty ? <p className="rwf-quiet" data-empty="">{W.empty}</p>
        : (
          <>
            <dl className="rwf-figures" aria-label={W.recapLabel}>
              {figures.map(([label, n]) => (<div key={label}><dt>{label}</dt><dd>{n}</dd></div>))}
            </dl>
            <ul className="rwf-events" aria-label={W.eventsLabel}>
              {recap.notable.map((s) => (
                <li key={`${s.deal_id}-${s.seq}`}>
                  <span className="rwf-time">{stepTime(s.at)}</span> {stepSentence(s, { title: titles.get(s.deal_id) ?? W.deal })}
                </li>
              ))}
            </ul>
          </>
        )}
      <div className="fc-choices">
        <Btn kind="gold" sm title={W.replayTitle} onClick={replay}>{W.replay}</Btn>
        <Btn sm onClick={() => endFlow(W.closed(name))}>{W.done}</Btn>
      </div>
    </FlowCard>
  );
}
