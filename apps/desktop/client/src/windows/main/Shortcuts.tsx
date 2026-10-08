// Keyboard shortcuts, one sheet for the whole Main window (press ? anywhere). Pages keep their keys
// but no longer print a permanent shortcut footer (docs/ux/UX-GUIDE.md: shortcuts are a bonus,
// not a lesson). Keep this list in step with the page key handlers.
import { Fragment } from 'react';
import { EXPERIMENTS, Sheet, setExperiment, useExperiment, type ExperimentKey } from '../../shared/ui';
import './shell.css';

type Keys = readonly (readonly [string[], string])[];
const GROUPS: readonly { title: string; keys: Keys }[] = [
  { title: 'Everywhere', keys: [
    [['Ctrl', 'K'], 'Find a deal, page or setting'],
    [['Esc'], 'Back one level, or close what is open'],
    [['1', '…', '6'], 'Jump to Tables, Spend, Counter, Book, Shield, Rescue'],
    [['?'], 'Show this list'],
  ] },
  { title: 'The Table (home)', keys: [
    [['←', '→'], 'Turn the dial (or scroll)'],
    [['↑', '↓'], 'Previous or next decision that needs you'],
    [['Enter'], 'Open the highlighted part'],
    [['R'], 'Rewind the week: replay who decided each payment (Space plays, Esc returns)'],
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
    <Sheet title="Keyboard shortcuts" onClose={onClose} size="narrow" className="shortcuts">
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
        <h3>Experiment (round 2)</h3>
        <p className="sc-note">A new layout on trial. Switch it off to see that screen as it was in round 1.</p>
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
