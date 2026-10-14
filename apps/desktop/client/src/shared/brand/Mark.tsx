// The brand mark: a reticle in a ticked bezel. Ornamental unless given a label.
import { MARK_D } from './geometry';
import './brand.css';

export function Mark({ label, className, size }: { label?: string; className?: string; size?: number | string }) {
  return (
    <svg className={`br-mark${className ? ` ${className}` : ''}`} viewBox="-12 -12 24 24" width={size} height={size}
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth=".9">
        <circle r="10.5" />
        <path d={MARK_D} />
      </g>
    </svg>
  );
}
