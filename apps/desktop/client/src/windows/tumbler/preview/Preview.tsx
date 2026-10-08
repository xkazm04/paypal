// BROWSER PREVIEW ONLY. A stylised desktop that hosts the real <Tumbler/> in a frame sized to
// the current form's exact logical pixels, anchored at the puck corner - what the native window
// does in the shell. The controls simulate what the Rust core would emit; they are labelled as
// such and never ship in the desktop window (App.tsx loads this module only for the mock).
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Form } from '@bindings/Form';
import { clockOffset } from '../../../lib/clock';
import { useEvent, useNow } from '../../../lib/hooks';
import { backend } from '../../../lib/runtime';
import { MockBadge } from '../../../shared/honesty';
import { mockInject, resetMockState, type MockBackend } from '../../../mock/backend';
import { runActions, type Action, type Stage } from '../../../director/actions';
import { helpers as pv } from '../../../director/helpers';
import { FORM_SIZE } from '../logic';
import { Tumbler } from '../Tumbler';
import './preview.css';

type Corner = 'br' | 'tl';
const TASKBAR = 48;
const GAP = 16;

/** Inject a Rust-shaped event through the mock (it routes it to its target windows). */
const simulate = mockInject;
const setForm = (form: Form) => void backend().invoke('tumbler_set_form', { form });

