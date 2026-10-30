// The Rewind's scrubber and hub (moved from RewindParts.tsx by rebuild WP3c, words in lib/words/rewind.ts):
// play, the week, the PayPal lane (one tick per money call, coloured by who decided it), the playhead,
// the legend, the day anchors; and the moment under the playhead with the step that happened last.
// Read-only.
//
// One timeline, past and future: left of the gold "now" line is the week as it happened (solid ticks);
// right of it, the next 72 hours as the walk-away forecast says silence plays out (dashed ticks, one per
// forecast line, future.ts). A draft rule the owner just said (shared/say) adds what those rules would
// allow over the same hours. Ticks and the keys stop on events, and "now" is an event of its own.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import type { Deal } from '@bindings/Deal';
import type { HistoryStep } from '@bindings/HistoryStep';
import type { Reach } from '../../../../../lib/say/draft';
import { formatMinor } from '../../../../../lib/format';
import type { Peek } from '../../../../../lib/say/join';
import { REWIND_AHEAD, REWIND_BAR, REWIND_HUB, REWIND_THIS_WEEK, REWIND_TRUNCATED } from '../../../../../lib/words';
import { WalletNotice } from '../../../../../shared/honesty';
import { weekLabel } from '../../../home/model';
import { endingCtx, isRefusal, laneSteps, narrate, stepTime, stepUnder, TICK_WORD, tickTone, weekFraction, type TickTone } from '../../../logic';
import type { RewindState } from './clock';
import { futureSaid, plainMoney, ruleLine, type FutureTick, type Headline } from './future';
import { TickMark } from './TickMark';

const LEGEND: readonly TickTone[] = ['owner', 'rule', 'buyer', 'default', 'refused'];
/** Ticks this close on the week (about two hours) sit side by side, centred on the first. */
const CLUSTER = 0.012;
const TICK_GAP_PX = 7;
/** A drag that lets go this close (of the track) to an event lands on it. */
const SNAP = 0.008;
const DAY = 86400;

export type Labeller = (dealId: string) => { deal: Deal; label: string; title: string } | null;

/** What the right of "now" draws: the forecast's ticks (null = it could not be read), the headline over
 *  them, and the rules the owner just said, if any. */
export type Ahead = {
  ticks: FutureTick[] | null;
  headline: Headline;
  reach: Reach | null;
  /** Each table open now for the item the sentence was tied to, and where its latest price lands against what was said. */
  peeks: Peek[];
  /** The deal's short title for a step ahead (the title the wallet shows, never a counterparty's own text). */
  titleOf: (dealId: string, fallback: string) => string;
};

type Lane = { key: string; f: number; dx: number };
/** Spread ticks that sit within CLUSTER of each other side by side, centred on the first. */
function spread<T extends { at: number }>(items: readonly T[], r: Pick<RewindState, 'start' | 'stop'>, key: (x: T) => string): Array<Lane & { x: T }> {
  const out: Array<Lane & { x: T }> = [];
  const clusters: T[][] = [];
  for (const s of items) {
    const c = clusters[clusters.length - 1];
    const first = c?.[0];
    if (c && first && weekFraction(s.at, r.start, r.stop) - weekFraction(first.at, r.start, r.stop) < CLUSTER) c.push(s);
    else clusters.push([s]);
  }
  for (const c of clusters) {
    const f = weekFraction(c[0]?.at ?? r.start, r.start, r.stop);
    c.forEach((x, k) => out.push({ x, key: key(x), f, dx: (k - (c.length - 1) / 2) * TICK_GAP_PX }));
  }
  return out;
}

