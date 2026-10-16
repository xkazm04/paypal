// Keyboard shortcuts, one sheet for the whole Main window (press ? anywhere, or the footer's ?). Pages keep their keys
// but no longer print a permanent shortcut footer (docs/ux/UX-GUIDE.md: shortcuts are a bonus,
// not a lesson). Keep this list in step with the page key handlers.
import { SHORTCUTS_LABEL, SHORTCUTS_TRIAL } from '../../lib/words';
import { Fragment } from 'react';
import { EXPERIMENTS, Sheet, setExperiment, useExperiment, type ExperimentKey } from '../../shared/ui';
import './console/console.css';

type Keys = readonly (readonly [string[], string])[];
const GROUPS: readonly { title: string; keys: Keys }[] = [
  { title: 'Everywhere', keys: [
    [['/'], 'Find a deal, a person or a place (also Ctrl K)'],
    [['Esc'], 'Back one level, or close what is open'],
    [['1', '…', '6'], 'Jump to Tables, Spend, Counter, Book, Shield, Rescue'],
    [['?'], 'Show this list'],
  ] },
  { title: 'What needs you', keys: [
    [['←', '→'], 'Previous or next decision'],
    [['Enter'], 'On the gold button: open the approval window, where money is decided'],
  ] },
  { title: 'Rewind', keys: [
    [['Space'], 'Play or pause the week'],
    [['←', '→'], 'Move the playhead an hour (Shift: a day)'],
  ] },
  { title: 'Tables', keys: [
    [['↑', '↓'], 'Move your price limit (Shift: 5 steps, Page Up/Down: 10)'],
    [['←', '→'], 'Previous or next table'],
  ] },
  { title: 'Counter', keys: [
    [['↑', '↓'], 'Change the lowest price by 1 (Shift: 10)'],
    [['Ctrl', 'Enter'], 'Review your changes'],
  ] },
  { title: 'Shield', keys: [
    [['←', '↑', '→', '↓'], 'Move between checks'],
    [['O'], 'Open the deal'],
    [['R'], 'Release in the approval window'],
    [['P'], 'Show what decided'],
  ] },
  { title: 'Rescue', keys: [
    [['←', '→'], 'Choose a fix'],
    [['↑', '↓'], 'Previous or next subscriber'],
    [['0'], 'Do nothing'],
  ] },
];

export function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title={SHORTCUTS_LABEL} onClose={onClose} size="narrow" className="shortcuts">
      {GROUPS.map((g) => (
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
        <p className="sc-note">A new layout on trial. Switch one off to see that screen as it was before.</p>
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
