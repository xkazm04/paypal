// Keyboard shortcuts, one sheet for the whole Main window (press ? anywhere, or the footer's ?). Pages keep their keys
// but no longer print a permanent shortcut footer (docs/ux/UX-GUIDE.md: shortcuts are a bonus,
// not a lesson). Keep this list in step with the page key handlers.
import { SHORTCUT_GROUPS, SHORTCUTS_LABEL, SHORTCUTS_TRIAL, SHORTCUTS_TRIAL_NOTE } from '../../lib/words';
import { Fragment } from 'react';
import { EXPERIMENTS, Sheet, setExperiment, useExperiment, type ExperimentKey } from '../../shared/ui';
import './console/console.css';

export function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title={SHORTCUTS_LABEL} onClose={onClose} size="narrow" className="shortcuts">
      {SHORTCUT_GROUPS.map((g) => (
        <section key={g.title} className="sc-group">
          <h3>{g.title}</h3>
          <dl>
            {g.keys.map(([keys, what]) => (
              <Fragment key={what}>
                <dt>{keys.map((k, i) => (k === '…' ? <span key={i} className="dim">–</span> : <kbd key={i} className="kbd">{k}</kbd>))}</dt>
                <dd>{what}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
      ))}
      <section className="sc-group sc-exp">
        <h3>{SHORTCUTS_TRIAL}</h3>
        <p className="sc-note">{SHORTCUTS_TRIAL_NOTE}</p>
        <ul>{EXPERIMENTS.map((x) => <ExperimentRow key={x.key} k={x.key} name={x.name} where={x.where} what={x.what} />)}</ul>
      </section>
    </Sheet>
  );
}

function ExperimentRow({ k, name, where, what }: { k: ExperimentKey; name: string; where: string; what: string }) {
  const on = useExperiment(k);
  return (
    <li>
      <label>
        <input type="checkbox" className="ui-check" checked={on} onChange={(e) => setExperiment(k, e.target.checked)} />
        <span><b>{name}</b> <span className="dim">· {where}</span><small>{what}</small></span>
      </label>
    </li>
  );
}
