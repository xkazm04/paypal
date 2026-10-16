// The brand mark: the app logo without its tile (branding/logo-small.svg). A round table seen from above:
// your seat in teal, the other side's in coral, the agreed deal in gold between them; the inks follow the
// theme. Ornamental unless given a label.
import { LOGO } from './geometry';
import './brand.css';

export function Mark({ label, className, size }: { label?: string; className?: string; size?: number | string }) {
  return (
    <svg className={`br-mark${className ? ` ${className}` : ''}`} viewBox={LOGO.viewBox} width={size} height={size}
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      <g fill="none" strokeWidth={LOGO.seatWidth}>
        <path className="yours" d={LOGO.yours} />
        <path className="theirs" d={LOGO.theirs} />
      </g>
      <path className="deal" d={LOGO.deal} />
    </svg>
  );
}
