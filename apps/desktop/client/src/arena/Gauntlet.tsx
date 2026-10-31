// "Not just these 14": the gauntlet's own seeded hostile sessions, as the
// recorder summed them (record.ts `gauntlet`). Plain labelled numbers, no chart: the point is one
// zero ("by an agent"), and every figure is the record's (that zero too: authorities() counts it).
import { ARENA_GAUNTLET } from '../lib/words/arena';
import { authorities } from './model';
import { RECORD } from './record';

export function Gauntlet({ compact = false }: { compact?: boolean }) {
  const g = RECORD.gauntlet;
  const a = authorities(g.operations);
  return (
    <section className={`ar-gauntlet${compact ? ' compact' : ''}`} aria-label={ARENA_GAUNTLET.heading(RECORD.attacks.length)}>
      <h2>{ARENA_GAUNTLET.heading(RECORD.attacks.length)}</h2>
      <p className="ar-sub">{ARENA_GAUNTLET.sub(g.sessions)}</p>
      <ul className="ar-g-calls">
        <li><b className="num">{g.agent_calls}</b> {ARENA_GAUNTLET.calls}</li>
        <li><b className="num">{g.refused}</b> {ARENA_GAUNTLET.refused}</li>
        <li className="zero"><b className="num">{g.agent_calls_reaching_paypal}</b> {ARENA_GAUNTLET.reached}</li>
      </ul>
      <p className="ar-g-moved">{ARENA_GAUNTLET.moved(a.total)}</p>
      <ul className="ar-g-who">
        <li><b className="num">{a.owner}</b><span>{ARENA_GAUNTLET.owner}</span></li>
        <li><b className="num">{a.rule}</b><span>{ARENA_GAUNTLET.rule}</span></li>
        <li><b className="num">{a.safeDefault}</b><span>{ARENA_GAUNTLET.safeDefault}</span></li>
        {a.other ? <li><b className="num">{a.other}</b><span>{ARENA_GAUNTLET.other}</span></li> : null}
        <li className={a.agent === 0 ? 'zero' : undefined}><b className="num">{a.agent}</b><span>{ARENA_GAUNTLET.agent}</span></li>
      </ul>
      <p className="ar-hint">{ARENA_GAUNTLET.never} {ARENA_GAUNTLET.seed(g.first_seed)}</p>
    </section>
  );
}
