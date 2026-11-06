// The privileged part of a step (keys, rules signature, the practice shop's four words), as the
// GUIDE shows it. The wallet only lets the approval window do these: the mock's set_credentials,
// mandate_sign and pairing_confirm refuse any caller without the approval label and session token
// (mock/backend.ts privileged()). So the guide never does them itself; it shows the real approval
// page, one of two ways:
//   inline   a plain browser on the mock world (where this simulation runs): approval.html in an
//            iframe, in the same world. The director frames the approval page the same way
//            (director/Director.tsx), and the framed page gets its own mock with the approval label
//            and token, sharing the world through storage + BroadcastChannel; Stage sees the result
//            through settings:changed / pairing:pinned like any other window's work. Labelled
//            "Secure step · in the app this is its own window".
//   window   anywhere else (the desktop app; its CSP has frame-src 'none', and an iframe there would
//            not be the demo): approval_open, and the card waits; useStart moves the guide on.
import { AnimatePresence, motion } from 'framer-motion';
import { useState, type ReactNode } from 'react';
import type { ApprovalOpenArgs } from '@bindings/ApprovalOpenArgs';
import { useCalm } from '../../../../../../design/motion';
import { useMutation } from '../../../../../../lib/hooks';
import { demoNow, inDesktopApp, withDemoSearch, type DemoState } from '../../../../../../lib/preview';
import { backend } from '../../../../../../lib/runtime';
import { saveTour, tourEnd, tourKey } from '../../../../../../lib/tour';
import { NOTICE_WHAT } from '../../../../../../lib/words';
import { WalletNotice } from '../../../../../../shared/honesty';
import { Btn } from '../../../../../../shared/ui';
import { useLocked } from '../../../../world';
import { tr } from '../../fx';
import { SG } from './words';

/** The secure step can run inline: a plain browser on the mock world. */
export function secureInline(): boolean {
  if (inDesktopApp()) return false;
  try { return backend().kind === 'mock'; } catch { return false; }
}

/** The approval page for these approval_open args, in this page's world (pure, tested). */
export function secureUrl(args: ApprovalOpenArgs, world: DemoState | null): string {
  const q = new URLSearchParams();
  if (args.pairing) q.set('pairing', JSON.stringify(args.pairing));
  else if (args.deal_id) q.set('deal', args.deal_id);
  const target = args.target ?? (args.pairing ? 'pairing' : args.deal_id ? 'deal' : null);
  if (target) q.set('target', target);
  if (args.draft) q.set('draft', JSON.stringify(args.draft));
  return `approval.html${world ? withDemoSearch(`?${q.toString()}`, world) : `?${q.toString()}`}`;
}

export function SecureStep({ args, what, act, ready = true, auto = false, children }: {
  args: ApprovalOpenArgs;
  /** What the secure step does, for the frame's title ("save your keys"). */
  what: string;
  /** The button that opens it. */
  act: string;
  /** False while the step is not ready to hand over (no rules read yet). */
  ready?: boolean;
  /** Open at once (the practice shop's words: nothing to decide before). */
  auto?: boolean;
  children?: ReactNode;
}) {
  const calm = useCalm();
  const locked = useLocked();
  const open = useMutation('approval_open');
  const [inline] = useState(secureInline);
  const [shown, setShown] = useState(auto && inline);
  const [waiting, setWaiting] = useState(false);
  const [src, setSrc] = useState<string | null>(() => (auto && inline ? frameSrc(args) : null));
  const go = async () => {
    if (inline) { setSrc(frameSrc(args)); setShown(true); return; }
    if ((await open.run(args)) === null) setWaiting(true);
  };
  return (
    <div className="sg-secure" data-sg-secure={inline ? 'inline' : 'window'}>
      {children}
      {!shown ? (
        <div className="fs-acts">
          <Btn kind="gold" locked={locked} disabled={!ready || open.pending} onClick={() => void go()}>{act}</Btn>
          {waiting ? <span className="fs-quiet" role="status">{SG.secureWaiting}</span> : null}
        </div>
      ) : null}
      {open.error ? <WalletNotice error={open.error} what={NOTICE_WHAT.approval} /> : null}
      <AnimatePresence initial={!auto}>
        {shown && src ? (
          <motion.div key={src} className="sg-frame" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={tr('slow', calm, 'out')}>
            <div className="sg-frame-h">
              <span className="sg-seal" aria-hidden="true" />
              <b>{SG.secure}</b>
              <span className="sg-frame-k">· {SG.secureInline}</span>
              <span className="ui-spacer" />
              <button type="button" className="linkbtn sg-frame-x" onClick={() => setShown(false)}>{SG.secureClose}</button>
            </div>
            <iframe className="sg-iframe" src={src} title={SG.secureFrameTitle(what)} />
            <p className="fs-quiet">{SG.secureNote}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** The framed page's URL. The guide is this owner's onboarding, so the approval page's own coach
 *  marks (shared/tour.tsx) are put away for the framed page first: a UI preference, not wallet state. */
function frameSrc(args: ApprovalOpenArgs): string {
  saveTour('approval', tourEnd('skipped'), tourKey());
  return secureUrl(args, demoNow().state);
}
