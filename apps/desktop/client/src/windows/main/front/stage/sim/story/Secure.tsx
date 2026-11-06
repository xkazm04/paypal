// sim STORY: the secure step, as a page in Stage's stage slot (host.setMain).
//
// The three privileged steps (pairing_confirm, mandate_sign, set_credentials) run only in the
// approval window: the mock gate refuses any other label or a call without the approval session
// token (mock/backend.ts privileged()). So the story never signs, pins or saves anything itself.
//
// Browser preview: the REAL approval page (approval.html) runs inline in a same-origin iframe. Its
// own mock instance has the 'approval' label and fetches its own token (approval_token); it shares
// this window's first-run world through localStorage + the world's BroadcastChannel (the director
// frames it the same way, director/Director.tsx). When it signs, the main mock receives the new
// state and settings:changed / pairing:pinned, useStart() turns the step done, and the story
// carries on by itself.
// Why not approval_open here: in a top-level browser main window the mock's opener replaces the
// whole page with the sample approval (lib/runtime.ts demoOpener -> lib/preview.ts
// openDemoApproval -> location.assign), which is exactly the "it did not lead back" break.
//
// Desktop app: an iframe would carry the main webview's label, so Rust would refuse every
// privileged call. There the step is approval_open (its own small window), and this page waits.
import { useEffect, useState } from 'react';
import type { ApprovalOpenArgs } from '@bindings/ApprovalOpenArgs';
import { useMutation } from '../../../../../../lib/hooks';
import { firstRunPreview, inDesktopApp } from '../../../../../../lib/preview';
import { loadTour, saveTour } from '../../../../../../lib/tour';
import { NOTICE_WHAT } from '../../../../../../lib/words';
import { WalletNotice } from '../../../../../../shared/honesty';
import { Btn } from '../../../../../../shared/ui';
import { STORY } from './words';

export type SecureWhat = keyof typeof STORY.secureWhat;

/** The approval page address for this step, in this preview world (first_run carried). */
export function secureSrc(args: ApprovalOpenArgs): string {
  const q = new URLSearchParams();
  if (args.pairing) q.set('pairing', JSON.stringify(args.pairing));
  const target = args.target ?? (args.pairing ? 'pairing' : null);
  if (target) q.set('target', target);
  if (args.draft) q.set('draft', JSON.stringify(args.draft));
  if (firstRunPreview()) q.set('first_run', '1');
  return `approval.html?${q.toString()}`;
}

/** The story is the onboarding: the embedded approval page does not start its own coach marks on
 *  top of it (its first-run tour, lib/tour.ts, is marked skipped in this preview world only; the
 *  owner can still open it there with "Take the tour"). */
function quietTour(): void {
  if (loadTour('approval').status === 'new') saveTour('approval', { status: 'skipped', at: null });
}

export function SecurePage({ what, args }: { what: SecureWhat; args: ApprovalOpenArgs }) {
  const desktop = inDesktopApp();
  useState(() => { if (!desktop) quietTour(); return null; });
  const open = useMutation('approval_open');
  const [opened, setOpened] = useState(false);
  // In the app: open the secure window once, on arrival (the owner asked for this step).
  const run = open.run;
  useEffect(() => {
    if (!desktop || opened) return;
    setOpened(true);
    void run(args);
  }, [desktop, opened, run, args]);
  const title = STORY.secureFrame(STORY.secureWhat[what]);
  return (
    <div className="ss-page ss-secure" data-ss-secure={what}>
      <header className="ss-secure-h">
        <h1 className="ss-h">{title}</h1>
        <span className="ss-tag is-secure">{STORY.secureTag}</span>
      </header>
      {desktop ? (
        <div className="ss-wait">
          <p role="status">{STORY.secureWaiting}</p>
          <Btn kind="gold" disabled={open.pending} onClick={() => void run(args)}>{STORY.secureOpen}</Btn>
          {open.error ? <WalletNotice error={open.error} what={NOTICE_WHAT.approval} /> : null}
        </div>
      ) : (
        <>
          <div className="ss-frame">
            <iframe className="ss-iframe" src={secureSrc(args)} title={title} data-ss-frame={what} />
          </div>
          <p className="ss-quiet">{STORY.secureNoteInline}</p>
        </>
      )}
    </div>
  );
}
