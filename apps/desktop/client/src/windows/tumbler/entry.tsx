import { followStoredCalm } from '../../design/motion';
import { followStoredTheme } from '../../lib/theme';
import { mount } from '../../lib/mount';
import { App } from './App';
import './tumbler.css';

// Like The Table, the Tumbler follows the stored theme (set in The Table, live across windows).
followStoredTheme();
followStoredCalm();
void mount('tumbler', App);
