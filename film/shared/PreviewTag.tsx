// PreviewTag: the director's preview banner restated whenever a zoom pushes the real one out of frame.
// Shared by every film of The Table (film/haggle, film/hero).
import { useCurrentFrame } from 'remotion';
import { alpha, capsStyle, useStyle, type MomentProps } from '@film/kit';

/** Where the director's own preview banner sits in the take (video px): a strip across the top. */
const BANNER_Y = 16;

/**
 * PreviewTag: the preview banner, kept on screen whenever footage is. The director draws its own
 * "Browser preview with sample data" strip at the top of every frame; when the camera (a zoom) pushes
 * that strip out of the picture, this tag takes its place, through the same camera numbers, so the
 * footage is never shown without saying it is a preview on sample data.
 */
export function PreviewTag({ ctx }: MomentProps) {
  const f = useCurrentFrame();
  const s = useStyle();
  const k = ctx.take && ctx.take.width > 0 ? 1920 / ctx.take.width : 1;
  const top = ctx.toScreen({ x: 960, y: BANNER_Y * k }, f);
  // fully on once the banner's centre has left the frame; off while it is comfortably in view
  const p = Math.max(0, Math.min(1, (14 - top.y) / 22));
  if (p <= 0) return null;
  return (
    <div
      style={{
        position: 'absolute', top: 22, left: '50%',
        transform: `translate(-50%, ${(1 - p) * -10}px)`, opacity: p,
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 20px', borderRadius: 999,
        background: alpha('#2a2110', 0.92), border: `1px solid ${alpha(s.accent2, 0.35)}`,
        ...capsStyle(s, 15), letterSpacing: '0.14em', color: alpha('#f2d48f', 0.95),
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: 5, background: s.accent2 }} />
      Browser preview · sample data
    </div>
  );
}