export default function Preview() {
  const [form, setFormState] = useState<Form>('rest');
  const [corner, setCorner] = useState<Corner>('br');
  const [open, setOpen] = useState(true);
  const [locked, setLocked] = useState(false);
  const [needs, setNeeds] = useState(0);
  const now = useNow();
  const [log, setLog] = useState<string[]>([]);
  // The controls are the director's beat helpers (director/helpers.ts) run on this window's mock.
  const stage = useMemo<Stage>(() => ({ world: (backend() as MockBackend).world, form: setForm, main: () => {}, approval: () => {} }), []);
  const run = (actions: Action[]) => runActions(stage, actions);
  // every tumbler:form re-sends this stage's orientation (the mock's own placement is a stub)
  const [formSeq, setFormSeq] = useState(0);
  const deskRef = useRef<HTMLDivElement>(null);

  useEvent('tumbler:form', (f) => {
    setFormState(f);
    setFormSeq((n) => n + 1);
    setLog((l) => [`tumbler:form → ${f}`, ...l].slice(0, 4));
  });
  useEvent('attention:changed', (s) => setNeeds(s.items.length));
  useEffect(() => {
    void backend().invoke('attention_list', null).then((s) => setNeeds(s.items.length));
  }, []);

  const [w, h] = FORM_SIZE[form];
  // Rust's orientation for the anchored puck: bottom-right grows left/up, top-left grows right/down.
  useEffect(() => {
    const desk = deskRef.current?.getBoundingClientRect();
    const dw = desk?.width ?? window.innerWidth;
    const dh = desk?.height ?? window.innerHeight - TASKBAR;
    const x = corner === 'br' ? dw - GAP - w : GAP;
    const y = corner === 'br' ? dh - GAP - h : GAP;
    simulate('tumbler:orient', { form, placement: { rect: { x, y, width: w, height: h }, side: corner === 'br' ? 'left' : 'right', valign: corner === 'br' ? 'up' : 'down' } });
  }, [form, formSeq, corner, w, h]);

  const flush = form === 'tab';
  const frameStyle: CSSProperties =
    corner === 'br'
      ? { width: w, height: h, right: flush ? 0 : GAP, bottom: GAP }
      : { width: w, height: h, left: flush ? 0 : GAP, top: GAP };

  const ctl = (label: string, sub: string, fn: () => void, pressed?: boolean) => (
    <button onClick={fn} aria-pressed={pressed}>
      {label}
      <small>{sub}</small>
    </button>
  );

  return (
    <div className="pv">
      <div className="pv-desk" ref={deskRef} aria-label="Stylised desktop (browser preview)">
        <div className="pv-label">
          <span>stylised desktop · sandbox sample data</span>
          <MockBadge />
        </div>

        <section className="pv-app" aria-hidden="true">
          <div className="bar"><i className="ic" />restock-plan-q4 — Sheets<span className="wc">— ☐ ✕</span></div>
          <div className="ribbon"><span>File</span><b>Home</b><span>Insert</span><span>Formulas</span><span>Data</span><span>View</span></div>
          <div className="grid">
            {['SKU', 'Item', 'Stock', 'Reorder', 'Floor', 'List'].map((c) => <span key={c} className="hd">{c}</span>)}
            {[
              ['monitor-27-4k', 'Refurbished 27" 4K monitor', '3', '9', '359', '399'],
              ['monitor-24-ips', 'Refurbished 24" IPS monitor', '7', '10', '199', '229'],
              ['monitor-arm', 'Single monitor arm', '11', '16', '58', '64'],
              ['usb-c-dock', 'USB-C dock, 96 W', '2', '7', '60', '64'],
              ['dp-cable-2m', 'DisplayPort 1.4 cable', '24', '34', '12', '14'],
              ['wipe-kit', 'Screen-wipe kit', '30', '42', '16', '18.5'],
              ['care-plan', 'Care plan (monthly)', '—', '—', '—', '12'],
            ].flatMap((r) => r.map((c, i) => <span key={`${r[0]}-${i}`} className={i > 1 ? 'n' : ''}>{c}</span>))}
          </div>
        </section>

        <div className={`pv-frame ${corner}${flush ? ' flush' : ''}`} style={frameStyle}>
          <Tumbler />
          <span className="pv-size" aria-hidden="true">{form} · {w}×{h}</span>
        </div>
      </div>

      <nav className="pv-taskbar" aria-hidden="true">
        <span className="apps"><i className="a1" /><i className="a2" /><i className="a3" /><i className="a4 on" /></span>
        <span className="tray">
          <span className="wal">◎{needs ? <i className="dot" /> : null}</span>
          <span className="clk">{new Date(now * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
        </span>
      </nav>

      <aside className={`pv-ctl${open ? '' : ' closed'}${corner === 'tl' ? ' right' : ''}`} aria-label="Preview controls, not part of the product">
        <button className="ph" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span><b>Preview controls</b><em>simulate what the wallet sends · not part of the product</em></span>
          <span className="tog">{open ? 'hide' : 'show'}</span>
        </button>
        {open ? (
          <div className="body">
            <div className="grp">
              <h4>Windows</h4>
              {ctl('The Table closed (first time)', 'the wallet shows the welcome form', () => run(pv.tableClosedFirstTime()))}
              {ctl('Dock to screen edge', 'as a snap to the edge would: tab form', () => run(pv.dock()))}
              {ctl('Undock', 'as a drag back into free space: rest', () => run(pv.undock()))}
              {ctl('PayPal opened in browser', 'tumbler:handoff for D-0193 (approve window) + hand-off form', () => run(pv.paypalOpened()))}
              {ctl('…with ≤ 15 min to approve', 'tumbler:handoff, approve_until in 12 min', () => run(pv.paypalOpenedLate()))}
              {ctl('Hand-off form only', 'older shell: no tumbler:handoff, stays generic', () => run(pv.handoffOnly()))}
              {ctl('Simulate: PayPal APPROVED (polled)', 'receipt for D-0193', () => run(pv.paypalApproved()))}
              <div className="seg" role="group" aria-label="Puck corner">
                <span>Puck corner</span>
                <button aria-pressed={corner === 'br'} onClick={() => setCorner('br')}>bottom-right</button>
                <button aria-pressed={corner === 'tl'} onClick={() => setCorner('tl')}>top-left</button>
              </div>
            </div>
            <div className="grp">
              <h4>Attention · D-0193 · simulated clock</h4>
              {ctl('Deadline ≤ 2 h', 'the clock runs ahead; the ring breathes (unless reduced motion)', () => run(pv.deadlineSoon()))}
              {ctl('Deadline ≤ 15 min', 'the clock runs ahead; urgency now', () => run(pv.deadlineNow()))}
              {ctl('Deadline passes', 'the safe default runs: withdrawn, no money moves', () => run(pv.deadlinePasses()))}
              {ctl('Notification clicked', 'the wallet opens the card: tumbler:selected', () => run(pv.notificationClicked()))}
              {ctl('Amount mismatch arrives', 'D-0199: the payment request differs from the signed deal: held', () => run(pv.mismatchArrives()))}
            </div>
            <div className="grp">
              <h4>Other events</h4>
              {ctl('New decision arrives', 'ring + bead + arrival ticker', () => run(pv.newDecision()))}
              {ctl('Agent refused', 'STOP ticker · never pulses', () => run(pv.agentRefused()))}
              {ctl('Idle lock', 'locked after 15 min idle', () => {
                const next = !locked;
                setLocked(next);
                run(pv.idleLock(next));
              }, locked)}
              {ctl('Quiet dim', 'tumbler:visual 55 % after 45 s idle', () => run(pv.quietDim()))}
              {ctl('Four hours pass', 'every deadline that passes takes its safe default', () => run(pv.hoursPass(4)))}
              {ctl('Reset sample data', 'reload Maya’s week on a wall clock', () => { resetMockState(); location.reload(); })}
            </div>
            <div className="readout">
              form <b>{form}</b> · {w}×{h} · puck {corner === 'br' ? 'bottom-right' : 'top-left'}
              {clockOffset() ? <div>clock +{Math.round(clockOffset() / 60)} min (simulated)</div> : null}
              {log.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
