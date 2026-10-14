// The rosette: four tick rings that fill like a gauge, inner ring first (hold to confirm).
// Purely ornamental: the gauge's value is announced by its owner (HoldGesture's progressbar).
import { ringFill, ROSETTE_RINGS } from './geometry';
import './brand.css';

export function Rosette({ progress, className }: { progress: number; className?: string }) {
  const n = ROSETTE_RINGS.length;
  return (
    <svg className={`br-rosette${className ? ` ${className}` : ''}`} viewBox="-24 -24 48 48" aria-hidden="true" focusable="false">
      {ROSETTE_RINGS.map((ring) => <circle key={`c${ring.r}`} r={ring.r} />)}
      {ROSETTE_RINGS.map((ring, i) => (
        <path key={`p${ring.r}`} d={ring.d} pathLength={1} strokeDasharray="1" strokeDashoffset={String(1 - ringFill(progress, i, n))} data-ring={i} />
      ))}
    </svg>
  );
}
