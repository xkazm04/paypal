// The Seal: the wallet's presence as a calibrated dial (stylised illustration). A 180-tick bezel
// with a degree scale and a microprint ring, a vernier pair of tick rings, a dashed range ring,
// spokes, a reticle, one soft signal sweep and, when a deadline runs, a gold arc of the time left.
// Presentational only: it reads nothing and does nothing; its owner passes the state and a plain
// label (role="img"). The sweep is slow when quiet, quicker when a deal needs you, coral when
// holding, dimmed when stopped; it stands still under reduced motion and the calm class.
import { useId } from 'react';
import { degreeMarks, MICRO_RING_D, SEAL_BANDS, SWEEP_WEDGES } from './geometry';
import './brand.css';

export type SealState = 'quiet' | 'watching' | 'needs' | 'holding' | 'paid' | 'stopped';
export const SEAL_STATES: readonly SealState[] = ['quiet', 'watching', 'needs', 'holding', 'paid', 'stopped'];

export type SealProps = {
  state: SealState;
  /** Fraction of a running deadline still left (1 = all of it, 0 = none); null or omitted: no arc. */
  progress?: number | null;
  /** Plain words for what the seal shows, e.g. "Your wallet: two deals need you". */
  label: string;
  /** Microprint along the inner ring (decoration; repeated to fill the ring), e.g. "sample data · nothing is paid". */
  ring?: string;
  /** 'centre' is the large dial beside a decision; 'corner' the small stamp on other sheets. */
  size?: 'centre' | 'corner';
  className?: string;
};

const DEGREES = degreeMarks(42.9);

/** The deadline arc's dash for a remaining fraction: clamped to 0..1, null when there is no arc. */
export function arcDash(progress: number | null | undefined): string | null {
  if (progress === null || progress === undefined || !Number.isFinite(progress)) return null;
  const p = Math.min(1, Math.max(0, progress));
  return `${p.toFixed(4)} 1`;
}

function Band({ cls, paths, circles }: { cls: string; paths: readonly string[]; circles: readonly number[] }) {
  return (
    <g className={cls}>
      {paths.map((d, i) => <path key={`p${i}`} d={d} />)}
      {circles.map((r) => <circle key={`c${r}`} r={r} />)}
    </g>
  );
}

export function Seal({ state, progress, label, ring, size = 'centre', className }: SealProps) {
  const id = `seal${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const dash = arcDash(progress);
  const micro = ring ? Array.from({ length: Math.max(1, Math.ceil(120 / (ring.length + 3))) }, () => `${ring} · `).join('') : '';
  const vb = '-50 -50 100 100';
  return (
    <div className={`br-seal${className ? ` ${className}` : ''}`} data-s={state} data-size={size} data-timed={dash ? '' : undefined} role="img" aria-label={label}>
      <div className="br-seal-disc">
        <span className="br-seal-glow" />
        <div className="br-seal-core">
          <svg className="band bS" viewBox={vb} aria-hidden="true" focusable="false">
            {SWEEP_WEDGES.map((w, i) => <path key={i} className="wedge" d={w.d} fillOpacity={w.opacity} />)}
            <path className="edge" d="M0 -3.2L0 -36" />
          </svg>
          <svg className="band bA" viewBox={vb} aria-hidden="true" focusable="false">
            <Band cls="lines" paths={SEAL_BANDS.bezel.paths} circles={SEAL_BANDS.bezel.circles} />
            {DEGREES.map((m) => (
              <text key={m.label} className="deg" x={m.x} y={m.y} transform={`rotate(${m.angle} ${m.x} ${m.y})`} textAnchor="middle" dominantBaseline="central">{m.label}</text>
            ))}
            {micro ? (
              <>
                <defs><path id={id} d={MICRO_RING_D} /></defs>
                <text className="micro"><textPath href={`#${id}`} textLength="246" lengthAdjust="spacing">{micro}</textPath></text>
              </>
            ) : null}
          </svg>
          <svg className="band bB" viewBox={vb} aria-hidden="true" focusable="false">
            <Band cls="lines" paths={SEAL_BANDS.vernier.paths} circles={SEAL_BANDS.vernier.circles} />
          </svg>
          <svg className="band bC" viewBox={vb} aria-hidden="true" focusable="false">
            <Band cls="lines" paths={SEAL_BANDS.reticle.paths} circles={SEAL_BANDS.reticle.circles} />
          </svg>
          {dash ? (
            <svg className="arc" viewBox={vb} aria-hidden="true" focusable="false">
              <circle className="trk" r="52.5" />
              <circle className="lft" r="52.5" pathLength={1} strokeDasharray={dash} transform="rotate(-90)" />
            </svg>
          ) : null}
        </div>
      </div>
    </div>
  );
}
