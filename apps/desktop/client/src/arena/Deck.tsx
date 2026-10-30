// BROWSER PREVIEW ONLY. Break The Table's deck: the attack cards in their two suits and the closing
// "Check it yourself" card. A card plays on click, on its key, or when dragged onto the table (drag.ts).
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ARENA_DECK, ARENA_FINALE, ATTACK_WORDS } from '../lib/words/arena';
import type { Held } from './drag';
import { keyFor } from './model';
import type { RecordedAttack } from './record';

export type CardHandlers = {
  onPlay: (a: RecordedAttack) => void;
  onDown: (id: string, e: ReactPointerEvent<HTMLElement>) => void;
  onMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onCancel: () => void;
  wasDrag: () => boolean;
};

export function Suit({ title, sub, cards, suit, played, hint, held, h }: {
  title: string; sub: string; cards: RecordedAttack[]; suit: RecordedAttack['suit']; played: (id: string) => number;
  /** The card that says "Start here" (none once anything was played). */
  hint: string | null; held: Held | null; h: CardHandlers;
}) {
  return (
    <section className={`ar-suit s-${suit}`}>
      <h2>{title}</h2>
      <p className="ar-sub">{sub}</p>
      <ul>
        {cards.map((a, i) => {
          const w = ATTACK_WORDS[a.id];
          const n = played(a.id);
          const key = keyFor(suit, i);
          const lifted = held?.id === a.id;
          return (
            <li key={a.id} className={lifted ? 'lifted' : undefined}>
              <button type="button" className={`ar-card${n ? ' played' : ''}${hint === a.id ? ' hint' : ''}`} aria-keyshortcuts={key ?? undefined}
                aria-describedby={hint === a.id ? 'ar-start' : undefined}
                onPointerDown={(e) => h.onDown(a.id, e)} onPointerMove={h.onMove} onPointerUp={h.onUp} onPointerCancel={h.onCancel}
                onClick={() => { if (!h.wasDrag()) h.onPlay(a); }}>
                {key ? <kbd className="ar-key">{key.toUpperCase()}</kbd> : null}
                <span className="ar-card-t">{w?.title ?? a.id}</span>
                <span className="ar-card-s">{w?.tries}</span>
                {n ? <span className="ar-card-p">{ARENA_DECK.played}{n > 1 ? ` ×${n}` : ''}</span> : null}
                {hint === a.id ? <span id="ar-start" className="ar-start">{ARENA_DECK.start} · {ARENA_DECK.drag}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function FinaleCard({ onPlay, ready }: { onPlay: () => void; ready: boolean }) {
  return (
    <button type="button" className={`ar-card ar-finale-card${ready ? ' ready' : ''}`} aria-keyshortcuts="c" onClick={onPlay}>
      <kbd className="ar-key">{ARENA_FINALE.key}</kbd>
      <span className="ar-card-t">{ARENA_FINALE.card}</span>
      <span className="ar-card-s">{ARENA_FINALE.cardSub}</span>
    </button>
  );
}

/** The card in the hand: follows the pointer, tilts, and springs home when dropped off the table. */
export function HeldCard({ held, attack }: { held: Held; attack: RecordedAttack | undefined }) {
  const w = attack ? ATTACK_WORDS[attack.id] : undefined;
  return (
    <div className={`ar-held s-${attack?.suit ?? 'agent'}${held.over ? ' over' : ''}${held.returning ? ' returning' : ''}`} aria-hidden="true"
      style={{ width: held.home.w, transform: `translate3d(${held.x}px, ${held.y}px, 0) rotate(${held.tilt}deg)` }}>
      <span className="ar-card-t">{w?.title ?? attack?.id}</span>
      <span className="ar-card-s">{w?.tries}</span>
    </div>
  );
}
