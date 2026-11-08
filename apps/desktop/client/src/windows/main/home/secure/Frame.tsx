// The bare approval page in a borderless frame (the secure sheet's body) that takes
// the form's own height (secure-size) and reports done / cancel from that one frame only.
//
// Why this is still the real secure step: the framed page boots its own backend with the label
// 'approval' (lib/runtime.ts initBackend('approval')) and gets the session token there, so
// set_credentials, mandate_sign and pairing_confirm run inside it with every gate the approval window
// has (label, token, idle lock); this page still cannot call them (mock privileged(): "privileged
// commands run only in the approval window"). Nothing here saves, signs or reads a secret; the result
// reaches this window over the world's BroadcastChannel (settings:changed, pairing:pinned), which is
// what the caller's `done` (useStart) reads.
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useCalm } from '../../../../design/motion';
import { tr } from '../fx';
import type { SecureKind } from './contract';
import { readSecureMessage } from './messages';
import { SC } from './words';

export function BareFrame({ kind, src, onDone, onCancel, minHeight = 0 }: {
  kind: SecureKind;
  src: string;
  /** The page says it finished (a hint: the caller's `done` is the truth). */
  onDone?: () => void;
  /** Esc inside the page. */
  onCancel?: () => void;
  minHeight?: number;
}) {
  const calm = useCalm();
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const done = useRef(onDone);
  const cancel = useRef(onCancel);
  done.current = onDone;
  cancel.current = onCancel;
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const m = readSecureMessage(e, frame.current?.contentWindow);
      if (!m) return;
      if (m.type === 'secure-size') setHeight(m.height);
      else if (m.type === 'secure-done') done.current?.();
      else cancel.current?.();
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, []);
  const ready = height !== null;
  return (
    <motion.div className="sc-frame" data-ready={ready ? 'true' : 'false'}
      initial={false} animate={{ height: ready ? Math.max(height, minHeight) : Math.max(96, minHeight) }} transition={tr('med', calm, 'out')}>
      <AnimatePresence initial={false}>
        {!ready ? (
          <motion.p key="wait" className="sc-wait" role="status" exit={{ opacity: 0 }} transition={tr('fast', calm)}>
            <span className="sc-wait-bar" aria-hidden="true" />{SC.loading}
          </motion.p>
        ) : null}
      </AnimatePresence>
      <motion.iframe ref={frame} src={src} title={SC.frameTitle(kind)} className="sc-iframe"
        initial={{ opacity: 0 }} animate={{ opacity: ready ? 1 : 0 }} transition={tr('med', calm)} />
    </motion.div>
  );
}
