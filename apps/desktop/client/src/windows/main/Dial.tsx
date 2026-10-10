// Layer 0's machined vault dial. React renders the structure; rotation is applied imperatively
// (a damped spring on requestAnimationFrame) so turning never re-renders the tree. Medallions and
// beads stay upright while the rotor turns.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { MODULES } from '../../shared/modules';
import { DID, dialBezel, dialDefs, groove, hubPlate, INDEX, medallionArt, P, RING_HIT, rotorBase, rotorDividers, SPEC, url, WINDOW_PATH } from './art';
import { Chip, type ChipTone } from '../../shared/ui';
import {
  angularDistance, beadAngles, INTRO_MS, INTRO_TURN, introEase, pol, R, rotationFor, sectorAt, shortestTarget, STEP, toPolar, wedgePath,
  type BeadKind,
} from './logic';

export type Bead = { id: string; m: number; kind: BeadKind; needs: boolean; tip: BeadTip };
export type BeadTip = { label: string; title: string; amount: string; state: string; tone: ChipTone; module: string; /** Theme-aware module colour, var(--m-<key>). */ color: string; money: string; need: string | null };

type Props = {
  beads: Bead[];
  badges: number[];
  /** Module index the dial turns to (under the gold index). */
  focus: number;
  mode: 'needs' | 'module';
  intro: 'wait' | 'run' | 'done';
  reduced: boolean;
  glow: boolean;
  flash: number;
  onIntroDone: () => void;
  onSkipIntro: () => void;
  onHover: (i: number) => void;
  onOpen: (i: number) => void;
  onBead: (id: string) => void;
  onTurn: (dir: 1 | -1) => void;
  onPointerInside: (inside: boolean) => void;
  /** What a screen reader hears for the part under the index (the slider's value text). */
  valueText: string;
  /** First run: the dial is drawn but does not turn or open anything yet. */
  disabled?: boolean;
  children: ReactNode;
};

const STATIC = {
  back: dialDefs() + dialBezel(),
  rotor: rotorBase(),
  dividers: rotorDividers(),
  groove: groove(),
  hub: hubPlate(),
};
const ART = MODULES.map((m) => medallionArt(m.key));
const WEDGE = MODULES.map((_, i) => ({
  base: wedgePath(i * STEP - STEP / 2 + 0.6, i * STEP + STEP / 2 - 0.6, R.secI, R.secO),
  edge: wedgePath(i * STEP - STEP / 2 + 1.2, i * STEP + STEP / 2 - 1.2, R.secI + 3, R.secO - 3),
}));

