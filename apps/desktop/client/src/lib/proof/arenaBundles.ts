// The arena's recorded deal bundles: for each of Maya's agent's attacks, the signed proof file the wallet
// exported after refusing it (sample/arena-<attack id>.tableproof, written by the arena's recorder,
// crates/table-app/tests/gauntlet/arena.rs, and verified in Rust and here by parity.test.ts). Loaded on
// demand, one file at a time: Break The Table's finale checks the one the person picks, and proof.html
// opens one by name (`?file=arena-<attack id>`). A name that is not one of these files opens nothing.
const FILES = import.meta.glob<string>('./sample/arena-*.tableproof', { query: '?raw', import: 'default' });

const ID_OF = /\/arena-([a-z0-9-]+)\.tableproof$/;

/** The attack ids that have a recorded bundle, sorted. */
export const ARENA_BUNDLE_IDS: readonly string[] = Object.keys(FILES).flatMap((p) => {
  const m = ID_OF.exec(p);
  return m?.[1] ? [m[1]] : [];
}).sort();

/** A bundle's file name, as the wallet exported it and proof.html names it (without the extension). */
export const arenaBundleStem = (id: string): string => `arena-${id}`;
export const arenaBundleName = (id: string): string => `${arenaBundleStem(id)}.tableproof`;

/** The attack id a `?file=` value names, when it is one of the recorded bundles; otherwise null. */
export function arenaBundleId(file: string | null): string | null {
  const m = /^arena-([a-z0-9-]{1,64})$/.exec(file ?? '');
  const id = m?.[1];
  return id && ARENA_BUNDLE_IDS.includes(id) ? id : null;
}

/** The bundle's text, or null when the attack has none. */
export async function loadArenaBundle(id: string): Promise<string | null> {
  const load = FILES[`./sample/${arenaBundleName(id)}`];
  return load ? load() : null;
}
