// BROWSER PREVIEW ONLY. The Tumbler as the scenario director frames it (tumbler.html?frame=director):
// the real <Tumbler/> anchored in the bottom-right corner of a transparent patch of desktop, sized
// to the current form's exact logical pixels, as the native window is. No controls here: the
// director drives the forms through the same events the core sends.
import { useEffect, useState, type CSSProperties } from 'react';
import type { Form } from '@bindings/Form';
import { useEvent } from '../../../lib/hooks';
import { MockBadge } from '../../../shared/honesty';
import { mockInject } from '../../../mock/backend';
import { FORM_SIZE } from '../logic';
import { Tumbler } from '../Tumbler';
import './preview.css';

/** Room around the drawing so its shadow fades out inside the frame instead of being cut off. */
const GAP = 40;
/** A strip under the puck for the preview badge, so it never sits on another window. */
const FOOT = 30;

export default function Framed() {
  const [form, setForm] = useState<Form>('rest');
  // every tumbler:form re-sends this corner's orientation (the mock's own placement is a stub)
  const [seq, setSeq] = useState(0);
  useEvent('tumbler:form', (f) => {
    setForm(f);
    setSeq((n) => n + 1);
  });
  const [w, h] = FORM_SIZE[form];
  useEffect(() => {
    const x = window.innerWidth - GAP - w;
    const y = window.innerHeight - FOOT - GAP - h;
    mockInject('tumbler:orient', { form, placement: { rect: { x, y, width: w, height: h }, side: 'left', valign: 'up' } });
  }, [form, seq, w, h]);
  const style: CSSProperties = { width: w, height: h, right: GAP, bottom: FOOT + GAP };
  return (
    <div className="pv-framed">
      <div className="pv-frame br" style={style}>
        <Tumbler />
      </div>
      <div className="pv-framed-foot">
        <span className="pv-framed-name">The Tumbler · stays on top</span>
        <MockBadge />
      </div>
    </div>
  );
}
