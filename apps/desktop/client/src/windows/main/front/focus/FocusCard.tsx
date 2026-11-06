// FOCUS round 2: the focus card. A row click (or a reply's `show`) puts it in the greeting's
// need-card slot: the item's title, the module's key facts as a compact strip (the row's own cells,
// labelled by the list's columns), the board's own decision / deal renderer for the deal detail and
// its one or two actions (Answer.tsx, unchanged: its hand-off is approval_open or a console door),
// and "Ask about this" chips that PRE-FILL the ask box - the owner sends, nothing is asked for her.
// "Back to today" (or Esc) restores the need card. Numbers come from the row and the board model.
import type { PanelSpec } from '../../../../lib/assistant';
import { BOARD_PANEL_TITLE } from '../../../../lib/words';
import { Glyph, MODULE } from '../../../../shared/modules';
import { Btn } from '../../../../shared/ui';
import { Answer, type PanelHost } from '../../switchboard/Answer';
import { Amount } from '../../switchboard/parts';
import { panelKey } from '../../switchboard/region';
import type { BoardKey } from '../../switchboard/useBoardModel';
import type { ModuleRow } from '../rows/rows';
import { GREET } from './words';

export function RowCard({ row, columns, deal, host, onBack, onAsk }: {
  row: ModuleRow;
  columns: readonly string[];
  /** The board's key for the row's deal, when the row is a deal the board knows. */
  deal: BoardKey | null;
  host: PanelHost;
  onBack: () => void;
  onAsk: (q: string) => void;
}) {
  const meta = MODULE[row.module];
  const label = deal?.label ?? row.title;
  const asks = deal
    ? [deal.fate === 'needs' ? GREET.askSilence(label) : null, GREET.askTell(label)].filter((x): x is string => !!x)
    : [GREET.askModule(meta.long)];
  return (
    <article className="ff-focus" style={{ '--mc': meta.cssVar } as React.CSSProperties} data-focus={row.id} data-focus-deal={row.deal_id ?? undefined}
      aria-label={row.title}>
      <header className="ff-focus-top">
        <span className="ff-kick">{GREET.focusKick(meta.name, meta.long)}</span>
        <span className="ui-spacer" />
        <button type="button" className="linkbtn ff-back" onClick={onBack} title={GREET.backTodayTitle}>{GREET.backToday}</button>
      </header>
      <div className="ff-need-h">
        <Glyph module={row.module} className="ff-need-g" />
        <b className="ff-need-t">{row.title}</b>
        {deal ? <Amount k={deal} /> : null}
      </div>
      {row.cells.length ? (
        <dl className="ff-facts">
          {row.cells.map((c, i) => (
            <div key={i} className="ff-fact">
              <dt>{columns[i] ?? ''}</dt>
              <dd className={`${c.num ? 'num' : ''}${c.tone ? ` tn-${c.tone}` : ''}`}>{c.text}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {row.sub && !deal ? <p className="ff-need-s">{row.sub}</p> : null}
      {deal ? (
        <div className="ff-detail">
          <Answer panel={deal.fate === 'needs' ? { kind: 'decision', deal_id: deal.id } : { kind: 'deal', deal_id: deal.id }} host={host} primary />
        </div>
      ) : (
        <div className="ff-acts">
          <Btn onClick={() => host.run({ kind: 'console', hash: `#m=${row.module}` })}>{GREET.openModule(meta.name)}</Btn>
        </div>
      )}
      <div className="ff-askabout" role="group" aria-label={GREET.askAbout}>
        <span className="ff-kick">{GREET.askAbout}</span>
        {asks.map((q) => <button key={q} type="button" className="ff-chip" onClick={() => onAsk(q)}>{q}</button>)}
      </div>
    </article>
  );
}

/** A non-deal answer the assistant showed (money, rules, safety...): the board's renderer, in the slot. */
export function PanelCard({ spec, host, onBack, children }: { spec: PanelSpec; host: PanelHost; onBack: () => void; children?: React.ReactNode }) {
  const mod = 'module' in spec ? spec.module : null;
  return (
    <article className="ff-focus is-panel" data-panel={panelKey(spec)} style={mod ? { '--mc': MODULE[mod].cssVar } as React.CSSProperties : undefined}>
      <header className="ff-focus-top">
        <span className="ff-kick">{BOARD_PANEL_TITLE[spec.kind]}{mod ? ` · ${MODULE[mod].name}` : ''}</span>
        <span className="ui-spacer" />
        <button type="button" className="linkbtn ff-back" onClick={onBack} title={GREET.backTodayTitle}>{GREET.backToday}</button>
      </header>
      <div className="ff-detail">
        {children ?? <Answer panel={spec} host={host} primary />}
      </div>
    </article>
  );
}
