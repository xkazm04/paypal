// Round 2 (experiment r2-book): the quick views as questions in plain words, one chip per view.
// Picking a chip drafts the same read-only view the old "Quick views" button did; nothing else changes.
import { questionChips } from './where';

export function AskChips({ activeId, onPick }: { activeId: string | null; onPick: (id: string) => void }) {
  return (
    <div className="qchips" role="group" aria-label="Questions you can ask">
      <span className="ui-hint qh">Or tap a question</span>
      {questionChips().map((c) => (
        <button key={c.id} type="button" className={`qchip ${activeId === c.id ? 'on' : ''} ${c.unavailable ? 'unk' : ''}`} aria-pressed={activeId === c.id}
          title={c.unavailable ? `${c.view} · ${c.unavailable}` : c.view} onClick={() => onPick(c.id)}>
          {c.text}
        </button>
      ))}
    </div>
  );
}
