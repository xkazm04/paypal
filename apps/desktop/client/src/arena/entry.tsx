// BROWSER PREVIEW ONLY: arena.html, Break The Table. The judge plays the attacker; every answer is
// the real wallet's, recorded (record.ts). The page runs on the browser mock as a main-window page
// of the sample week (so Maya's safety record and the note chip read the same world); it never runs
// inside the desktop shell (the shell has no such window, and the page refuses there).
import { isTauri } from '../lib/tauri';
import { mount } from '../lib/mount';
import { initTheme } from '../lib/theme';
import { ARENA_BROWSER_ONLY, ARENA_DOC_TITLE } from '../lib/words/arena';
import { Arena } from './Arena';

initTheme();
document.title = ARENA_DOC_TITLE;
if (isTauri()) {
  const el = document.getElementById('root');
  if (el) el.textContent = ARENA_BROWSER_ONLY;
} else {
  void mount('main', Arena);
}
