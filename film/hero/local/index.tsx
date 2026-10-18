// The Table's bespoke heroes for the hero film (Maya's week), injected into the demo-film kit as @film/local.
// Shared with the haggle pilot: the brand fonts, PriceCorridor (inset) and PreviewTag (film/shared).
// Local to this film: the two full-screen heroes, both drawn only from the take's record.
import type { ComponentMap } from '@film/kit';
import '../../shared/fonts.ts';
import { PriceCorridor } from '../../shared/PriceCorridor.tsx';
import { PreviewTag } from '../../shared/PreviewTag.tsx';
import { DeadlineClock } from './DeadlineClock.tsx';
import { WhoDecided } from './WhoDecided.tsx';

export const components: ComponentMap = { PriceCorridor, PreviewTag, DeadlineClock, WhoDecided };
