// spark abstract-first-home round 4: the secure step component (contract.ts). One secure form (keys,
// rules, pairing) from the approval side's BARE surface (`approval.html?bare=<kind>`, windows/approval/
// bare), shown by one of three presenters (`?secure=`):
//   inline  borderless in the conversation card, as tall as the form, under a small lock line
//   sheet   a focused sheet over the dimmed app; Esc or ✕ cancels; closes itself with a tick when done
//   popup   a real small window beside this one (as the desktop child window sits); the card waits
// In the desktop app (not the browser mock) frames are blocked and window.open is not the approval
// window, so every presenter falls back to approval_open (the real approval window) and the same
// waiting card. `done` comes from the caller (useStart): a presenter never decides it on its own; the
// page's secure-done only lets the card say "confirming" a moment sooner.
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HOLD_MS, useCalm } from '../../../../../../design/motion';
import { useMutation } from '../../../../../../lib/hooks';
import { NOTICE_WHAT } from '../../../../../../lib/words';
import { WalletNotice } from '../../../../../../shared/honesty';
import { Btn, trapTab, useLayer, useReturnFocus } from '../../../../../../shared/ui';
import { tr, TRAVEL } from '../../fx';
import { securePresenter, type SecureKind, type SecurePresenter, type SecureStepProps } from './contract';
import { BareFrame } from './Frame';
import { bareUrl, openArgs, popupFeatures, readSecureMessage, secureInPage } from './messages';
import { SC } from './words';
import './secure.css';

/** What actually shows the step here: the asked presenter in a browser on the mock world, else the
 *  approval window itself ('window'). */
export type ShownAs = SecurePresenter | 'window';
export function shownAs(asked: SecurePresenter = securePresenter(), inPage: boolean = secureInPage()): ShownAs {
  return inPage ? asked : 'window';
}

export function SecureStep(props: SecureStepProps) {
  const [as] = useState<ShownAs>(() => shownAs());
  const [src] = useState(() => bareUrl(props.kind, props.draft, props.pairing));
  return (
    <div className="sc-step" data-secure={props.kind} data-presenter={as} data-done={props.done ? 'true' : 'false'}>
      {as === 'inline' ? <Inline {...props} src={src} />
        : as === 'sheet' ? <SheetStep {...props} src={src} />
          : as === 'popup' ? <Popup {...props} src={src} />
            : <WindowStep {...props} />}
    </div>
  );
}

type Shown = SecureStepProps & { src: string };

// ---- inline ------------------------------------------------------------------------------------

