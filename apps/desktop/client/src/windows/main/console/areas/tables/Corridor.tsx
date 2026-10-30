// "Watch the haggle": a table's signed offers replayed as two pucks closing on a price rail between
// the owner's walls. The market's typical range is a shaded lane, the most she pays is a hard wall,
// and where the wallet refused her agent a gold gate drops: the agent's puck lunges at it and bounces
// back, the caption says "the wallet refuses: not the agent", and the deal snaps shut only once the
// side that may say yes has said it. Every figure is a transcript price (modules/tables/corridor.ts
// builds the beats; its test proves the browser preview's recorded table equals the engine's run).
// Frame-pure: the picture is a function of the clock, so pause, seek and reduced motion agree.
// Reduced motion steps from beat to beat with no slide, lunge or burst; the steps list is always
// there for a screen reader, and the one caption line is read out as each beat lands.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { usePrefersReducedMotion } from '../../../../../lib/hooks';
import { TABLES_WATCH as W } from '../../../../../lib/words';
import { Btn } from '../../../../../shared/ui';
import { captionOf, frameAt, lunge, playbook, trackOf, xOf, type Haggle } from '../../../modules/tables/corridor';
import { short } from '../../../modules/tables/ladder';

const pct = (f: number): string => `${(f * 100).toFixed(3)}%`;

