// BROWSER PREVIEW ONLY. "Watch the haggle" as data: a short story on Maya's sample week that shows the
// replay where the owner meets it. First the decision centre, where the haggle behind Dan's $329
// plays above her decision and rests at the gate, then the Tables layer's replay of the house
// seller's table, from the trade through the wallet's refusal to her own yes and the snap. The beats
// only open windows on routes; the corridor plays on its own clock from the moment its view opens,
// and the captions are timed to it. Every figure a caption names is read from the engine's recording
// (director/recorded.ts, mock/haggle.json): none is typed here.
import { RECORDED } from '../mock/haggle';
import type { Beat, Chapter } from './beats';
import { capUsd, HAGGLE_FIGS as F } from './recorded';

export type WatchChapterId = 'glance' | 'replay';

export const WATCH_CHAPTERS: readonly Chapter<WatchChapterId>[] = [
  { id: 'glance', title: 'The decision in front' },
  { id: 'replay', title: 'Watch the haggle' },
];

const house = RECORDED.house;
const dollars = (minor: number): number => minor / 100;
const houseAgreed = dollars(house.outcome.price);
const houseFirst = dollars(house.steps[0]?.price ?? house.outcome.price);
const askAbove = dollars(house.rules.ask_above);
/** The replay's route: it opens on the fullest finished haggle, the house seller's table. */
const WATCH = '#m=tables&v=watch';

export const WATCH_BEATS: readonly Beat<WatchChapterId>[] = [
  {
    id: 'watch-glance', chapter: 'glance', at: 0, focus: 'main',
    caption: `Dan's table needs Maya: ${capUsd(F.danLast)}. Above her decision, the haggle that led here plays in seconds, and stops at a gold gate.`,
    do: [{ do: 'main', open: true, route: '' }],
  },
  {
    id: 'watch-gate', chapter: 'glance', at: 9, focus: 'main',
    caption: `Her agent would take ${capUsd(F.danLast)}. Above ${capUsd(askAbove)} her rule says ask me, so the wallet refused it: not the agent. The gold button is hers.`,
    do: [{ do: 'main', open: true, route: '' }],
  },
  {
    id: 'watch-trade', chapter: 'replay', at: 17, focus: 'main',
    caption: `Every haggle replays from what was signed. Yesterday the house seller listed at ${capUsd(houseFirst)}, and the two agents closed in, one signed offer at a time.`,
    do: [{ do: 'main', open: true, route: WATCH }],
  },
  {
    id: 'watch-refused', chapter: 'replay', at: 25, focus: 'main',
    caption: `At ${capUsd(houseAgreed)} her agent says yes and hits the gate: above ${capUsd(askAbove)}, the wallet hands it to her.`,
    do: [{ do: 'main', open: true, route: WATCH }],
  },
  {
    id: 'watch-agreed', chapter: 'replay', at: 29, focus: 'main',
    caption: `She says yes herself, and the deal snaps shut at ${capUsd(houseAgreed)}. Every number on the way was one the wallet's engine signed.`,
    do: [{ do: 'main', open: true, route: WATCH }],
  },
];

/** Seconds from the first beat to the end of the last caption. */
export const WATCH_LENGTH = 36;
