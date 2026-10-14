// The frame every owner place of the console shares (rebuild WP3c: Settings, Connections, Agent
// rules, Wallet limits, the safety record, the Rewind and the deal page): the ONE answer line as
// the layer's heading (focused going in), a "Your call" line when something here waits for the
// owner (what happens if they do nothing, and at most one gold hand-off), 3-4 cards that each open
// a nested view one level down on this same sheet, an explanation behind a disclosure, and the
// place's own content. A nested view opens under the cards (the card says Close, Escape closes it
// and gives focus back to its card); it never draws a Back of its own: Back, Escape with nothing
// open and the crumbs are the console's. Places have no `v=` in their route (route.ts), so an open
// view is this sheet's own state, not a layer of its own.
import { Suspense, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { isCalm } from '../../../../../design/motion';
import { IF_NOTHING, LAYER_LOADING, PLACE_FRAME, YOUR_CALL } from '../../../../../lib/words';
import { Chip, Disclosure, UNKNOWN, type ChipTone } from '../../../../../shared/ui';

/** One card of a place: a figure or status that opens a nested view (or moves to another layer). */
export type LensCard = {
  id: string;
  label: ReactNode;
  /** The one figure or status line (amounts through `Amount`, counts through `formatCount`). */
  value: ReactNode;
  note?: ReactNode;
  chip?: ReactNode;
  chipTone?: ChipTone;
  /** Something behind this card waits for the owner: the default on silence, in plain words. */
  ifNothing?: string | null;
  /** The nested view this card opens. */
  view?: { title: string; sub?: ReactNode; render: () => ReactNode };
  /** Instead of a view: a move to another layer (it keeps `fk` as the focus key coming back).
   *  With neither, the card is a plain figure. */
  go?: () => void;
  fk?: string;
};

export type CallLine = {
  /** What happens if the owner does nothing, in plain words (null: nothing to say). */
  ifNothing: string | null;
  /** The one action (gold only when it hands a decision to the approval window). */
  action?: ReactNode;
  /** The chip's words; defaults to "Your call". */
  label?: ReactNode;
};

export type PlaceFrameProps = {
  /** The area's root class (`ar-settings`, ...): every rule of the area is scoped under it. */
  root: string;
  kicker: ReactNode;
  /** The one answer line: the layer's heading. */
  answer: ReactNode;
  sub?: ReactNode;
  /** Beside the answer on wide windows (the amount on a deal, a mode badge). */
  aside?: ReactNode;
  call?: CallLine | null;
  /** The place's own action when nothing waits (never gold unless it hands off to approval). */
  action?: ReactNode;
  /** Under the answer, before the cards (the decision on a deal, a finding on the safety record). */
  lead?: ReactNode;
  cards?: readonly LensCard[];
  /** The card whose view is open when the sheet first draws. */
  initialView?: string | null;
  explain?: { summary: ReactNode; body: ReactNode };
  /** The colour of the place (a CSS value), for the cards' edge and the kicker. */
  tone?: string;
  className?: string;
  children?: ReactNode;
  /** Data attribute for tests and the director (`data-place`). */
  place?: string;
};

export const MAX_LENS_CARDS = 4;

/** A windowed list's box on a place: as tall as its rows (plus the toolbar the list draws above
 *  eight rows), never past `max`, so a small shop's short list leaves no dead band. */
export const fitHeight = (rows: number, rowPx: number, max = '60vh'): string => `min(${Math.max(1, rows) * rowPx + (rows > 8 ? 72 : 16)}px, ${max})`;

export function PlaceFrame(p: PlaceFrameProps) {
  const [open, setOpen] = useState<string | null>(p.initialView ?? null);
  const baseId = useId();
  const cards = (p.cards ?? []).slice(0, MAX_LENS_CARDS);
  const current = cards.find((c) => c.id === open && c.view);
  const viewRef = useRef<HTMLElement>(null);
  const focusView = useRef(false);
  const style = (p.tone ? { '--pf-tone': p.tone } : {}) as CSSProperties;

  useEffect(() => {
    if (!focusView.current || !current) return;
    focusView.current = false;
    // The view opens under the cards: bring its top into sight, then give its heading the focus.
    viewRef.current?.scrollIntoView?.({ block: 'start', behavior: isCalm() ? 'auto' : 'smooth' });
    viewRef.current?.querySelector<HTMLElement>('[data-view-title]')?.focus({ preventScroll: true });
  }, [current]);

  const backToCard = (id: string) => {
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-lens="${CSS.escape(id)}"]`)?.focus());
  };
  const toggle = (c: LensCard) => {
    if (c.go) { c.go(); return; }
    if (!c.view) return;
    if (open === c.id) { setOpen(null); return; }
    focusView.current = true;
    setOpen(c.id);
  };
  // Escape inside an open view closes it (and keeps the console's Escape from going a layer up).
  const onViewKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented || !current) return;
    const t = e.target instanceof HTMLElement ? e.target : null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && (t as HTMLInputElement).value) return;
    e.preventDefault();
    const id = current.id;
    setOpen(null);
    backToCard(id);
  };

  return (
    <div className={`pf ${p.root}${p.className ? ` ${p.className}` : ''}`} style={style} data-place={p.place}>
      <header className={`pf-head${p.aside ? ' has-aside' : ''}`}>
        <div className="pf-say">
          <p className="kicker">{p.kicker}</p>
          <h1 className="display cs-title" tabIndex={-1} data-layer-title="">{p.answer}</h1>
          {p.sub ? <p className="pf-sub">{p.sub}</p> : null}
          {p.call || p.action ? (
            <div className={`pf-call${p.call ? '' : ' quiet'}`}>
              {p.call ? <span className="pf-chip"><span className="led" aria-hidden="true" />{p.call.label ?? YOUR_CALL}</span> : null}
              {p.call?.ifNothing ? <span className="pf-sil">{IF_NOTHING}: <b>{p.call.ifNothing}</b></span> : null}
              {p.call?.action ? <span className="pf-act">{p.call.action}</span> : null}
              {p.action ? <span className="pf-act">{p.action}</span> : null}
            </div>
          ) : null}
        </div>
        {p.aside ? <div className="pf-aside">{p.aside}</div> : null}
      </header>
      {p.lead}
      {cards.length ? (
        <section className="pf-cards" aria-label={PLACE_FRAME.cards} style={{ '--n': cards.length } as CSSProperties}>
          {cards.map((c) => {
            const on = open === c.id && !!c.view;
            if (!c.view && !c.go) {
              // A figure with nothing below it: a plain card, not a button that does nothing.
              return (
                <div key={c.id} className={`ui-sumcard pf-card static${c.ifNothing ? ' needs' : ''}`} data-card={c.id}>
                  <span className="sc-label">{c.label}{c.chip ? <Chip tone={c.chipTone}>{c.chip}</Chip> : null}</span>
                  <span className={`sc-value${c.value === null || c.value === undefined ? ' unknown' : ''}`}>{c.value ?? UNKNOWN}</span>
                  {c.note ? <span className="sc-note">{c.note}</span> : null}
                </div>
              );
            }
            return (
              <button key={c.id} type="button" className={`ui-sumcard pf-card${c.ifNothing ? ' needs' : ''}${on ? ' on' : ''}`}
                data-lens={c.id} data-card={c.id} data-fk={c.fk} aria-expanded={c.view ? on : undefined} aria-controls={c.view && on ? `${baseId}-view` : undefined}
                onClick={() => toggle(c)}>
                <span className="sc-label">{c.label}{c.chip ? <Chip tone={c.ifNothing ? (c.chipTone ?? 'gold') : c.chipTone}>{c.chip}</Chip> : null}</span>
                <span className={`sc-value${c.value === null || c.value === undefined ? ' unknown' : ''}`}>{c.value ?? UNKNOWN}</span>
                {c.note || c.ifNothing ? (
                  <span className="sc-note">{c.note}{c.note && c.ifNothing ? ' · ' : null}{c.ifNothing ? <span className="pf-ifnothing">{IF_NOTHING}: {c.ifNothing}</span> : null}</span>
                ) : null}
                <span className="sc-open" aria-hidden="true">{on ? PLACE_FRAME.close : PLACE_FRAME.open} <span className="chev">{on ? '‹' : '›'}</span></span>
              </button>
            );
          })}
        </section>
      ) : null}
      {current?.view ? (
        <section className="pf-view" id={`${baseId}-view`} ref={viewRef} aria-labelledby={`${baseId}-vh`} onKeyDown={onViewKey} data-view={current.id}>
          <header className="pf-vhead">
            <h2 className="pf-vtitle" id={`${baseId}-vh`} tabIndex={-1} data-view-title="">{current.view.title}</h2>
            {current.view.sub ? <p className="pf-vsub">{current.view.sub}</p> : null}
          </header>
          <div className="pf-vbody"><Suspense fallback={<p className="layer-loading" role="status">{LAYER_LOADING}</p>}>{current.view.render()}</Suspense></div>
        </section>
      ) : null}
      {p.children}
      {p.explain ? <Disclosure summary={p.explain.summary} className="pf-explain">{p.explain.body}</Disclosure> : null}
    </div>
  );
}
