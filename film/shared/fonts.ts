// The brand's own type for the film: Archivo (display + body) and Sofia Sans (numerals), loaded from
// the very woff2 files the app ships (apps/desktop/client/src/design/fonts.css) - nothing is copied
// or fetched from the network. The kit's bundler turns each import into a bundled asset URL; the faces
// are registered once, at module load, and the render waits on them (delayRender) so no frame is ever
// captured in a fallback face. Module-level work only: nothing here runs per frame.
import { cancelRender, continueRender, delayRender } from 'remotion';
import archivoLatin from '../../apps/desktop/client/src/assets/fonts/archivo/archivo-latin-standard-normal.woff2';
import archivoLatinExt from '../../apps/desktop/client/src/assets/fonts/archivo/archivo-latin-ext-standard-normal.woff2';
import sofiaLatin from '../../apps/desktop/client/src/assets/fonts/sofia-sans/sofia-sans-latin-wght-normal.woff2';
import sofiaLatinExt from '../../apps/desktop/client/src/assets/fonts/sofia-sans/sofia-sans-latin-ext-wght-normal.woff2';

// unicode ranges as in fonts.css
const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';

type Face = { family: string; url: string; desc: FontFaceDescriptors };
const ARCHIVO: FontFaceDescriptors = { style: 'normal', weight: '100 900', stretch: '62% 125%' };
const SOFIA: FontFaceDescriptors = { style: 'normal', weight: '1 1000' };
const FACES: Face[] = [
  { family: 'Archivo', url: archivoLatin, desc: { ...ARCHIVO, unicodeRange: LATIN } },
  { family: 'Archivo', url: archivoLatinExt, desc: { ...ARCHIVO, unicodeRange: LATIN_EXT } },
  { family: 'Sofia Sans', url: sofiaLatin, desc: { ...SOFIA, unicodeRange: LATIN } },
  { family: 'Sofia Sans', url: sofiaLatinExt, desc: { ...SOFIA, unicodeRange: LATIN_EXT } },
];

/** Numerals face (money, counts): Sofia Sans with tabular lining figures, as the app draws them. */
export const NUMERALS = '"Sofia Sans", "Archivo", "Segoe UI", sans-serif';

if (typeof document !== 'undefined' && typeof FontFace !== 'undefined') {
  const handle = delayRender('demo-film: brand fonts (Archivo, Sofia Sans)');
  Promise.all(
    FACES.map((f) => {
      const face = new FontFace(f.family, `url(${f.url}) format("woff2")`, f.desc);
      document.fonts.add(face);
      return face.load();
    }),
  ).then(
    () => continueRender(handle),
    (err) => cancelRender(err instanceof Error ? err : new Error(String(err))),
  );
}