export function RewindBar({ r, labelOf, onOpenDeal, onExit, ahead }: { r: RewindState; labelOf: Labeller; onOpenDeal: (id: string) => void; onExit: () => void; ahead?: Ahead }) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const span = Math.max(1, r.stop - r.start);
  const frac = (t: number) => weekFraction(t, r.start, r.stop);
  const past = useMemo(() => {
    const lane = laneSteps(r.steps).filter((s) => labelOf(s.deal_id));
    return spread<HistoryStep>(lane, r, (s) => `${s.deal_id}-${s.seq}`).map((p) => ({ ...p, tone: tickTone(p.x) }));
  }, [r.steps, r.start, r.stop, labelOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const future = useMemo(() => (r.ahead && ahead?.ticks ? spread<FutureTick>(ahead.ticks, r, (t) => t.key) : []), [r.ahead, ahead?.ticks, r.start, r.stop]); // eslint-disable-line react-hooks/exhaustive-deps
  const head = frac(r.t);
  const nowF = frac(r.now);
  const limitF = frac(r.limit);
  const isAhead = r.ahead && r.t > r.now;
  // The moments the keys and a released drag stop on: every recorded step, every forecast step, and now.
  const stops = useMemo(() => {
    const at = new Set<number>([...laneSteps(r.steps).map((s) => s.at), ...(ahead?.ticks ?? []).map((t) => t.at)]);
    if (r.ahead) at.add(r.now);
    return [...at].filter((x) => x >= r.start && x <= r.limit).sort((a, b) => a - b);
  }, [r.steps, ahead?.ticks, r.ahead, r.now, r.start, r.limit]);

  // The moment of crossing now: the line flashes once, whichever way the playhead went and whatever moved it.
  const was = useRef(isAhead);
  const [crossed, setCrossed] = useState<'into' | 'out' | null>(null);
  useEffect(() => {
    if (isAhead === was.current) return;
    was.current = isAhead;
    setCrossed(isAhead ? 'into' : 'out');
    const id = setTimeout(() => setCrossed(null), 1000);
    return () => clearTimeout(id);
  }, [isAhead]);

  const at = (clientX: number) => {
    const el = track.current;
    if (!el) return r.t;
    const box = el.getBoundingClientRect();
    return r.start + ((clientX - box.left) / Math.max(1, box.width)) * span;
  };
  const snap = (t: number): number => {
    let best = t;
    let dist = SNAP * span;
    for (const s of stops) if (Math.abs(s - t) < dist) { best = s; dist = Math.abs(s - t); }
    return best;
  };
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.rw-tick')) return;
    drag.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    r.pause();
    r.seek(at(e.clientX));
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => { if (drag.current) r.seek(at(e.clientX)); };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = false;
    r.seek(snap(at(e.clientX)));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const hop = e.shiftKey ? DAY : 3600;
    // Arrow keys go event by event; with Shift a day, with Alt an hour.
    const nextStop = () => stops.find((s) => s > r.t + 1) ?? r.limit;
    const prevStop = () => [...stops].reverse().find((s) => s < r.t - 1) ?? r.start;
    const keys: Record<string, () => void> = {
      ArrowRight: () => r.seek(e.shiftKey || e.altKey ? r.t + hop : nextStop()),
      ArrowLeft: () => r.seek(e.shiftKey || e.altKey ? r.t - hop : prevStop()),
      Home: () => r.seek(r.start), End: () => r.seek(r.limit),
      n: () => r.seek(r.now), N: () => r.seek(r.now),
      ' ': () => (r.playing ? r.pause() : r.play()),
    };
    const k = keys[e.key];
    if (!k) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key !== ' ') r.pause();
    k();
  };

  // One anchor per day of the track (the current week's track runs a few days past Sunday).
  const days = useMemo(() => {
    const out: Array<{ label: string; at0: number; mid: number; edge: number }> = [];
    for (let at0 = r.start, i = 0; at0 < r.stop; at0 += DAY, i++) {
      const width = Math.min(DAY, r.stop - at0);
      if (width < 6 * 3600 && i >= 7) continue;
      out.push({ label: REWIND_BAR.days[i % 7] ?? '', at0, mid: (at0 - r.start + width / 2) / span, edge: (at0 - r.start) / span });
    }
    return out;
  }, [r.start, r.stop, span]);

  const ruleEndF = ahead?.reach && ahead.reach.until > r.now ? frac(Math.min(ahead.reach.until, r.limit)) : null;
  const ruleBeyond = !!ahead?.reach && ahead.reach.until > r.limit;
  const nowWord = REWIND_AHEAD.nowAt(stepTime(r.now));

  return (
    <div className={`rw-bar${r.ahead ? ' has-ahead' : ''}${isAhead ? ' is-ahead' : ''}${crossed ? ` crossed-${crossed}` : ''}`} role="group" aria-label={r.ahead ? REWIND_AHEAD.label : REWIND_BAR.label}>
      <div className="rw-row">
        <button type="button" className="rw-play" onClick={r.playing ? r.pause : r.play} aria-label={r.playing ? REWIND_BAR.pause : REWIND_BAR.play} title={r.playing ? REWIND_BAR.pauseTitle : REWIND_BAR.playTitle} data-fk="rw-play">
          {r.playing ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9M11 3.5v9" /></svg> : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l8 5-8 5z" /></svg>}
        </button>
        <span className="rw-week">
          <button type="button" className="rw-nav" onClick={() => r.shiftWeek(-1)} aria-label={REWIND_BAR.before} title={REWIND_BAR.before}>‹</button>
          <b>{r.weekBack === 0 ? REWIND_THIS_WEEK : weekLabel(r.start, r.end)}</b>
          <button type="button" className="rw-nav" onClick={() => r.shiftWeek(1)} disabled={r.weekBack === 0} aria-label={REWIND_BAR.after} title={REWIND_BAR.after}>›</button>
        </span>
        <span className="rw-legend" aria-label={REWIND_BAR.legend}>
          {LEGEND.map((tone) => <span key={tone} title={TICK_WORD[tone]}><TickMark tone={tone} />{REWIND_BAR.legendShort[tone]}</span>)}
          {r.ahead ? <span title={REWIND_AHEAD.legend}><i className="rw-fmark" aria-hidden="true" />Forecast</span> : null}
        </span>
        {r.ahead ? <button type="button" className="rw-tonow" onClick={() => { r.pause(); r.seek(r.now); }} title={REWIND_AHEAD.jumpNow} disabled={Math.abs(r.t - r.now) < 2}>{REWIND_AHEAD.nowFlag}</button> : null}
        <button type="button" className="rw-live" onClick={onExit} title={REWIND_BAR.nowTitle}>{REWIND_BAR.now}</button>
      </div>
      {r.ahead && ahead ? (
        <p className={`rw-walk${ahead.headline.known ? '' : ' unknown'}${isAhead ? ' ahead' : ''}`} role="status" aria-live="polite">
          <b>{ahead.headline.lead}:</b> <span>{ahead.headline.rest}</span>
        </p>
      ) : null}
      {r.ahead && ahead?.reach && ahead.peeks.length ? <Peeks reach={ahead.reach} peeks={ahead.peeks} onOpenDeal={onOpenDeal} /> : null}
      <div className="rw-track" ref={track} role="slider" tabIndex={0} aria-label={REWIND_BAR.playhead}
        aria-valuemin={r.start} aria-valuemax={r.limit} aria-valuenow={Math.round(r.t)}
        aria-valuetext={`${stepTime(r.t)}${isAhead ? ` · ${REWIND_AHEAD.forecastWord}` : ''}`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = false; }} onKeyDown={onKey}>
        <div className="rw-flags" aria-hidden="true">
          {r.ahead ? <span className="rw-flag now" style={{ left: `${nowF * 100}%` } as CSSProperties}>{nowWord}</span> : null}
          {ruleEndF !== null && ahead?.reach ? <span className={`rw-flag rule${ruleBeyond ? ' beyond' : ''}`} style={{ left: `${ruleEndF * 100}%` } as CSSProperties}>{REWIND_AHEAD.rule.ends(stepTime(ahead.reach.until))}</span> : null}
        </div>
        <div className="rw-groove">
          {days.map((d) => <span key={d.at0} className="rw-day" style={{ left: `${d.edge * 100}%` } as CSSProperties} />)}
          {r.ahead ? <span className="rw-fwd" style={{ left: `${nowF * 100}%`, width: `${Math.max(0, limitF - nowF) * 100}%` } as CSSProperties} aria-hidden="true" /> : null}
          {r.ahead && limitF < 1 ? <span className="rw-later" title={REWIND_AHEAD.beyond} style={{ left: `${limitF * 100}%` } as CSSProperties} aria-hidden="true" /> : null}
          {ahead?.reach ? <span className={`rw-reach${ahead.reach.alone === 0 ? ' asks' : ''}`} style={{ left: `${nowF * 100}%`, width: `${Math.max(0, (ruleEndF ?? limitF) - nowF) * 100}%` } as CSSProperties} aria-hidden="true" /> : null}
          <span className="rw-past" style={{ width: `${Math.min(head, nowF) * 100}%` } as CSSProperties} aria-hidden="true" />
        </div>
        <div className="rw-lane">
          {past.map(({ x: s, f, dx, tone }) => {
            const who = labelOf(s.deal_id);
            if (!who) return null;
            const said = narrate(s, { title: who.title, side: who.deal.side, ...endingCtx(r.steps, s, r.unshown, r.unread) });
            return (
              <button key={`${s.deal_id}-${s.seq}`} type="button" className={`rw-tick t-${tone} ${s.at <= r.t ? 'on' : ''}`} tabIndex={-1}
                style={{ left: `calc(${f * 100}% + ${dx}px)` } as CSSProperties}
                aria-label={said} title={`${said}\n${TICK_WORD[tone]} · ${REWIND_BAR.opens}`}
                onClick={(e) => { e.stopPropagation(); onOpenDeal(s.deal_id); }}>
                <TickMark tone={tone} />
              </button>
            );
          })}
          {future.map(({ x: t, f, dx }) => {
            const title = ahead?.titleOf(t.line.deal_id, t.line.label) ?? t.line.label;
            const said = futureSaid(t.line, title);
            const note = t.conditional ? REWIND_AHEAD.tickIf : t.untimed ? REWIND_AHEAD.tickNow : stepTime(t.at);
            return (
              <button key={t.key} type="button" className={`rw-tick fut f-${t.tone}${t.conditional ? ' maybe' : ''} ${t.at <= r.t ? 'on' : ''}`} tabIndex={-1}
                style={{ left: `calc(${f * 100}% + ${dx}px)` } as CSSProperties}
                aria-label={`${REWIND_AHEAD.legend}: ${said}`} title={`${said}\n${REWIND_AHEAD.who[t.tone]} · ${note} · ${REWIND_AHEAD.noMoney}`}
                onClick={(e) => { e.stopPropagation(); onOpenDeal(t.line.deal_id); }}>
                <i className="rw-fm" aria-hidden="true" />
              </button>
            );
          })}
        </div>
        {r.ahead ? <span className="rw-now" style={{ left: `${nowF * 100}%` } as CSSProperties} aria-hidden="true" /> : null}
        <span className="rw-head" style={{ left: `${head * 100}%` } as CSSProperties} aria-hidden="true"><i /></span>
      </div>
      <div className="rw-days" role="group" aria-label={REWIND_BAR.jump}>
        {days.map((d) => (
          <button key={d.at0} type="button" className={`rw-dayjump${r.t >= d.at0 && r.t < d.at0 + DAY ? ' on' : ''}${d.at0 > r.now && r.ahead ? ' fut' : ''}`} disabled={d.at0 > r.limit}
            style={{ left: `${d.mid * 100}%` } as CSSProperties} title={REWIND_BAR.jumpTo(d.label)} onClick={() => { r.pause(); r.seek(d.at0 + 12 * 3600); }}>{d.label}</button>
        ))}
      </div>
      {r.truncated ? <p className="dim">{REWIND_TRUNCATED}</p> : null}
      {r.error ? <WalletNotice error={r.error} what={REWIND_BAR.failed} /> : null}
    </div>
  );
}

