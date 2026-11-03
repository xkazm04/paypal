// The answers on screen (spark the-proof-table): three fixed slots (region.ts slotsOf). A panel keeps
// its slot for as long as it stays, so nothing moves when another answer lands; a new answer takes the
// slot the oldest unpinned one left. A panel is a tick-framed sheet (.ui-stack-sheet) whose edge
// carries its colour's meaning, with Pin and Close; only the focused one may draw a gold hand-off
// (Answer.tsx `primary`). An empty slot offers one real question (a ghost); pressing it asks it.
// Below 1480 px the first slot is tall and the other two share the second column (they scroll inside
// themselves at 1280 x 800); from 1480 px the three sit side by side.
import type { ReactNode } from 'react';
import type { PanelSpec } from '../../../lib/assistant';
import { BOARD_ANSWER_CLOSE, BOARD_GHOSTS, BOARD_PANEL_TITLE, BOARD_REGION, BOARD_SLOT } from '../../../lib/words';
import { Btn } from '../../../shared/ui';
import { Answer, panelTitle, type PanelHost } from './Answer';
import type { Tone } from './lit';
import { canPin, panelKey, PIN_MAX, type Region, type RegionPanel } from './region';

/** The colour an answer's edge carries, by what it is about (the tokens' fixed colour meaning). */
const PANEL_TONE: Record<PanelSpec['kind'], Tone> = {
  needs: 'gold', decision: 'gold', setup: 'gold', money: 'teal', rescue: 'coral', safety: 'ok', rules: 'market', book: 'market', week: 'market', deal: 'market',
};
const TONE_VAR: Record<Tone, string> = { gold: 'var(--gold)', teal: 'var(--teal)', coral: 'var(--coral)', refuse: 'var(--refuse)', ok: 'var(--ok)', market: 'var(--steel)' };

/** What fills a slot that holds no panel of the region. */
export type Extra =
  | { kind: 'setup' }
  /** The reply's suggested next steps when no panel on screen can carry them. */
  | { kind: 'suggested'; title: string; body: ReactNode };

export type SlotsProps = {
  slots: readonly (RegionPanel | null)[];
  region: Region;
  focus: string | null;
  host: PanelHost;
  /** Shown in the first free slots, in order, before any ghost. */
  extras: readonly Extra[];
  /** The panel that carries the reply's suggested next steps in its footer, and the footer itself. */
  footFor: string | null;
  foot: ReactNode;
  busy: boolean;
  onAsk: (q: string) => void;
  onFocus: (key: string) => void;
  onPin: (key: string, pinned: boolean) => void;
  onClose: (key: string) => void;
  /** data-answer: what the answer area is showing (the focused panel's kind, setup or none). */
  answer: string;
};

function Sheet({ tone, focus, children, attrs }: { tone: Tone; focus: boolean; children: ReactNode; attrs: Record<string, string | undefined> }) {
  return <article className={`ui-stack-sheet sb-doc${focus ? ' is-focus' : ''}`} style={{ '--c': TONE_VAR[tone] } as React.CSSProperties} {...attrs}>{children}</article>;
}

export function Slots({ slots, region, focus, host, extras, footFor, foot, busy, onAsk, onFocus, onPin, onClose, answer }: SlotsProps) {
  const onScreen = new Set<string>(region.map((p) => p.spec.kind));
  const ghosts = BOARD_GHOSTS.filter((g) => !onScreen.has(g.kind));
  let ei = 0;
  let gi = 0;
  return (
    <section className="sb-docs" aria-label={BOARD_REGION.label} data-answer={answer} data-region={region.length}>
      {slots.map((p, i) => {
        let body: ReactNode;
        if (p) {
          const key = panelKey(p.spec);
          const isFocus = key === focus;
          const pinOff = !p.pinned && !canPin(region, key);
          body = (
            <Sheet tone={PANEL_TONE[p.spec.kind]} focus={isFocus} attrs={{ 'data-panel': p.spec.kind, 'data-panel-key': key, 'data-pinned': p.pinned ? 'true' : 'false', 'aria-current': isFocus ? 'true' : undefined, 'aria-label': panelTitle(p.spec) }}>
              <header className="sb-doc-h">
                <h2 className="sb-doc-t"><button type="button" className="sb-ptitle" onClick={() => onFocus(key)} title={BOARD_SLOT.focusTitle}>{panelTitle(p.spec)}</button></h2>
                {p.pinned ? <span className="ui-chip line sb-pinned">{BOARD_SLOT.pinned}</span> : null}
                <span className="ui-spacer" />
                <Btn sm kind="plain" className="sb-pin" aria-pressed={p.pinned} disabled={pinOff} onClick={() => onPin(key, !p.pinned)}
                  title={pinOff ? BOARD_REGION.pinFull(PIN_MAX) : p.pinned ? BOARD_REGION.unpinTitle : BOARD_REGION.pinTitle} data-pin={key}>{p.pinned ? BOARD_SLOT.unpin : BOARD_REGION.pin}</Btn>
                <Btn sm kind="plain" icon className="sb-close" onClick={() => onClose(key)} aria-label={`${BOARD_ANSWER_CLOSE}: ${panelTitle(p.spec)}`} title={BOARD_ANSWER_CLOSE} data-close={key}>✕</Btn>
              </header>
              <div className="ui-stack-inner sb-doc-b sb-answer-b"><Answer panel={p.spec} host={host} primary={isFocus} /></div>
              {footFor === key && foot ? <footer className="sb-doc-f">{foot}</footer> : null}
            </Sheet>
          );
        } else if (ei < extras.length) {
          const x = extras[ei++]!;
          body = x.kind === 'setup' ? (
            <Sheet tone="gold" focus attrs={{ 'data-extra': 'setup', 'aria-label': BOARD_PANEL_TITLE.setup }}>
              <header className="sb-doc-h"><h2 className="sb-doc-t">{BOARD_PANEL_TITLE.setup}</h2></header>
              <div className="ui-stack-inner sb-doc-b sb-answer-b"><Answer panel={{ kind: 'setup' }} host={host} primary /></div>
              {footFor === 'setup' && foot ? <footer className="sb-doc-f">{foot}</footer> : null}
            </Sheet>
          ) : (
            <Sheet tone="market" focus={false} attrs={{ 'data-extra': 'suggested', 'aria-label': x.title }}>
              <header className="sb-doc-h"><h2 className="sb-doc-t">{x.title}</h2></header>
              <div className="ui-stack-inner sb-doc-b">{x.body}</div>
            </Sheet>
          );
        } else {
          const g = ghosts[gi++];
          body = g ? (
            <button type="button" className="ui-ghost sb-ghost" data-ghost={g.kind} disabled={busy} onClick={() => onAsk(g.q)}>
              <b>{BOARD_PANEL_TITLE[g.kind]}</b>
              <small>{g.about}</small>
              <span className="sb-ghost-q">{BOARD_SLOT.ask(g.q)}</span>
            </button>
          ) : <div className="ui-ghost sb-ghost is-plain">{BOARD_SLOT.free}</div>;
        }
        return <div key={i} className="sb-slot" data-slot={i}>{body}</div>;
      })}
    </section>
  );
}
