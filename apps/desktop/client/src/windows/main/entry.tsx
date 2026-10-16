import { initTheme } from '../../lib/theme';
import { mount } from '../../lib/mount';
import { App } from './App';
import { initCalm } from './console/calm';
import './main.css';

// The main window is the only one that follows the stored theme and the calm-motion choice; apply
// both before the first paint.
initTheme();
initCalm();
void mount('main', App);