/** The tables open now for the item just said, each at its latest price against the two numbers the owner gave. A preview
 *  of their numbers ("if the price stays"), not the wallet's check. */
function Peeks({ reach, peeks, onOpenDeal }: { reach: Reach; peeks: Peek[]; onOpenDeal: (id: string) => void }) {
  const w = REWIND_AHEAD.peek;
  return (
    <div className="rw-peeks" role="group" aria-label={w.label(reach.item ?? '')}>
      <p className="rw-peekh">{w.label(reach.item ?? '')}<span> · {w.note}</span></p>
      <ul>
        {peeks.map((p) => {
          const price = plainMoney(formatMinor(p.price, p.currency));
          const said = p.verdict === 'alone' ? w.alone(price) : p.verdict === 'asks' ? w.asks(price, plainMoney(formatMinor(reach.ask, reach.currency))) : w.over(price, plainMoney(formatMinor(reach.ceiling ?? 0, reach.currency)));
          return (
            <li key={p.id} className={`pk-${p.verdict}`}>
              <button type="button" onClick={() => onOpenDeal(p.id)} title={w.open}>
                <b>{p.who ?? p.title}</b><span>{said}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The moment under the playhead: a step that happened, or (past now) what the forecast says happens. */
export function RewindHub({ r, labelOf, onOpenDeal, ahead }: { r: RewindState; labelOf: Labeller; onOpenDeal: (id: string) => void; ahead?: Ahead }) {
  const known = useMemo(() => r.steps.filter((s) => labelOf(s.deal_id)), [r.steps, labelOf]);
  if (r.ahead && r.t > r.now && ahead) return <AheadHub r={r} ahead={ahead} onOpenDeal={onOpenDeal} />;
  const step = stepUnder(known, r.t);
  const who = step ? labelOf(step.deal_id) : null;
  const lane = known.filter((s) => s.at <= r.t);
  const calls = laneSteps(lane).filter((s) => !isRefusal(s)).length;
  const refused = lane.filter(isRefusal).length;
  const tone = step ? tickTone(step) : null;
  const money = step && (step.paypal.type === 'call' || isRefusal(step));
  return (
    <div className="hc rw-hub" key={step ? `${step.deal_id}-${step.seq}` : 'empty'} aria-live="off">
      <div className="h-eyebrow">{REWIND_HUB.at(stepTime(r.t))}</div>
      {r.loading ? <div className="h-week">{REWIND_HUB.reading}</div>
        : step && who ? (
          <>
            <div className={`rw-say ${money && tone ? `t-${tone}` : ''}`}>
              {money && tone ? <TickMark tone={tone} /> : null}
              <span>{narrate(step, { title: who.title, side: who.deal.side, ...endingCtx(r.steps, step, r.unshown, r.unread) })}</span>
            </div>
            <div className="rw-meta">
              {!money || !tone ? REWIND_HUB.noCall : tone === 'refused' ? (step.authority.type === 'signed_rule' ? REWIND_HUB.stoppedRules : REWIND_HUB.stoppedSafety) : TICK_WORD[tone]}
            </div>
            <button type="button" className="hm-back rw-open" onClick={(e) => { e.stopPropagation(); onOpenDeal(step.deal_id); }}>{REWIND_HUB.open}</button>
          </>
        ) : <div className="h-calm rw-calm">{REWIND_HUB.calm}</div>}
      <div className="h-week rw-count">{REWIND_HUB.count(calls, refused)}</div>
    </div>
  );
}

/** Past the gold line: the headline, the forecast step under the playhead, and what the new rules would allow. */
function AheadHub({ r, ahead, onOpenDeal }: { r: RewindState; ahead: Ahead; onOpenDeal: (id: string) => void }) {
  const ticks = ahead.ticks;
  // The last forecast step the playhead has passed (null before the first one).
  const under = useMemo(() => (ticks ?? []).filter((t) => t.at <= r.t).at(-1) ?? null, [ticks, r.t]);
  const title = under ? ahead.titleOf(under.line.deal_id, under.line.label) : '';
  const until = ahead.reach?.until ?? 0;
  return (
    <div className="hc rw-hub rw-ahead-hub" key={under ? under.key : 'none'} aria-live="off">
      <div className="h-eyebrow">{REWIND_AHEAD.hub.eyebrow(stepTime(r.t))}</div>
      {ticks === null ? <div className="rw-meta">{REWIND_AHEAD.hub.unread}</div>
        : under ? (
          <>
            <div className={`rw-say rw-fsay f-${under.tone}`}>
              <i className="rw-fm" aria-hidden="true" />
              <span>{stepTime(under.at)} · {futureSaid(under.line, title)}</span>
            </div>
            <div className="rw-meta">{REWIND_AHEAD.who[under.tone]} · {REWIND_AHEAD.noMoney}{under.conditional ? ` · ${REWIND_AHEAD.tickIf.toLowerCase()}` : ''}</div>
            <button type="button" className="hm-back rw-open" onClick={(e) => { e.stopPropagation(); onOpenDeal(under.line.deal_id); }}>{REWIND_AHEAD.hub.open}</button>
          </>
        ) : <div className="rw-meta">{ticks.length ? REWIND_AHEAD.hub.nothingYet : REWIND_AHEAD.hub.nothingAll}</div>}
      {ahead.reach ? <div className="rw-ruleline">{ruleLine(ahead.reach, until ? stepTime(until) : '—')}</div> : null}
      <div className="h-week rw-count">{ticks === null ? '' : REWIND_AHEAD.hub.count(ticks.length, stepTime(r.limit))}</div>
    </div>
  );
}
