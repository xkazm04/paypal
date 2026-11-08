// The Chat | Platform switch: the same control at the right edge of the bar in both views, so the owner
// finds it in one place whichever side she is on. The lit side is the current view and does nothing.
import { setHomeView } from './switchboard/view';
import { BOARD_TO_BOARD, BOARD_TO_BOARD_TITLE, VIEW_SWITCH } from '../../lib/words/board';

export function ViewSwitch({ view }: { view: 'board' | 'console' }) {
  const chat = view === 'board';
  return (
    <div className="cs-view" role="group" aria-label={VIEW_SWITCH.label}>
      <button type="button" id="cs-place-board" className={`cs-seg${chat ? ' on' : ''}`} aria-current={chat ? 'page' : undefined}
        onClick={chat ? undefined : () => setHomeView('board')} title={chat ? VIEW_SWITCH.chatTitle : BOARD_TO_BOARD_TITLE}>{BOARD_TO_BOARD}</button>
      <button type="button" id="cs-place-platform" className={`cs-seg${chat ? '' : ' on'}`} aria-current={chat ? undefined : 'page'}
        onClick={chat ? () => setHomeView('console') : undefined} title={chat ? VIEW_SWITCH.platformGo : VIEW_SWITCH.platformTitle}>{VIEW_SWITCH.platform}</button>
    </div>
  );
}
