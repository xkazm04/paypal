// BROWSER PREVIEW ONLY. A stylised desktop that hosts the real <Tumbler/> in a frame sized to
// the current form's exact logical pixels, anchored at the puck corner - what the native window
// does in the shell. The controls simulate what the Rust core would emit; they are labelled as
// such and never ship in the desktop window (App.tsx loads this module only for the mock).
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { AttentionSnapshot } from '@bindings/AttentionSnapshot';
import type { Form } from '@bindings/Form';
import { useEvent } from '../../../lib/hooks';
import { backend } from '../../../lib/runtime';
import { MockBadge } from '../../../shared/honesty';
import { mockInject, resetMockState } from '../../../mock/backend';
import { FORM_SIZE } from '../logic';
import { Tumbler } from '../Tumbler';
import './preview.css';

type Corner = 'br' | 'tl';
const TASKBAR = 48;
const GAP = 16;

/** Inject a Rust-shaped event through the mock (it routes it to its target windows). */
const simulate = mockInject;
const setForm = (form: Form) => void backend().invoke('tumbler_set_form', { form });
const nowUnix = () => Math.floor(Date.now() / 1000);

async function patchSnapshot(fn: (s: AttentionSnapshot) => AttentionSnapshot): Promise<AttentionSnapshot> {
  const s = fn(await backend().invoke('attention_list', null));
  simulate('attention:changed', s);
  return s;
}
const withItem = (s: AttentionSnapshot, label: string, fn: (i: AttentionItem) => AttentionItem): AttentionSnapshot => ({
  ...s,
  items: s.items.map((i) => (i.label === label ? fn(i) : i)).sort((a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity)),
});

