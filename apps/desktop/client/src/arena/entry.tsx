// BROWSER PREVIEW ONLY: arena.html, Break The Table's page host (<BreakTheTable host="page" />; the
// console hosts the same component as the place "Try to break it"). The judge plays the attacker; every
// answer is the real wallet's, recorded (record.ts). The page runs on the browser mock as a main-window
// page of the sample week (so Maya's safety record and the note chip read the same world); it never runs
// inside the desktop shell (the shell has no such page, and the page refuses there). Built only by
// `pnpm build:director` (THE_TABLE_DIRECTOR_BUILD=1), never into the desktop bundle.
import { isTauri } from '../lib/tauri';
import { mount } from '../lib/mount';
import { initTheme } from '../lib/theme';
import { ARENA_BROWSER_ONLY, ARENA_DOC_TITLE } from '../lib/words/arena';
import { BreakTheTable } from './BreakTheTable';
import './arena-page.css';

const ArenaPage = () => <BreakTheTable host="page" />;

initTheme();
document.title = ARENA_DOC_TITLE;
if (isTauri()) {
  const el = document.getElementById('root');
  if (el) el.textContent = ARENA_BROWSER_ONLY;
} else {
  void mount('main', ArenaPage);
}
