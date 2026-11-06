// spark abstract-first-home, variant "brief": the quiet module dock. Six glyphs, each with ONE state
// mark (a gold count when something there needs her, else a dot: coral = something stopped, teal =
// something moving, hollow = nothing yet), then a door to the whole console. Clicking a glyph opens
// an inline peek (what is moving, what is stopped, the latest few) with "Open <module>", which is the
// console at #m=<module> - exactly Switchboard.run's navigation. A reply's focus/filter lights a glyph.
import type { Module } from '@bindings/Module';
import { MODULE_KEYS } from '../../../../lib/assistant';
import { BOARD_FATE } from '../../../../lib/words';
import { Glyph, MODULE } from '../../../../shared/modules';
import { Btn } from '../../../../shared/ui';
import { formatHash } from '../../logic';
import type { BoardModel } from '../../switchboard/useBoardModel';
import { setHomeView } from '../../switchboard/view';
import { FB } from './words';

export function toConsole(hash: string): void {
  window.location.hash = hash === '#' ? '' : hash;
  setHomeView('console');
}

type Mark = { tone: 'gold' | 'coral' | 'teal' | 'none'; count: number | null };

export function markOf(model: BoardModel, m: Module): Mark {
  const c = model.cells[m];
  if (c.needs.count) return { tone: 'gold', count: c.needs.count };
  if (c.stopped.count) return { tone: 'coral', count: null };
  if (c.moving.count) return { tone: 'teal', count: null };
  return { tone: 'none', count: null };
}

export function Dock({ model, peek, lit, onPeek }: { model: BoardModel; peek: Module | null; lit: Module | null; onPeek: (m: Module | null) => void }) {
  return (
    <nav className="fb-dock" aria-label={FB.dock.label}>
      <ul className="fb-dock-row">
        {MODULE_KEYS.map((m) => {
          const meta = MODULE[m];
          const mark = markOf(model, m);
          const title = `${meta.name} · ${meta.long}${mark.count ? ` · ${FB.dock.needs(mark.count)}` : ''}`;
          return (
            <li key={m}>
              <button type="button" className={`fb-glyph${peek === m ? ' on' : ''}${lit === m ? ' lit' : ''}`} style={{ '--mc': meta.cssVar } as React.CSSProperties}
                aria-expanded={peek === m} aria-label={title} title={lit === m ? `${title} · ${FB.dock.lit}` : title} onClick={() => onPeek(peek === m ? null : m)} data-dock={m}>
                <Glyph module={m} className="fb-glyph-ic" />
                {mark.count ? <span className="fb-mark gold num">{mark.count}</span> : <span className={`fb-mark dot ${mark.tone}`} aria-hidden="true" />}
              </button>
            </li>
          );
        })}
        <li className="fb-dock-all">
          <button type="button" className="fb-allbtn" title={FB.dock.allTitle} onClick={() => setHomeView('console')}>{FB.dock.all} <span aria-hidden="true">→</span></button>
        </li>
      </ul>
      {peek ? <Peek model={model} m={peek} /> : null}
    </nav>
  );
}

function Peek({ model, m }: { model: BoardModel; m: Module }) {
  const meta = MODULE[m];
  const c = model.cells[m];
  const latest = model.keys.filter((k) => k.module === m).sort((a, b) => (b.stamp_s ?? 0) - (a.stamp_s ?? 0)).slice(0, 3);
  const facts: [string, number, string][] = [
    [FB.dock.needsWord, c.needs.count, 'gold'], [FB.dock.moving, c.moving.count, 'teal'], [FB.dock.stopped, c.stopped.count, 'coral'], [FB.dock.paid, c.paid.count, 'ok'],
  ];
  return (
    <section className="fb-peek" style={{ '--mc': meta.cssVar } as React.CSSProperties} aria-label={meta.name} data-peek={m}>
      <header className="fb-peek-h">
        <Glyph module={m} className="fb-peek-ic" />
        <div><b>{meta.name}</b><span className="fb-quiet"> · {meta.long}</span></div>
        <span className="ui-spacer" />
        <Btn sm onClick={() => toConsole(formatHash({ level: 'module', module: m }))} data-open-module={m}>{FB.dock.open(meta.name)}</Btn>
      </header>
      <ul className="fb-peek-facts">
        {facts.map(([w, n, tone]) => <li key={w} className={n ? tone : 'zero'}><span className="num">{n}</span> {w}</li>)}
      </ul>
      {latest.length ? (
        <ul className="fb-peek-list">
          {latest.map((k) => (
            <li key={k.id}><span className="fb-peek-t">{k.title}</span><span className={`fb-peek-s c-${k.fate}`}>{k.fate === 'needs' ? BOARD_FATE.needs.word : k.state_word}</span></li>
          ))}
        </ul>
      ) : <p className="fb-quiet">{FB.dock.quiet}</p>}
    </section>
  );
}