export default function Preview() {
  const [form, setFormState] = useState<Form>('rest');
  const [corner, setCorner] = useState<Corner>('br');
  const [open, setOpen] = useState(true);
  const [locked, setLocked] = useState(false);
  const [needs, setNeeds] = useState(0);
  const [clock, setClock] = useState(() => new Date());
  const [log, setLog] = useState<string[]>([]);
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
    const t = setInterval(() => setClock(new Date()), 15_000);
    return () => clearInterval(t);
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
          <span className="clk">{clock.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
        </span>
      </nav>

      <aside className={`pv-ctl${open ? '' : ' closed'}${corner === 'tl' ? ' right' : ''}`} aria-label="Preview controls, not part of the product">
        <button className="ph" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span><b>Preview controls</b><em>simulate what Rust emits · not part of the product</em></span>
          <span className="tog">{open ? 'hide' : 'show'}</span>
        </button>
        {open ? (
          <div className="body">
            <div className="grp">
              <h4>Windows</h4>
              {ctl('The Table closed (first time)', 'Rust shows the welcome form', () => setForm('welcome'))}
              {ctl('Dock to screen edge', 'as a snap to the edge would: tab form', () => setForm('tab'))}
              {ctl('Undock', 'as a drag back into free space: rest', () => setForm('rest'))}
              {ctl('PayPal opened in browser', 'tumbler:handoff for D-0193 (approve window) + hand-off form', () =>
                void backend().invoke('attention_list', null).then((s) => {
                  const d = s.items.find((i) => i.label === 'D-0193' && i.kind === 'gate') ?? s.items.find((i) => i.kind === 'gate');
                  if (!d) return;
                  simulate('tumbler:handoff', { deal_id: d.deal_id, approve_until: d.deadline ?? nowUnix() + 3600 });
                  setForm('handoff');
                }))}
              {ctl('…with ≤ 15 min to approve', 'tumbler:handoff, approve_until in 12 min', () =>
                void backend().invoke('attention_list', null).then((s) => {
                  const d = s.items.find((i) => i.label === 'D-0193' && i.kind === 'gate') ?? s.items.find((i) => i.kind === 'gate');
                  if (!d) return;
                  simulate('tumbler:handoff', { deal_id: d.deal_id, approve_until: nowUnix() + 12 * 60 });
                  setForm('handoff');
                }))}
              {ctl('Hand-off form only', 'older shell: no tumbler:handoff, stays generic', () => setForm('handoff'))}
              {ctl('Simulate: PayPal APPROVED (polled)', 'receipt for D-0193', () =>
                void backend().invoke('attention_list', null).then((s) => {
                  const d = s.items.find((i) => i.label === 'D-0193');
                  if (d) simulate('receipt:created', { deal_id: d.deal_id, evidence: { deal_id: d.deal_id, receipt: 'NONE', reconciliation: 'not_applicable' }, mode: d.mode, state: 'APPROVED', on_silence: 'approved on PayPal · polled, never the redirect' });
                }))}
              <div className="seg" role="group" aria-label="Puck corner">
                <span>Puck corner</span>
                <button aria-pressed={corner === 'br'} onClick={() => setCorner('br')}>bottom-right</button>
                <button aria-pressed={corner === 'tl'} onClick={() => setCorner('tl')}>top-left</button>
              </div>
            </div>
            <div className="grp">
              <h4>Attention · D-0193</h4>
              {ctl('Deadline ≤ 2 h', 'the ring breathes (unless reduced motion)', () => {
                void patchSnapshot((s) => withItem(s, 'D-0193', (i) => ({ ...i, deadline: nowUnix() + 100 * 60, urgency: 'soon' })));
                simulate('tumbler:visual', { opacity_percent: 100, breathe: true });
              })}
              {ctl('Deadline ≤ 15 min', 'urgency now', () => {
                void patchSnapshot((s) => withItem(s, 'D-0193', (i) => ({ ...i, deadline: nowUnix() + 14 * 60, urgency: 'now' })));
                simulate('tumbler:visual', { opacity_percent: 100, breathe: true });
              })}
              {ctl('Notification clicked', 'Rust opens the card: tumbler:selected', () =>
                void backend().invoke('attention_list', null).then((s) => {
                  const d = s.items.find((i) => i.label === 'D-0193') ?? s.items[0];
                  if (!d) return;
                  setForm('card');
                  simulate('tumbler:selected', { deal_id: d.deal_id });
                }))}
              {ctl('MISMATCH arrives', 'SETTLE ≠ the signed deal: HOLD', () =>
                void patchSnapshot((s) => withItem(s, 'D-0193', (i) => ({ ...i, kind: 'hold', headline: 'Payment held $329.00', deadline: null, urgency: 'calm', on_silence: 'the order is never approved · no money moves', actions: ['withdraw', 'open_in_table'] }))))}
            </div>
            <div className="grp">
              <h4>Other events</h4>
              {ctl('New decision arrives', 'ring + bead + arrival ticker', () =>
                void patchSnapshot((s) => ({
                  ...s,
                  items: [...s.items, {
                    deal_id: '01JDPREVIEWARRIVAL00000207', label: 'D-0207', kind: 'gate', module: 'counter', headline: 'Countersign $48.00', amount_minor: 4800, currency: 'USD',
                    counterparty: 'lark’s agent', clause: null, deadline: nowUnix() + 3 * 3600, on_silence: 'the quote lapses at its deadline · no money moves', urgency: 'calm', mode: 'sandbox',
                    actions: ['review', 'withdraw', 'let_lapse', 'snooze30', 'open_in_table'],
                  } satisfies AttentionItem],
                })))}
              {ctl('Agent refused', 'STOP ticker · never pulses', () => void patchSnapshot((s) => ({ ...s, stopped_today: s.stopped_today + 1 })))}
              {ctl('Idle lock', 'locked after 15 min idle', () => {
                const next = !locked;
                setLocked(next);
                void backend().invoke('get_settings', null).then((st) => simulate('settings:changed', { ...st, locked: next }));
                void patchSnapshot((s) => ({ ...s, locked: next }));
              }, locked)}
              {ctl('Quiet dim', 'tumbler:visual 55 % after 45 s idle', () => simulate('tumbler:visual', { opacity_percent: 55, breathe: false }))}
              {ctl('Reset sample data', 'reload Maya’s week', () => { resetMockState(); location.reload(); })}
            </div>
            <div className="readout">
              form <b>{form}</b> · {w}×{h} · puck {corner === 'br' ? 'bottom-right' : 'top-left'}
              {log.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
