import { followStoredCalm } from '../../design/motion';
import { followStoredTheme } from '../../lib/theme';
import { mount } from '../../lib/mount';
import { App } from './App';
import { BareApp } from './bare/Bare';
import { bareKind } from './bare/protocol';
import { withDemoStrip } from './DemoStrip';
import './frame.css';

// One app, one theme (owner, rebuild WP4b): the approval window follows The Table's theme and calm
// choice, like the Tumbler, and follows a switch made there while it is open.
followStoredTheme();
followStoredCalm();
// spark abstract-first-home round 4 (prototype): `?bare=keys|rules|pairing` renders only that secure
// form (bare/protocol.ts), with the same backend label, session and gates as the window itself.
const bare = bareKind();
if (bare) void mount('approval', () => <BareApp kind={bare} />);
else void mount('approval', withDemoStrip(App));