export function Dial(p: Props) {
  const st = useRef({ rot: rotationFor(p.focus), target: rotationFor(p.focus), vel: 0, raf: 0, last: 0, intro: false, introRaf: 0 });
  const rotorRef = useRef<SVGGElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const upRefs = useRef<Array<SVGGElement | null>>([]);
  const nbRefs = useRef<Array<SVGGElement | null>>([]);
  const beadRefs = useRef(new Map<string, SVGGElement>());
  const props = useRef(p);
  props.current = p;

  const angles = useMemo(() => beadAngles(p.beads.map((b) => b.m)), [p.beads]);
  const anglesRef = useRef(angles);
  anglesRef.current = angles;

  const apply = useCallback(() => {
    const s = st.current;
    rotorRef.current?.setAttribute('transform', `rotate(${s.rot.toFixed(2)} 500 500)`);
    const hi = props.current.mode === 'module' ? props.current.focus : -1;
    upRefs.current.forEach((el, i) => {
      if (!el) return;
      const a = i * STEP + s.rot;
      const low = Math.max(0, -Math.cos((a * Math.PI) / 180));
      const [x, y] = pol(R.up - 12 * low, a);
      el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})${i === hi ? ' scale(1.08)' : ''}`);
      // the needs badge sits on the outer side, clear of the beads
      nbRefs.current[i]?.setAttribute('transform', `translate(${Math.sin((a * Math.PI) / 180) < -0.2 ? -37 : 37} -42)`);
    });
    props.current.beads.forEach((b, k) => {
      const el = beadRefs.current.get(b.id);
      const a = anglesRef.current[k];
      if (!el || a === undefined) return;
      const [x, y] = pol(R.track, a + s.rot);
      el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    });
  }, []);

  const loop = useCallback((t: number) => {
    const s = st.current;
    if (s.intro) { s.raf = 0; return; }
    const dt = Math.min(0.033, (t - s.last) / 1000);
    s.last = t;
    s.vel += ((s.target - s.rot) * 95 - s.vel * 15.5) * dt;
    s.rot += s.vel * dt;
    if (Math.abs(s.target - s.rot) < 0.02 && Math.abs(s.vel) < 0.05) {
      s.rot = s.target; s.vel = 0; s.raf = 0; apply();
      return;
    }
    apply();
    s.raf = requestAnimationFrame(loop);
  }, [apply]);

  // Turn to the focused module, the short way round.
  useEffect(() => {
    const s = st.current;
    s.target = shortestTarget(s.target, rotationFor(p.focus));
    if (s.intro) return;
    if (p.reduced) { s.rot = s.target; s.vel = 0; apply(); return; }
    if (!s.raf) { s.last = performance.now(); s.raf = requestAnimationFrame(loop); }
  }, [p.focus, p.reduced, apply, loop]);

  useLayoutEffect(() => apply());
  useEffect(() => () => { cancelAnimationFrame(st.current.raf); cancelAnimationFrame(st.current.introRaf); st.current.raf = 0; }, []);

  // Arrival: spin up and click onto the first decision (<= 2.8 s, skippable, calm when reduced).
  useEffect(() => {
    if (p.intro !== 'run') return;
    const s = st.current;
    if (p.reduced) {
      s.rot = s.target; apply();
      const t = setTimeout(() => props.current.onIntroDone(), 60);
      return () => clearTimeout(t);
    }
    cancelAnimationFrame(s.raf); s.raf = 0;
    s.intro = true;
    const from = s.target - INTRO_TURN;
    const t0 = performance.now();
    const finish = (notify: boolean) => {
      if (!s.intro) return;
      s.intro = false;
      cancelAnimationFrame(s.introRaf);
      s.rot = s.target; s.vel = 0; apply();
      if (notify) props.current.onIntroDone();
    };
    const step = (t: number) => {
      if (!s.intro) return;
      const q = Math.min(1, (t - t0) / INTRO_MS);
      s.rot = from + (s.target - from) * introEase(q);
      apply();
      if (q < 1) s.introRaf = requestAnimationFrame(step);
      else finish(true);
    };
    s.introRaf = requestAnimationFrame(step);
    const safety = setTimeout(() => finish(true), INTRO_MS + 400); // never strand the scene if frames are throttled
    return () => { clearTimeout(safety); finish(false); };
  }, [p.intro, p.reduced, apply]);

  // ---- pointer: hover dwell turns, wheel turns, click opens -------------------------------------
  const hover = useRef({ anchor: null as number | null, dwellI: -1, timer: 0 as ReturnType<typeof setTimeout> | 0 });
  const clearDwell = () => { if (hover.current.timer) clearTimeout(hover.current.timer); hover.current.timer = 0; hover.current.dwellI = -1; };
  useEffect(() => { if (p.mode === 'needs') hover.current.anchor = null; }, [p.mode]);

  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (p.intro === 'run' || !svgRef.current) return;
    const q = toPolar(e.clientX, e.clientY, svgRef.current.getBoundingClientRect());
    if (q.rad < R.hub + 4 || q.rad > 497) { clearDwell(); return; }
    const h = hover.current;
    if (h.anchor !== null && angularDistance(q.th, h.anchor) < 30 && p.mode === 'module') return;
    const i = sectorAt(q.th, st.current.target);
    if (i === h.dwellI) return;
    clearDwell();
    h.dwellI = i;
    h.timer = setTimeout(() => { h.anchor = q.th; h.dwellI = -1; h.timer = 0; props.current.onHover(i); }, p.mode === 'module' ? 120 : 240);
  };
  const onClick = (e: RMouseEvent<SVGSVGElement>) => {
    if (p.intro === 'run') { p.onSkipIntro(); return; }
    if (!svgRef.current) return;
    const q = toPolar(e.clientX, e.clientY, svgRef.current.getBoundingClientRect());
    if (q.rad >= R.hub + 4 && q.rad <= 497) p.onOpen(sectorAt(q.th, st.current.rot));
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let acc = 0;
    let at = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pr = props.current;
      if (pr.intro === 'run') { pr.onSkipIntro(); return; }
      acc += e.deltaY || e.deltaX;
      const now = performance.now();
      if (Math.abs(acc) >= 40 && now - at > 150) { pr.onTurn(acc > 0 ? 1 : -1); acc = 0; at = now; hover.current.anchor = null; }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ---- bead tooltip ---------------------------------------------------------------------------
  const [tip, setTip] = useState<{ b: BeadTip; x: number; y: number } | null>(null);
  const tipPos = (x: number, y: number) => {
    const w = 300; const h = 150;
    let px = x + 18; let py = y + 16;
    if (px + w > innerWidth - 8) px = x - w - 18;
    if (py + h > innerHeight - 8) py = y - h - 16;
    return { x: Math.max(8, px), y: Math.max(8, py) };
  };

  // px per viewBox unit, so the SVG labels can floor at 12px (home.css reads --k).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => el.style.setProperty('--k', (el.clientWidth / 1000).toFixed(3)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hintId = useId();
  const hi = p.focus;
  const winColor = p.mode === 'module' ? MODULES[hi]?.cssVar ?? P.gold : P.gold;

  return (
    <div className="dialwrap" ref={wrapRef}
      onPointerEnter={() => p.onPointerInside(true)}
      onPointerLeave={() => { clearDwell(); setTip(null); p.onPointerInside(false); }}>
      {/* A slider for assistive tech: one focus stop, the part under the index is its value, and
          the keys Home already handles (arrows, 1-6, Enter) operate it. Its art is presentational. */}
      <svg ref={svgRef} className="dial" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet"
        role="slider" aria-roledescription="dial" aria-label="The dial" tabIndex={p.disabled ? -1 : 0} aria-disabled={p.disabled || undefined}
        aria-orientation="horizontal" aria-valuemin={1} aria-valuemax={MODULES.length} aria-valuenow={p.focus + 1} aria-valuetext={p.valueText} aria-describedby={hintId}
        onPointerMove={onMove} onClick={onClick}>
        <g dangerouslySetInnerHTML={{ __html: STATIC.back }} />
        <g ref={rotorRef}>
          <g dangerouslySetInnerHTML={{ __html: STATIC.rotor }} />
          {MODULES.map((m, i) => (
            <g key={m.key} className={`wedge ${i === hi ? 'on' : ''}`}>
              <path d={WEDGE[i]?.base} fill={url(DID.ringbase)} />
              <path className="tint" d={WEDGE[i]?.base} fill={url(DID.wedge(m.key))} />
              <path className="edge" d={WEDGE[i]?.edge} fill="none" stroke={m.cssVar} strokeWidth="2" />
            </g>
          ))}
          <g dangerouslySetInnerHTML={{ __html: STATIC.dividers }} />
        </g>
        <g dangerouslySetInnerHTML={{ __html: STATIC.groove }} />
        <path className="ring-hit" d={RING_HIT} fill="transparent" fillRule="evenodd" />
        <path className="window" d={WINDOW_PATH} fill="none" stroke={winColor} strokeOpacity=".6" strokeWidth="1.4" strokeDasharray="2 5" pointerEvents="none" />
        <g>
          {MODULES.map((m, i) => (
            <g key={m.key} className={`up ${p.mode === 'module' && i !== hi ? 'dim' : ''}`} ref={(el) => { upRefs.current[i] = el; }} pointerEvents="none">
              <circle cx="0" cy="-8" r="43" fill={url(DID.medal)} stroke={P.ink} strokeWidth="2" />
              <circle cx="0" cy="-8" r="43" fill="none" stroke={url(DID.rimdark)} strokeWidth="1.4" />
              <circle cx="0" cy="-8" r="45.5" fill="none" stroke={m.cssVar} strokeOpacity=".4" strokeWidth="1.2" />
              <g transform="translate(-36 -44) scale(.72)" dangerouslySetInnerHTML={{ __html: ART[i] ?? '' }} />
              <text className="nm" x="0" y="58" textAnchor="middle">{m.name}</text>
              <g className="nb" ref={(el) => { nbRefs.current[i] = el; }}>
                {p.badges[i] ? (
                  <>
                    <circle r="14" fill={url(DID.goldg)} stroke={P.goldEdge} strokeWidth="1.2" />
                    <text y="6.2" textAnchor="middle">{p.badges[i]}</text>
                  </>
                ) : null}
              </g>
            </g>
          ))}
        </g>
        <g>
          {p.beads.map((b) => (
            <g key={b.id} className={`bead k-${b.kind}`}
              ref={(el) => { if (el) beadRefs.current.set(b.id, el); else beadRefs.current.delete(b.id); }}
              onClick={(e) => { e.stopPropagation(); setTip(null); if (p.intro === 'run') p.onSkipIntro(); else p.onBead(b.id); }}
              onPointerEnter={(e) => setTip({ b: b.tip, ...tipPos(e.clientX, e.clientY) })}
              onPointerMove={(e) => setTip({ b: b.tip, ...tipPos(e.clientX, e.clientY) })}
              onPointerLeave={() => setTip(null)}>
              <BeadShape kind={b.kind} needs={b.needs} />
            </g>
          ))}
        </g>
        <g pointerEvents="none">
          {p.glow ? <circle className="hubglow" cx="500" cy="500" r={R.hub + 5} fill="none" stroke={P.gold} strokeWidth="2" strokeOpacity=".7" /> : null}
          <g dangerouslySetInnerHTML={{ __html: STATIC.hub }} />
        </g>
        <g pointerEvents="none" dangerouslySetInnerHTML={{ __html: SPEC }} />
        <g key={p.flash} className={`idx ${p.flash ? 'flash' : ''}`} pointerEvents="none" dangerouslySetInnerHTML={{ __html: INDEX }} />
      </svg>
      <span id={hintId} className="sr-only">
        Six parts of your wallet on the outer ring, every deal as a dot on the middle ring, what needs you in the centre. Left and right arrows turn the dial, up and down step through what needs you, Enter opens, 1 to 6 jump to a part.
      </span>
      <div className="hub">{p.children}</div>
      {tip ? (
        <div className="beadtip" role="tooltip" style={{ left: tip.x, top: tip.y, '--mc': tip.b.color } as CSSProperties}>
          <div className="t1"><span className="mono">{tip.b.label}</span><span>{tip.b.module}</span></div>
          <b>{tip.b.title}</b>
          <div className="t2"><span className="money">{tip.b.amount}</span><Chip tone={tip.b.tone}>{tip.b.state}</Chip></div>
          <div className="t3">Money: {tip.b.money}</div>
          {tip.b.need ? <div className="t4">Needs you · {tip.b.need}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/** A bead's shape by state (tokens only; the gradients and hatch live in the dial's defs). */
export function BeadShape({ kind, needs }: { kind: BeadKind; needs: boolean }) {
  return (
    <>
      {needs ? <circle className="pulse" r="19" fill="none" stroke={P.gold} strokeWidth="2.6" /> : null}
      {kind === 'moving' ? <circle r="10.5" fill={url(DID.tealg)} stroke={P.tealEdge} strokeWidth="1.4" /> : null}
      {kind === 'held' ? (
        <>
          <circle r="12.5" fill={url(DID.hatch)} stroke={P.gold} strokeWidth="2.4" />
          <circle r="6.6" fill="var(--panel)" />
          <rect x="-3.6" y="-1" width="7.2" height="5.4" rx="1" fill="var(--gold-l)" />
          <path d="M-2.2 -1v-1.8a2.2 2.2 0 0 1 4.4 0V-1" fill="none" stroke="var(--gold-l)" strokeWidth="1.3" />
        </>
      ) : null}
      {kind === 'settled' ? <circle r="6.5" fill={url(DID.okg)} /> : null}
      {kind === 'stopped' ? <path d="M-6.5 -6.5L6.5 6.5M6.5 -6.5L-6.5 6.5" stroke="var(--dim)" strokeWidth="3.2" strokeLinecap="round" /> : null}
      {kind === 'off' ? <circle r="7" fill="none" stroke="var(--dim)" strokeWidth="2.2" /> : null}
      {/* Not known yet (a payment being checked with PayPal, or an ending that could not be read): a dashed outline, never gold, green or red. */}
      {kind === 'unknown' ? <circle r="10" fill="none" stroke="var(--dim)" strokeWidth="2.2" strokeDasharray="3.4 3" /> : null}
      <circle r="19" fill="transparent" />
    </>
  );
}

/** The bead legend uses the same shapes; the hatch comes from the dial's defs (same document). */
export function LegendBead({ kind }: { kind: BeadKind | 'needs' }) {
  return (
    <svg viewBox="-14 -14 28 28" aria-hidden="true" className="lgb">
      {kind === 'moving' ? <circle r="9" fill="var(--teal)" /> : null}
      {kind === 'held' ? <circle r="10" fill={url(DID.hatch)} stroke={P.gold} strokeWidth="2.4" /> : null}
      {kind === 'settled' ? <circle r="6" fill="var(--ok)" /> : null}
      {kind === 'stopped' ? <path d="M-6 -6L6 6M6 -6L-6 6" stroke="var(--dim)" strokeWidth="3" strokeLinecap="round" /> : null}
      {kind === 'off' ? <circle r="7" fill="none" stroke="var(--dim)" strokeWidth="2.2" /> : null}
      {kind === 'unknown' ? <circle r="8.5" fill="none" stroke="var(--dim)" strokeWidth="2.2" strokeDasharray="3 2.6" /> : null}
      {kind === 'needs' ? <><circle r="11" fill="none" stroke={P.gold} strokeWidth="2.4" /><circle r="5" fill="var(--teal)" /></> : null}
    </svg>
  );
}
