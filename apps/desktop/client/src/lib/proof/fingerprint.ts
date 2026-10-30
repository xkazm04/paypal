// A key id as four words and four colours, for two people to compare by eye or read out loud. It is
// a reading of the first four bytes of the id, so it is no substitute for the whole id: it is the
// quick way to see that two keys are not the same.
export const WORDS: readonly string[] = (
  'amber apple arrow aspen atlas badge bagel baker banjo basil beach bison blaze bloom bonus brave brick bridge brook cabin cacao camel candle canoe cargo cedar chalk charm cherry chess cider cinder civic ' +
  'clover cobalt comet coral cotton crane crest crisp crown daisy dance delta denim desert diner dolphin dragon dune eagle earth ember emerald engine fable falcon fancy feather fern ferry fiddle field finch ' +
  'flame flint flute forest fossil fox frost galaxy garden garnet ginger glacier globe golden granite grape gravel grove guitar harbor hazel heron hickory honey horizon hover igloo indigo iris island ivory ' +
  'jacket jade jasmine jelly jewel jungle kayak kernel kettle kiwi koala ladder lagoon lantern laurel lemon lilac linen lizard lotus lucky lunar magnet mango maple marble meadow melon mint mirror mocha ' +
  'monsoon moss mountain mulberry nectar needle nimbus noble nutmeg oasis ocean olive onyx orbit orchid otter oyster paddle panda papaya parrot peach pearl pebble pepper pigeon pillow pine planet plum polar ' +
  'pond poppy prairie prism pumpkin puzzle quartz quill rabbit radar rain raven reef ribbon river robin rocket rose ruby saddle saffron sage sailor salmon sand sapphire scarlet shadow shell silver sketch ' +
  'skylark slate snow solar sparrow spice spruce squirrel star stone storm sugar summit sunset swan tango teal temple thistle thunder tiger timber topaz torch tulip tundra turtle umber valley velvet violet ' +
  'walnut wave willow window winter wolf yarrow yellow zebra zephyr zinc ' +
  'acorn anchor birch bronze canyon cliff copper dawn ebony elm fjord harvest hill jazz lava lime mesa moon opal pastel pixel quiet sierra tide vine'
).split(' ');

export interface Fingerprint {
  words: string[];
  /** 0..15, each picks one of sixteen colours. */
  colours: number[];
}
/** The words and colours for a key id (hex); null when it is not a hex id. */
export function fingerprint(keyId: string): Fingerprint | null {
  if (!/^[0-9a-f]{8,}$/i.test(keyId)) return null;
  const bytes = [0, 1, 2, 3].map((i) => parseInt(keyId.slice(i * 2, i * 2 + 2), 16));
  return {
    words: bytes.map((b) => WORDS[b] ?? ''),
    // a different byte of the id than the words, so the two readings do not repeat each other
    colours: [4, 5, 6, 7].map((i) => parseInt(keyId.slice(i * 2, i * 2 + 2), 16) % 16),
  };
}
