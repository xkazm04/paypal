// spark abstract-first-home round 4 - PROTOTYPE-ONLY: entry of the scratch harness (Harness.tsx).
import { followStoredCalm } from '../../../../../../design/motion';
import { followStoredTheme } from '../../../../../../lib/theme';
import { mount } from '../../../../../../lib/mount';
import { Harness } from './Harness';

followStoredTheme();
followStoredCalm();
void mount('main', Harness);