/** The clock: real time while playing, frozen while paused; `seek` jumps (the end, a replay). */
function useClock(total: number, reduced: boolean, autoplay: boolean) {
  const [t, setT] = useState(autoplay ? 0 : total);
  const [playing, setPlaying] = useState(autoplay);
  const base = useRef<{ wall: number; t: number } | null>(null);
  useEffect(() => {
    if (!playing) { base.current = null; return; }
    let raf = 0;
    const tick = (now: number) => {
      if (!base.current) base.current = { wall: now, t };
      const next = Math.min(total, base.current.t + (now - base.current.wall));
      setT(next);
      if (next >= total) { setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // `t` is read once when a play starts; the frame loop owns it from there.
  }, [playing, total]);
  const play = () => { if (t >= total) setT(0); base.current = null; setPlaying(true); };
  const pause = () => setPlaying(false);
  const end = () => { setPlaying(false); setT(total); };
  return { t, playing, play, pause, end, reduced };
}

export function Corridor({ haggle, who, autoplay = true }: { haggle: Haggle; who: string; autoplay?: boolean }) {
  const reduced = usePrefersReducedMotion();
  const pb = useMemo(() => playbook(haggle), [haggle]);
  const track = useMemo(() => trackOf(haggle), [haggle]);
  const lines = useMemo(() => haggle.beats.map((b) => captionOf(b, haggle, who)), [haggle, who]);
  const clock = useClock(pb.total, reduced, autoplay);
  // Reduced motion: each beat is drawn as it rests (no slide, no lunge, no burst).
  const at = reduced ? restingTime(pb, clock.t) : clock.t;
  const f = frameAt(pb, at);
  if (!track) return null;
  const x = (v: number) => xOf(v, track);
  const m = (v: number) => short(v, haggle.currency);
  const buyer = haggle.side === 'buyer';
  const wall = buyer ? haggle.ceiling : haggle.floor;
  const call = haggle.askAbove;
  const caption = f.current >= 0 ? lines[f.current] : null;

  // the refusal: the gate drops at the price the agent tried (or at the wall), the agent lunges at it
  const gateAt = f.refusal ? (f.refusal.price ?? wall) : null;
  const gateHeld = f.refusal !== null || (f.owner > 0 && !f.snap);
  const heldGate = gateAt ?? lastGate(haggle);
  const lungeP = f.refusal && !reduced ? lunge(f.refusal.p) : 0;
  const youX = f.you !== null ? (gateAt !== null && f.you !== null ? f.you + (gateAt - f.you) * lungeP * 0.92 : f.you) : null;
  const flash = f.refusal ? Math.max(0, 1 - f.refusal.p * 2.2) : 0;
  const burst = f.snap && !reduced ? f.snap.p : 0;

  const youPrice = f.trail.you[f.trail.you.length - 1] ?? null;
  const themPrice = f.trail.them[f.trail.them.length - 1] ?? null;
  const met = f.snap?.p === 1;

  return (
    <section className={`hc${buyer ? '' : ' seller'}${met ? ' met' : ''}${f.refusal ? ' refusing' : ''}`} aria-label={W.stepsTitle}>
      <div className="hc-head" aria-hidden="true">
        <div className="hc-side you">
          <span className="hc-who">{W.you}</span>
          <b className="num">{met && f.snap ? m(f.snap.price) : youPrice !== null ? m(youPrice) : '—'}</b>
        </div>
        <div className="hc-gap">
          {met ? <span className="hc-met">{W.met}</span> : youPrice !== null && themPrice !== null ? <><b className="num">{m(Math.abs(themPrice - youPrice))}</b><span>{W.apart}</span></> : <span>&nbsp;</span>}
        </div>
        <div className="hc-side them">
          <span className="hc-who">{W.them(who)}</span>
          <b className="num">{met && f.snap ? m(f.snap.price) : themPrice !== null ? m(themPrice) : '—'}</b>
        </div>
      </div>

      <div className="hc-track" aria-hidden="true">
        {haggle.market ? (
          <div className="hc-lane" style={{ left: pct(x(haggle.market.p25)), width: pct(x(haggle.market.p75) - x(haggle.market.p25)) }}>
            <span className="hc-median" style={{ left: pct((x(haggle.market.median) - x(haggle.market.p25)) / Math.max(1e-9, x(haggle.market.p75) - x(haggle.market.p25))) }} />
            <span className="hc-lane-label">{W.marketRange(m(haggle.market.p25), m(haggle.market.p75))}</span>
          </div>
        ) : null}
        {call !== null ? (
          <div className={`hc-call${call < track.lo ? ' off' : ''}`} style={buyer ? { left: pct(x(call)), right: 0 } : { left: 0, right: pct(1 - x(call)) }}>
            <span>{buyer ? W.yourCall(m(call)) : W.yourCallBelow(m(call))}</span>
          </div>
        ) : null}
        <div className="hc-rail" />
        {track.ticks.map((p) => <span key={p} className="hc-tick" style={{ left: pct(x(p)) }} />)}
        {wall !== null ? (
          <div className={`hc-wall${f.refusal && f.refusal.clause === 4 ? ' hit' : ''}`} style={{ left: pct(x(wall)) }}>
            <span className="hc-wall-label">{buyer ? W.most : W.least} <b className="num">{m(wall)}</b></span>
          </div>
        ) : null}

        {/* the trail: every price each side signed, fading with age */}
        {(['them', 'you'] as const).map((side) => f.trail[side].map((p, i, all) => (
          <span key={`${side}${i}`} className={`hc-dot ${side}`} style={{ left: pct(x(p)), opacity: 0.25 + 0.55 * ((i + 1) / all.length) } as CSSProperties} />
        )))}

        {gateHeld && heldGate !== null ? (
          <div className={`hc-gate${flash > 0 ? ' flash' : ''}`} style={{ left: pct(x(heldGate)), '--flash': flash.toFixed(3) } as CSSProperties}>
            <span className="hc-gate-tag">{f.owner > 0 ? W.yourCallTag : W.refusedTag}</span>
            {f.owner > 0 ? <span className="hc-hold" style={{ '--hold': f.owner.toFixed(3) } as CSSProperties} /> : null}
          </div>
        ) : null}

        {f.them !== null && themPrice !== null ? <Puck side="them" x={x(f.them)} label={m(f.snap ? f.snap.price : themPrice)} hide={met} /> : null}
        {youX !== null && youPrice !== null ? <Puck side="you" x={x(youX)} label={m(f.snap ? f.snap.price : youPrice)} hide={met} /> : null}
        {f.snap ? (
          <div className={`hc-deal${met ? ' on' : ''}`} style={{ left: pct(x(f.snap.price)), '--burst': burst.toFixed(3) } as CSSProperties}>
            <span className="hc-burst" />
            <span className="hc-deal-tag num">{m(f.snap.price)}</span>
          </div>
        ) : null}
      </div>

      <p className={`hc-caption${f.refusal ? ' gold' : ''}`} aria-live="polite" aria-atomic="true">{caption ?? ' '}</p>

      <div className="hc-foot">
        {clock.playing ? <Btn sm onClick={clock.pause}>{W.pause}</Btn> : <Btn sm kind="primary" onClick={clock.play} title={W.playTitle}>{f.done ? W.replay : W.play}</Btn>}
        {!f.done ? <Btn sm kind="plain" onClick={clock.end}>{W.skip}</Btn> : null}
        <span className="ui-spacer" />
        {haggle.maxOffers ? <span className="hc-offers num">{W.offersLeft(f.offers, haggle.maxOffers)}</span> : null}
      </div>

      <details className="hc-steps">
        <summary>{W.stepsTitle}</summary>
        <ol>{lines.map((l, i) => <li key={i} className={i <= f.current ? 'on' : undefined}>{l}</li>)}</ol>
      </details>
    </section>
  );
}

function Puck({ side, x, label, hide }: { side: 'you' | 'them'; x: number; label: string; hide: boolean }) {
  return (
    <div className={`hc-puck ${side}${hide ? ' gone' : ''}`} style={{ left: pct(x) }}>
      <span className="hc-puck-tag num">{label}</span>
    </div>
  );
}

/** Under reduced motion, the clock shows each beat at rest: the moment its slide and bounce end. */
function restingTime(pb: ReturnType<typeof playbook>, t: number): number {
  let shown = 0;
  for (const c of pb.cues) {
    if (t < c.at) break;
    shown = c.at + c.hold - 1;
  }
  return t >= pb.total ? pb.total : shown;
}

/** The gate stays where the wallet last refused, while the owner decides. */
function lastGate(h: Haggle): number | null {
  for (let i = h.beats.length - 1; i >= 0; i--) {
    const b = h.beats[i];
    if (b?.kind === 'refused') return b.price;
  }
  return null;
}
