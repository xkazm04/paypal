// "While you were away" on Home: what happened since this viewer last looked, from the wallet's
// own record (deal_history, main only) and the deals' terms - never from counterparty text. A
// compact card in the left column when something needs Maya (the Needs-you list stays the only
// gold), or the hub's content when nothing does. Each line opens its deal, or the Rewind at that
// moment when several deals sit behind it. Read-only: nothing here can move money.
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { Deal } from '@bindings/Deal';
import { clockNow } from '../../../lib/clock';
import { useNow, useQuery } from '../../../lib/hooks';
import { stepTime } from '../logic';
import { awaySummary, readLastSeen, SEEN_AFTER_MS, worthShowing, writeLastSeen, type AwayLine, type AwaySummary } from './away';

export type Away = {
  /** null while the record is read, after a dismiss, on first run, or when the record can't be read. */
  summary: AwaySummary | null;
  dismiss: () => void;
};

/** Reads "last seen" once per page (the card keeps that moment until dismissed), and marks Home
 *  as seen after it has been on screen a few seconds, every minute after, and on leaving it. */
export function useAway(o: { active: boolean; enabled: boolean; needs: number; deals: readonly Deal[] }): Away {
  const [seen] = useState(() => readLastSeen(clockNow()));
  const [dismissed, setDismissed] = useState(false);
  const on = o.enabled && !dismissed;
  const q = useQuery('deal_history', { deal_id: null, from: seen.at, to: null }, { enabled: on, refreshOn: ['deal:changed'] });
  const now = useNow();

  useEffect(() => {
    if (!o.active || !o.enabled) return;
    const shown = Date.now();
    const mark = () => { if (document.visibilityState !== 'hidden') writeLastSeen(clockNow()); };
    const first = setTimeout(mark, SEEN_AFTER_MS);
    const every = setInterval(mark, 60_000);
    const leave = () => writeLastSeen(clockNow());
    window.addEventListener('pagehide', leave);
    return () => {
      clearTimeout(first);
      clearInterval(every);
      window.removeEventListener('pagehide', leave);
      // Leaving Home after a real look counts as seen (not a mount that was undone at once).
      if (Date.now() - shown > 1500) writeLastSeen(clockNow());
    };
  }, [o.active, o.enabled]);

  const dismiss = useCallback(() => { setDismissed(true); writeLastSeen(clockNow()); }, []);
  const data = q.data;
  const summary = useMemo(() => {
    if (!on || !data || q.error) return null;
    const s = awaySummary(data.steps, o.deals, seen.at, Math.max(now, seen.at), { needs: o.needs, truncated: data.truncated });
    return worthShowing(s) ? s : null;
  }, [on, data, q.error, o.deals, seen.at, now, o.needs]);
  return { summary, dismiss };
}

/** At most this many lines; the rest are one click away on the Rewind. */
const MAX_LINES = 4;

type Actions = { onDeal: (id: string) => void; onRewind: (at: number) => void };

const stop = (e: MouseEvent) => e.stopPropagation();
/** Keeps a count with its noun ("1 purchase") on one line. */
const nb = (t: string): string => t.replace(/(\d) /g, '$1\u00a0');

/** One line: a small mark for what it is, the sentence with its amount in bold; one click to the
 *  deal, or to the Rewind at that moment when several deals are behind it. */
function Line({ l, act }: { l: AwayLine; act: Actions }) {
  const one = l.deals.length === 1 ? l.deals[0] : undefined;
  const go = (e: MouseEvent) => { stop(e); if (one) act.onDeal(one); else act.onRewind(l.at); };
  return (
    <li>
      <button type="button" className={`aw-line t-${l.tone}`} onClick={go}
        title={one ? `${l.text}. Opens the deal.` : `${l.text}. Opens the Rewind at ${stepTime(l.at)}.`}>
        <i className="aw-mark" aria-hidden="true">{l.tone === 'stopped' ? '×' : null}</i>
        <span className="aw-say">{nb(l.before)}{l.amount ? <b>{l.amount}</b> : null}{nb(l.after)}</span>
      </button>
    </li>
  );
}

function Lines({ s, act }: { s: AwaySummary; act: Actions }) {
  const shown = s.lines.slice(0, MAX_LINES);
  const more = s.lines.length - shown.length;
  return (
    <>
      {s.lead ? <p className="aw-lead">{s.lead}</p> : null}
      {shown.length ? <ul className="aw-lines">{shown.map((l) => <Line key={l.key} l={l} act={act} />)}</ul> : null}
      {more > 0 ? <button type="button" className="aw-more" onClick={(e) => { stop(e); act.onRewind(s.since); }}>and {more} more on the Rewind</button> : null}
    </>
  );
}

const PARTIAL = 'A lot happened, so only the latest steps are counted here. The Rewind shows the rest.';

/** The left-column card (something needs Maya, so the hub keeps the decision). */
export function AwayCard({ s, onDismiss, ...act }: { s: AwaySummary; onDismiss: () => void } & Actions) {
  return (
    <section className="ui-section away" aria-label="While you were away">
      <div className="ui-section-h">
        <h2>While you were away</h2>
        <span className="end"><button type="button" className="aw-x" onClick={onDismiss} aria-label="Dismiss the summary" title="Dismiss: the next summary starts from now">×</button></span>
      </div>
      <div className="ui-group aw-card" title={s.partial ? PARTIAL : undefined}>
        <p className="aw-since">{s.sinceWords.charAt(0).toUpperCase() + s.sinceWords.slice(1)}{s.partial ? ' · latest steps' : ''}</p>
        <Lines s={s} act={act} />
        <div className="aw-foot">
          {s.needsLine ? <span className="aw-needs">{s.needsLine}</span> : null}
          <button type="button" className="aw-rw" onClick={() => act.onRewind(s.since)} title={`Replay from ${stepTime(s.since)}: who decided each payment`}>See it on the Rewind ›</button>
        </div>
      </div>
    </section>
  );
}

/** The hub's content when nothing needs Maya: the calm promise first, then what happened. */
export function AwayHub({ s, onDismiss, ...act }: { s: AwaySummary; onDismiss: () => void } & Actions) {
  return (
    <div className="hc aw-hub" key="away" title={s.partial ? PARTIAL : undefined}>
      <div className="h-eyebrow aw-eyebrow">Nothing needs you</div>
      <div className="aw-h">While you were away</div>
      <div className="aw-since">{s.sinceWords}{s.partial ? ' · latest steps' : ''}</div>
      <Lines s={s} act={act} />
      <div className="aw-acts">
        <button type="button" className="hm-back" onClick={(e) => { stop(e); act.onRewind(s.since); }} title={`Replay from ${stepTime(s.since)}: who decided each payment`}>See it on the Rewind ›</button>
        <button type="button" className="hm-back" onClick={(e) => { stop(e); onDismiss(); }} title="The next summary starts from now">Dismiss</button>
      </div>
    </div>
  );
}