function Inline({ kind, done, src }: Shown) {
  const calm = useCalm();
  return (
    <motion.div className="sc-inline" layout={!calm} transition={tr('med', calm)}>
      <LockLine />
      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.div key="done" initial={{ opacity: 0, y: TRAVEL.tick }} animate={{ opacity: 1, y: 0 }} transition={tr('med', calm, 'out')}>
            <DoneRow kind={kind} />
          </motion.div>
        ) : (
          <motion.div key="form" exit={{ opacity: 0, y: -TRAVEL.tick }} transition={tr('fast', calm, 'in')}>
            <BareFrame kind={kind} src={src} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ---- sheet -------------------------------------------------------------------------------------

function SheetStep({ kind, done, onCancel, src }: Shown) {
  const calm = useCalm();
  // Opens at once (the turn IS this step); closing without finishing leaves a way back in the card.
  const [open, setOpen] = useState(!done);
  const [ticked, setTicked] = useState(false);
  useEffect(() => {
    if (!done || !open) return;
    setTicked(true);
    const t = setTimeout(() => setOpen(false), calm ? 0 : HOLD_MS);
    return () => clearTimeout(t);
  }, [done, open, calm]);
  const cancel = () => { setOpen(false); onCancel(); };
  return (
    <>
      <AnimatePresence initial={false} mode="wait">
        {done && !open ? (
          <motion.div key="done" initial={{ opacity: 0, y: TRAVEL.tick }} animate={{ opacity: 1, y: 0 }} transition={tr('med', calm, 'out')}><DoneRow kind={kind} /></motion.div>
        ) : (
          <motion.div key="card" className="sc-card" exit={{ opacity: 0 }} transition={tr('fast', calm)}>
            <LockLine />
            <div className="sc-card-row">
              <span className="sc-card-t">{open ? SC.waiting : SC.sheetTitle[kind]}</span>
              {!open ? <Btn kind="gold" sm onClick={() => setOpen(true)}>{SC.sheetTitle[kind]}…</Btn> : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {createPortal(
        <AnimatePresence>
          {open ? <SheetBox key="sheet" kind={kind} src={src} ticked={ticked} onCancel={cancel} /> : null}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

function SheetBox({ kind, src, ticked, onCancel }: { kind: SecureKind; src: string; ticked: boolean; onCancel: () => void }) {
  const calm = useCalm();
  const box = useRef<HTMLElement>(null);
  const h = useRef<HTMLHeadingElement>(null);
  useLayer(onCancel, 'sheet');
  useReturnFocus();
  useEffect(() => { h.current?.focus(); }, []);
  return (
    <>
      <motion.div className="sc-scrim" aria-hidden="true" onMouseDown={onCancel}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tr('med', calm)} />
      <motion.section ref={box} className="sc-sheet" role="dialog" aria-modal="true" aria-labelledby="sc-sheet-h" tabIndex={-1}
        onKeyDown={(e) => trapTab(e, box.current)}
        initial={{ opacity: 0, y: TRAVEL.main, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: TRAVEL.side, scale: 0.99 }}
        transition={tr('sheet', calm, 'out')}>
        <header className="sc-sheet-h">
          <h2 id="sc-sheet-h" ref={h} tabIndex={-1}>{SC.sheetTitle[kind]}</h2>
          <button type="button" className="ui-btn plain icon" aria-label={SC.close} title={SC.closeEsc} onClick={onCancel}>✕</button>
        </header>
        <LockLine />
        <div className="sc-sheet-b">
          <AnimatePresence mode="wait" initial={false}>
            {ticked ? (
              <motion.div key="tick" className="sc-sheet-tick" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={tr('med', calm, 'out')}>
                <DoneRow kind={kind} big />
              </motion.div>
            ) : (
              <motion.div key="form" exit={{ opacity: 0 }} transition={tr('fast', calm)}>
                <BareFrame kind={kind} src={`${src}&head=0`} onCancel={onCancel} minHeight={120} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.section>
    </>
  );
}

// ---- popup -------------------------------------------------------------------------------------

type WinState = 'idle' | 'open' | 'closed' | 'blocked';

function Popup({ kind, done, onCancel, src }: Shown) {
  const win = useRef<Window | null>(null);
  const [state, setState] = useState<WinState>('idle');
  const openIt = () => {
    const w = window.open(src, 'the-table-secure', popupFeatures());
    if (!w) { setState('blocked'); return; }
    win.current = w;
    w.focus();
    setState('open');
  };
  // Messages from that window only; notice when she closes it.
  useEffect(() => {
    if (state !== 'open') return;
    const on = (e: MessageEvent) => {
      const m = readSecureMessage(e, win.current);
      if (m?.type === 'secure-cancel') { win.current?.close(); setState('closed'); onCancel(); }
    };
    window.addEventListener('message', on);
    const t = setInterval(() => { if (win.current?.closed) setState('closed'); }, 500);
    return () => { window.removeEventListener('message', on); clearInterval(t); };
  }, [state, onCancel]);
  // Done: the window has shown its own success; close it after a beat, as the sheet does.
  useEffect(() => {
    if (!done || !win.current || win.current.closed) return;
    const w = win.current;
    const t = setTimeout(() => w.close(), HOLD_MS);
    return () => clearTimeout(t);
  }, [done]);
  // Leaving the conversation closes a window that would otherwise be orphaned.
  useEffect(() => () => { if (win.current && !win.current.closed) win.current.close(); }, []);
  return <Waiting kind={kind} done={done} state={state} onOpen={openIt} onFocus={() => win.current?.focus()} />;
}

// ---- the desktop app: the approval window itself -----------------------------------------------

function WindowStep({ kind, draft, pairing, done }: SecureStepProps) {
  const open = useMutation('approval_open');
  const [state, setState] = useState<WinState>('idle');
  const openIt = async () => { if ((await open.run(openArgs(kind, draft, pairing))) === null) setState('open'); };
  return (
    <>
      <Waiting kind={kind} done={done} state={state} onOpen={() => void openIt()} onFocus={() => void openIt()} busy={open.pending} note={SC.desktopNote} />
      {open.error ? <WalletNotice error={open.error} what={NOTICE_WHAT.approval} /> : null}
    </>
  );
}

/** The card while the step runs in its own window: open it, then wait for the wallet. */
function Waiting({ kind, done, state, onOpen, onFocus, busy = false, note }: { kind: SecureKind; done: boolean; state: WinState; onOpen: () => void; onFocus: () => void; busy?: boolean; note?: string }) {
  const calm = useCalm();
  return (
    <AnimatePresence mode="wait" initial={false}>
      {done ? (
        <motion.div key="done" initial={{ opacity: 0, y: TRAVEL.tick }} animate={{ opacity: 1, y: 0 }} transition={tr('med', calm, 'out')}><DoneRow kind={kind} /></motion.div>
      ) : (
        <motion.div key={state === 'open' ? 'wait' : 'go'} className="sc-card" initial={{ opacity: 0, y: TRAVEL.tick }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={tr('med', calm, 'out')}>
          <LockLine />
          {state === 'open' ? (
            <div className="sc-card-row" role="status">
              <span className="sc-pulse" aria-hidden="true" />
              <span className="sc-card-t">{SC.waiting}<small>{SC.waitingSub}</small></span>
              <Btn sm onClick={onFocus}>{SC.focus}</Btn>
            </div>
          ) : (
            <>
              <p className="sc-card-p">{state === 'closed' ? SC.closed : state === 'blocked' ? SC.blocked : SC.openWhy}</p>
              <div className="sc-card-row">
                <Btn kind="gold" disabled={busy} onClick={onOpen}>{state === 'closed' ? SC.reopen : SC.open[kind]}</Btn>
                {note ? <span className="sc-dim">{note}</span> : null}
              </div>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---- shared ------------------------------------------------------------------------------------

function LockLine(): ReactNode {
  return (
    <p className="sc-lockline">
      <svg className="sc-lock" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <b>{SC.lock}</b><span>· {SC.lockWhere}</span>
    </p>
  );
}

function DoneRow({ kind, big = false }: { kind: SecureKind; big?: boolean }) {
  const calm = useCalm();
  return (
    <div className={`sc-done${big ? ' big' : ''}`} role="status">
      <span className="sc-tick" aria-hidden="true">
        <svg viewBox="0 0 20 20">
          <motion.path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
            initial={{ pathLength: calm ? 1 : 0 }} animate={{ pathLength: 1 }} transition={tr('slow', calm, 'out')} />
        </svg>
      </span>
      <span className="sc-done-t"><b>{SC.done[kind]}</b><small>{SC.doneSub[kind]}</small></span>
    </div>
  );
}
