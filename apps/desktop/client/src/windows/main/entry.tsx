import { initTheme } from '../../lib/theme';
import { mount } from '../../lib/mount';
import { App } from './App';
import './main.css';

// The main window is the only one that follows the stored theme; apply it before the first paint.
initTheme();
void mount('main', App);
