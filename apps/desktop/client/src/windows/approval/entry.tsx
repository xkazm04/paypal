import { followStoredCalm } from '../../design/motion';
import { followStoredTheme } from '../../lib/theme';
import { mount } from '../../lib/mount';
import { App } from './App';
import './frame.css';

// One app, one theme (owner, rebuild WP4b): the approval window follows The Table's theme and calm
// choice, like the Tumbler, and follows a switch made there while it is open.
followStoredTheme();
followStoredCalm();
void mount('approval', App);
