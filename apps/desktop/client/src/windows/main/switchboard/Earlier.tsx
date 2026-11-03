// The top bar's two sheets (spark the-proof-table): Earlier, the asks and answers of this sitting as a
// read-only list (newest first; the board itself always shows the latest answer), and the keyboard
// shortcuts, which list the board's one keymap (keys.ts) so the help cannot drift from the bindings.
import { BOARD_CANCELLED, BOARD_EARLIER, BOARD_KEYS } from '../../../lib/words';
import { Sheet } from '../../../shared/ui';
import { BOARD_KEYMAP } from './keys';
import type { Turn } from './Says';

function status(t: Turn, latest: boolean): [string, string] | null {
  const a = t.answer;
  if (!a) return [BOARD_EARLIER.answering, 'teal'];
  if (a.cancelled) return [BOARD_EARLIER.stopped, 'line'];
  if (a.held) return [BOARD_EARLIER.held, 'gold'];
  if (a.undone) return [BOARD_EARLIER.undone, 'line'];
  return latest ? [BOARD_EARLIER.now, 'teal'] : null;
}

export function Earlier({ turns, onClose }: { turns: readonly Turn[]; onClose: () => void }) {
  return (
    <Sheet title={BOARD_EARLIER.title} onClose={onClose} className="sb-sheet">
      {turns.length === 0 ? <p className="sb-quiet">{BOARD_EARLIER.none}</p> : (
        <>
          <p className="sb-quiet">{BOARD_EARLIER.readOnly}</p>
          <ol className="sb-hist" data-earlier>
            {[...turns].reverse().map((t, i) => {
              const s = status(t, i === 0);
              const say = t.answer ? (t.answer.cancelled ? BOARD_CANCELLED : t.answer.say || t.answer.changed || '') : '';
              return (
                <li key={t.id} className="sb-hist-row" data-turn={t.id}>
                  <span className="sb-hist-q"><b>{t.question}</b>{s ? <span className={`ui-chip ${s[1]}`}>{s[0]}</span> : null}</span>
                  {say ? <span className="sb-hist-say">{say}</span> : null}
                  {t.answer?.changed && t.answer.say ? <span className="sb-hist-ch">{t.answer.changed}</span> : null}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </Sheet>
  );
}

export function KeysHelp({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title={BOARD_KEYS.title} onClose={onClose} size="narrow" className="sb-sheet">
      <dl className="sb-keyhelp" data-keyhelp>
        {BOARD_KEYMAP.map((b) => [
          <dt key={`k${b.id}`}><span className="kbd">{b.shown}</span></dt>,
          <dd key={`v${b.id}`}>{b.label}</dd>,
        ])}
      </dl>
    </Sheet>
  );
}
